import assert from "node:assert/strict";
import test from "node:test";

import { claudeEvent, claudeOutput, describeToolInput, lastAssistantText } from "./claude.js";

const BASE = { session_id: "abc", cwd: "/work/shop-api", transcript_path: "/tmp/t.jsonl" };

test("Stop uses last_assistant_message when Claude provides it", () => {
  const event = claudeEvent({ ...BASE, hook_event_name: "Stop", last_assistant_message: "All 12 tests pass." });
  assert.deepEqual(event, {
    agent: "claude",
    sessionId: "abc",
    cwd: "/work/shop-api",
    kind: "done",
    summary: "All 12 tests pass.",
  });
});

test("Stop falls back to the transcript tail", () => {
  const tail = [
    '{"type":"user","message":{"content":"fix it"}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Fixed the parser."},{"type":"tool_use","name":"Bash"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}',
  ].join("\n");
  assert.equal(claudeEvent({ ...BASE, hook_event_name: "Stop" }, tail)?.summary, "Fixed the parser.");
});

test("lastAssistantText ignores a half line at the start of the tail", () => {
  const tail = 'ntent":"cut"}}\n{"type":"assistant","message":{"content":"done"}}\n';
  assert.equal(lastAssistantText(tail), "done");
  assert.equal(lastAssistantText(""), undefined);
});

test("PermissionRequest becomes a permission ask with the command", () => {
  const event = claudeEvent({
    ...BASE,
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "npm publish", description: "Publish" },
  });
  assert.equal(event?.kind, "permission");
  assert.equal(event?.tool, "Bash");
  assert.equal(event?.detail, "npm publish");
});

test("AskUserQuestion becomes a question with its options", () => {
  const event = claudeEvent({
    ...BASE,
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [{ question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] }],
    },
  });
  assert.equal(event?.kind, "question");
  assert.equal(event?.detail, "Which database? (Postgres / SQLite)");
});

test("other events map to working, notice and ended", () => {
  assert.equal(claudeEvent({ ...BASE, hook_event_name: "UserPromptSubmit", prompt: "go" })?.kind, "working");
  assert.equal(claudeEvent({ ...BASE, hook_event_name: "Notification", message: "idle" })?.kind, "notice");
  assert.equal(claudeEvent({ ...BASE, hook_event_name: "SessionEnd" })?.kind, "ended");
  assert.equal(claudeEvent({ ...BASE, hook_event_name: "PreCompact" }), null);
  assert.equal(claudeEvent("nonsense"), null);
});

test("describeToolInput picks the field a human cares about", () => {
  assert.equal(describeToolInput("Edit", { file_path: "src/a.ts", old_string: "x" }), "src/a.ts");
  assert.equal(describeToolInput("WebFetch", { url: "https://example.com" }), "https://example.com");
  assert.equal(describeToolInput("Mystery", { a: 1 }), '{"a":1}');
});

test("a spoken reply to Stop makes Claude continue", () => {
  assert.deepEqual(claudeOutput("Stop", { text: "now commit it" }), { decision: "block", reason: "now commit it" });
  assert.equal(claudeOutput("Stop", { decision: "terminal" }), null);
  assert.equal(claudeOutput("Stop", null), null);
});

test("permission replies map to allow and deny with a message", () => {
  assert.deepEqual(claudeOutput("PermissionRequest", { decision: "allow" }), {
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
  });

  const denied = claudeOutput("PermissionRequest", { decision: "deny", text: "use npm run clean" }) as {
    hookSpecificOutput: { decision: { behavior: string; message: string } };
  };
  assert.equal(denied.hookSpecificOutput.decision.behavior, "deny");
  assert.match(denied.hookSpecificOutput.decision.message, /use npm run clean/u);

  assert.equal(claudeOutput("PermissionRequest", { decision: "terminal" }), null);
  assert.equal(claudeOutput("Notification", { text: "hi" }), null);
});
