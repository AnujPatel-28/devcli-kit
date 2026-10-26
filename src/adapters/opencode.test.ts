import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  matchOption,
  opencodeAction,
  opencodeConfigDir,
  opencodeEvent,
  renderOpencodePlugin,
  type OpencodeRelayInput,
} from "./opencode.js";

const idle: OpencodeRelayInput = {
  event: { type: "session.idle", properties: { sessionID: "ses_1" } },
  directory: "/work/web",
  summary: "Migrated the users table.",
};

const permission: OpencodeRelayInput = {
  event: {
    type: "permission.asked",
    properties: {
      id: "per_1",
      sessionID: "ses_1",
      permission: "bash",
      patterns: ["npm run db:migrate*"],
      metadata: { command: "npm run db:migrate -- --env staging" },
      always: [],
    },
  },
  directory: "/work/web",
};

const question: OpencodeRelayInput = {
  event: {
    type: "question.asked",
    properties: {
      id: "que_1",
      sessionID: "ses_1",
      questions: [
        { question: "Which database?", header: "DB", options: [{ label: "Postgres", description: "" }, { label: "SQLite", description: "" }] },
      ],
    },
  },
};

test("session.idle becomes a done ask with the last assistant text", () => {
  assert.deepEqual(opencodeEvent(idle), {
    agent: "opencode",
    sessionId: "ses_1",
    cwd: "/work/web",
    kind: "done",
    summary: "Migrated the users table.",
  });
});

test("permission.asked shows the exact command", () => {
  const event = opencodeEvent(permission);
  assert.equal(event?.kind, "permission");
  assert.equal(event?.tool, "bash");
  assert.equal(event?.detail, "npm run db:migrate -- --env staging");
});

test("permission.asked without a command falls back to the patterns", () => {
  const edit = { event: { type: "permission.asked", properties: { id: "p", sessionID: "s", permission: "edit", patterns: ["src/a.ts", "src/b.ts"] } } };
  assert.equal(opencodeEvent(edit)?.detail, "src/a.ts\nsrc/b.ts");
});

test("question.asked lists the options", () => {
  assert.equal(opencodeEvent(question)?.detail, "Which database? (Postgres / SQLite)");
});

test("answers given in the TUI and new activity close the card", () => {
  for (const type of ["permission.replied", "question.replied", "question.rejected"]) {
    assert.equal(opencodeEvent({ event: { type, properties: { sessionID: "s" } } })?.kind, "working");
  }
  assert.equal(
    opencodeEvent({ event: { type: "session.status", properties: { sessionID: "s", status: { type: "busy" } } } })?.kind,
    "working",
  );
  assert.equal(opencodeEvent({ event: { type: "session.status", properties: { sessionID: "s", status: { type: "idle" } } } }), null);
  assert.equal(opencodeEvent({ event: { type: "session.deleted", properties: { sessionID: "s" } } })?.kind, "ended");
  assert.equal(opencodeEvent({ event: { type: "message.updated", properties: {} } }), null);
});

test("replies become OpenCode API actions", () => {
  assert.deepEqual(opencodeAction(idle, { text: "now seed the data" }), {
    action: "prompt",
    sessionID: "ses_1",
    text: "now seed the data",
  });
  assert.deepEqual(opencodeAction(permission, { decision: "allow" }), {
    action: "permission",
    requestID: "per_1",
    reply: "once",
  });
  assert.deepEqual(opencodeAction(permission, { decision: "deny", text: "use the dev env" }), {
    action: "permission",
    requestID: "per_1",
    reply: "reject",
    message: "use the dev env",
  });
  assert.deepEqual(opencodeAction(question, { text: "Postgres please." }), {
    action: "question",
    requestID: "que_1",
    answers: [["Postgres"]],
  });
  assert.deepEqual(opencodeAction(permission, { decision: "terminal" }), { action: "none" });
  assert.deepEqual(opencodeAction(idle, null), { action: "none" });
});

test("matchOption picks a named option and keeps free text otherwise", () => {
  assert.equal(matchOption("sqlite", ["Postgres", "SQLite"]), "SQLite");
  assert.equal(matchOption("let's go with Postgres", ["Postgres", "SQLite"]), "Postgres");
  assert.equal(matchOption("either Postgres or SQLite", ["Postgres", "SQLite"]), "either Postgres or SQLite");
  assert.equal(matchOption("MySQL", ["Postgres", "SQLite"]), "MySQL");
});

