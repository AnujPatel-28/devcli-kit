import os from "node:os";
import path from "node:path";

import type { HubEvent, Reply } from "../hub/protocol.js";

/**
 * OpenCode adapter (written against OpenCode 1.19.4).
 *
 * OpenCode has no blocking hooks; it has plugins that see every event and an
 * in-process API client. So the plugin forwards events to `clidev relay
 * opencode`, and the relay answers with an action for the plugin to perform
 * through OpenCode's own API. OpenCode's own prompts stay live in the TUI, so
 * you can answer in either place.
 */

type JsonRecord = Record<string, unknown>;

export const OPENCODE_PLUGIN_FILE = "clidev.js";

/** Mirrors OpenCode's xdg-basedir lookup, on Windows too. */
export function opencodeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_CONFIG_DIR?.trim();
  if (override) return path.resolve(override);
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg ? path.resolve(xdg) : path.join(os.homedir(), ".config"), "opencode");
}

export function opencodePluginPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(opencodeConfigDir(env), "plugins", OPENCODE_PLUGIN_FILE);
}

/** What the plugin sends the relay on stdin. */
export interface OpencodeRelayInput {
  event: { type: string; properties: JsonRecord };
  directory?: string;
  /** Last assistant text, fetched by the plugin for session.idle. */
  summary?: string;
}

/** What the relay prints for the plugin to carry out. */
export type OpencodeAction =
  | { action: "none" }
  | { action: "prompt"; sessionID: string; text: string }
  | { action: "permission"; requestID: string; reply: "once" | "reject"; message?: string }
  | { action: "question"; requestID: string; answers: string[][] };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

interface QuestionInfo {
  question: string;
  options: string[];
}

function questionsOf(properties: JsonRecord): QuestionInfo[] {
  if (!Array.isArray(properties.questions)) return [];
  return properties.questions.filter(isRecord).map((question) => ({
    question: str(question.question) ?? str(question.header) ?? "",
    options: Array.isArray(question.options)
      ? question.options
          .map((option) => (isRecord(option) ? str(option.label) : undefined))
          .filter((label): label is string => label !== undefined)
      : [],
  }));
}

function describeQuestions(questions: QuestionInfo[]): string {
  return questions
    .map((question) => (question.options.length > 0 ? `${question.question} (${question.options.join(" / ")})` : question.question))
    .filter((line) => line.length > 0)
    .join("\n");
}

function describePermission(properties: JsonRecord): string {
  const metadata = isRecord(properties.metadata) ? properties.metadata : {};
  const command = str(metadata.command);
  if (command !== undefined) return command;
  const patterns = Array.isArray(properties.patterns) ? properties.patterns.filter((item) => typeof item === "string") : [];
  return patterns.join("\n");
}

export function opencodeEvent(input: OpencodeRelayInput): HubEvent | null {
  const { type } = input.event;
  const properties = isRecord(input.event.properties) ? input.event.properties : {};
  const sessionId = str(properties.sessionID);
  if (sessionId === undefined) return null;
  const base = { agent: "opencode", sessionId, ...(input.directory ? { cwd: input.directory } : {}) };

  switch (type) {
    case "session.idle":
      return { ...base, kind: "done", summary: input.summary ?? "OpenCode finished its turn." };
    case "session.status": {
      const status = isRecord(properties.status) ? properties.status.type : undefined;
      return status === "busy" ? { ...base, kind: "working" } : null;
    }
    case "permission.asked": {
      const tool = str(properties.permission) ?? "a tool";
      return {
        ...base,
        kind: "permission",
        tool,
        detail: describePermission(properties),
        summary: `OpenCode wants to use ${tool}`,
      };
    }
    case "question.asked":
      return {
        ...base,
        kind: "question",
        tool: "question",
        detail: describeQuestions(questionsOf(properties)),
        summary: "OpenCode has a question for you",
      };
    // Answered in the TUI: close the inbox card.
    case "permission.replied":
    case "question.replied":
    case "question.rejected":
      return { ...base, kind: "working" };
    case "session.deleted":
      return { ...base, kind: "ended" };
    default:
      return null;
  }
}

/** A spoken answer that names an option ("postgres please") picks that option. */
export function matchOption(text: string, options: readonly string[]): string {
  const spoken = text.trim().toLowerCase().replace(/[.!?]+$/u, "");
  const exact = options.find((option) => option.toLowerCase() === spoken);
  if (exact !== undefined) return exact;
  const mentioned = options.filter((option) => spoken.includes(option.toLowerCase()));
  return mentioned.length === 1 && mentioned[0] !== undefined ? mentioned[0] : text.trim();
}