test("the config dir follows OpenCode's own lookup order", () => {
  assert.equal(opencodeConfigDir({ OPENCODE_CONFIG_DIR: "/custom" }), path.resolve("/custom"));
  assert.equal(opencodeConfigDir({ XDG_CONFIG_HOME: "/xdg" }), path.join(path.resolve("/xdg"), "opencode"));
  assert.equal(opencodeConfigDir({}), path.join(os.homedir(), ".config", "opencode"));
});

/**
 * Loads the generated plugin as a real module, with a stub relay script in
 * place of clidev, and drives it like OpenCode would.
 */
test("the generated plugin forwards events and performs the returned action", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clidev-oc-"));
  try {
    const log = path.join(dir, "relay.log");
    const relay = path.join(dir, "relay.cjs");
    await writeFile(
      relay,
      `const fs = require("fs");
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(log)}, input + "\\n");
  const type = process.argv[4];
  const actions = {
    "session.idle": { action: "prompt", sessionID: "ses_top", text: "keep going" },
    "permission.asked": { action: "permission", requestID: "per_9", reply: "reject", message: "not on prod" },
    "question.asked": { action: "question", requestID: "que_9", answers: [["SQLite"]] },
  };
  process.stdout.write(JSON.stringify(actions[type] || { action: "none" }));
});`,
    );
    const pluginFile = path.join(dir, "clidev.mjs");
    await writeFile(pluginFile, renderOpencodePlugin([process.execPath, relay]));
    const plugin = (await import(pathToFileURL(pluginFile).href)) as {
      default: { id: string; server: (input: unknown) => Promise<{ event: (input: unknown) => Promise<void> }> };
    };
    assert.equal(plugin.default.id, "clidev");

    const calls: unknown[] = [];
    const client = {
      session: {
        get: async ({ path: p }: { path: { id: string } }) => ({ data: { parentID: p.id === "ses_child" ? "ses_top" : undefined } }),
        messages: async () => ({
          data: [
            { info: { role: "user" }, parts: [{ type: "text", text: "do it" }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "Done: renamed page_size." }, { type: "tool" }] },
          ],
        }),
        promptAsync: async (request: unknown) => calls.push(["promptAsync", request]),
      },
      _client: { post: async (request: unknown) => calls.push(["post", request]) },
    };
    const hooks = await plugin.default.server({ client, directory: "/work/web" });
    const send = (type: string, properties: Record<string, unknown>) =>
      hooks.event({ event: { id: "e", type, properties } });

    await send("message.updated", { sessionID: "ses_top" }); // ignored
    await send("session.idle", { sessionID: "ses_child" }); // subagent: ignored
    await send("session.status", { sessionID: "ses_top", status: { type: "busy" } }); // nothing open: ignored
    await send("session.idle", { sessionID: "ses_top" });
    await send("permission.asked", { id: "per_9", sessionID: "ses_top", permission: "bash" });
    await send("question.asked", { id: "que_9", sessionID: "ses_top", questions: [] });

    assert.deepEqual(calls, [
      ["promptAsync", { path: { id: "ses_top" }, body: { parts: [{ type: "text", text: "keep going" }] } }],
      [
        "post",
        {
          url: "/permission/{requestID}/reply",
          path: { requestID: "per_9" },
          body: { reply: "reject", message: "not on prod" },
          headers: { "Content-Type": "application/json" },
        },
      ],
      [
        "post",
        {
          url: "/question/{requestID}/reply",
          path: { requestID: "que_9" },
          body: { answers: [["SQLite"]] },
          headers: { "Content-Type": "application/json" },
        },
      ],
    ]);

    const forwarded = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as OpencodeRelayInput);
    assert.deepEqual(
      forwarded.map((item) => item.event.type),
      ["session.idle", "permission.asked", "question.asked"],
    );
    assert.equal(forwarded[0]?.summary, "Done: renamed page_size.");
    assert.equal(forwarded[0]?.directory, "/work/web");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