export function opencodeAction(input: OpencodeRelayInput, reply: Reply | null): OpencodeAction {
  const none: OpencodeAction = { action: "none" };
  if (reply === null || reply.decision === "terminal") return none;
  const properties = isRecord(input.event.properties) ? input.event.properties : {};

  switch (input.event.type) {
    case "session.idle": {
      const sessionID = str(properties.sessionID);
      return reply.text && sessionID ? { action: "prompt", sessionID, text: reply.text } : none;
    }
    case "permission.asked": {
      const requestID = str(properties.id);
      if (requestID === undefined) return none;
      if (reply.decision === "allow") return { action: "permission", requestID, reply: "once" };
      if (reply.decision !== "deny" && !reply.text) return none;
      return reply.text
        ? { action: "permission", requestID, reply: "reject", message: reply.text }
        : { action: "permission", requestID, reply: "reject" };
    }
    case "question.asked": {
      const requestID = str(properties.id);
      if (requestID === undefined || !reply.text) return none;
      const text = reply.text;
      const answers = questionsOf(properties).map((question) => [matchOption(text, question.options)]);
      return { action: "question", requestID, answers: answers.length > 0 ? answers : [[text]] };
    }
    default:
      return none;
  }
}

/**
 * The plugin file `clidev hooks --opencode` installs. It stays thin on
 * purpose: the mapping above is tested TypeScript, the plugin only forwards
 * events and performs the returned action. `command` is the absolute
 * node + clidev script captured at install time.
 */
export function renderOpencodePlugin(command: readonly string[]): string {
  return `// clidev → OpenCode plugin. Installed by \`clidev hooks --opencode\`; remove with
// \`clidev hooks --opencode --remove\`. Forwards OpenCode events to the clidev
// inbox and performs your replies through OpenCode's own API.
import { spawn } from "node:child_process";

const COMMAND = ${JSON.stringify(command)};
const FORWARD = new Set([
  "session.idle", "session.status", "session.deleted",
  "permission.asked", "permission.replied",
  "question.asked", "question.replied", "question.rejected",
]);

function relay(type, payload) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(COMMAND[0], [...COMMAND.slice(1), "relay", "opencode", type], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      return resolve(null);
    }
    child.on("error", () => resolve(null));
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => {
      try { resolve(out.trim() ? JSON.parse(out) : null); } catch { resolve(null); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export default {
  id: "clidev",
  server: async ({ client, directory }) => {
    const raw = client._client;
    const parents = new Map();
    // Sessions with an open "finished" card; going busy again means you
    // answered in the TUI. Permission and question cards close on *.replied.
    const idle = new Set();

    async function isTopLevel(sessionID) {
      if (!parents.has(sessionID)) {
        try {
          const res = await client.session.get({ path: { id: sessionID } });
          parents.set(sessionID, Boolean(res?.data?.parentID));
        } catch {
          parents.set(sessionID, false);
        }
      }
      return !parents.get(sessionID);
    }

    async function lastAssistantText(sessionID) {
      try {
        const res = await client.session.messages({ path: { id: sessionID } });
        const messages = Array.isArray(res?.data) ? res.data : [];
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const message = messages[i];
          if (message?.info?.role !== "assistant") continue;
          const text = (message.parts || []).filter((p) => p?.type === "text" && p.text).map((p) => p.text).join("\\n");
          if (text.trim()) return text;
        }
      } catch {}
      return undefined;
    }

    async function perform(action) {
      if (!action || action.action === "none") return;
      if (action.action === "prompt") {
        await client.session.promptAsync({ path: { id: action.sessionID }, body: { parts: [{ type: "text", text: action.text }] } });
      } else if (action.action === "permission") {
        const body = action.message ? { reply: action.reply, message: action.message } : { reply: action.reply };
        await raw.post({ url: "/permission/{requestID}/reply", path: { requestID: action.requestID }, body, headers: { "Content-Type": "application/json" } });
      } else if (action.action === "question") {
        await raw.post({ url: "/question/{requestID}/reply", path: { requestID: action.requestID }, body: { answers: action.answers }, headers: { "Content-Type": "application/json" } });
      }
    }

    return {
      event: async ({ event }) => {
        try {
          if (!event || !FORWARD.has(event.type)) return;
          const sessionID = event.properties?.sessionID;
          if (!sessionID || !(await isTopLevel(sessionID))) return;

          if (event.type === "session.status") {
            if (event.properties?.status?.type !== "busy" || !idle.has(sessionID)) return;
            idle.delete(sessionID);
          }
          if (event.type === "session.idle") idle.add(sessionID);

          const payload = { event: { type: event.type, properties: event.properties }, directory };
          if (event.type === "session.idle") payload.summary = await lastAssistantText(sessionID);
          const action = await relay(event.type, payload);
          if (action && action.action !== "none") {
            if (action.action === "prompt") idle.delete(sessionID);
            await perform(action);
          }
        } catch {
          // Never break OpenCode: a failed relay behaves like no plugin at all.
        }
      },
    };
  },
};
`;
}
