import assert from "node:assert/strict";
import test from "node:test";

import { computeStats, projectName, shortSummary, type HistoryRecord } from "./protocol.js";
import { HubStore } from "./store.js";

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

const DONE = { agent: "claude", sessionId: "s1", kind: "done", cwd: "/work/shop-api", summary: "Added tests" } as const;

test("an ask keeps the agent's full message, line breaks included", () => {
  const store = new HubStore();
  const message = "Done.\n\n- renamed page_size\n- **all** tests pass";
  const { ask, session } = store.report({ ...DONE, summary: message });
  assert.equal(ask?.summary, message);
  assert.equal(session.summary, "Done. - renamed page_size - all tests pass");
});

test("a done event opens an ask and marks the session done", () => {
  const store = new HubStore();
  const { ask, session } = store.report(DONE);

  assert.ok(ask);
  assert.equal(ask.kind, "done");
  assert.equal(ask.project, "shop-api");
  assert.equal(session.state, "done");
  assert.equal(store.snapshot().asks.length, 1);
});

test("a reply resolves a waiting reporter and records history", async () => {
  const time = clock();
  const records: HistoryRecord[] = [];
  const store = new HubStore({ now: time.now, onRecord: (record) => records.push(record) });
  const { ask } = store.report(DONE);
  assert.ok(ask);

  const pending = store.waitFor(ask.id, 10_000);
  time.advance(42_000);
  assert.equal(store.reply(ask.id, { text: "  now add the empty-input test  " }), true);

  assert.deepEqual(await pending, { text: "now add the empty-input test" });
  assert.equal(records[0]?.waitMs, 42_000);
  assert.equal(records[0]?.words, 5);
  assert.equal(store.snapshot().asks.length, 0);
  assert.equal(store.snapshot().sessions[0]?.state, "working");
});

test("a reply that lands between two waits is still delivered", async () => {
  const store = new HubStore();
  const { ask } = store.report(DONE);
  assert.ok(ask);
  store.reply(ask.id, { decision: "allow" });
  assert.deepEqual(await store.waitFor(ask.id, 10), { decision: "allow" });
});

test("a second reply to the same ask is refused", () => {
  const store = new HubStore();
  const { ask } = store.report(DONE);
  assert.ok(ask);
  assert.equal(store.reply(ask.id, { text: "go" }), true);
  assert.equal(store.reply(ask.id, { text: "again" }), false);
});

test("new activity supersedes an open ask without counting it", async () => {
  const records: HistoryRecord[] = [];
  const store = new HubStore({ onRecord: (record) => records.push(record) });
  const { ask } = store.report(DONE);
  assert.ok(ask);
  const pending = store.waitFor(ask.id, 10_000);

  store.report({ agent: "claude", sessionId: "s1", kind: "working", summary: "typed in the terminal" });

  assert.equal(await pending, null);
  assert.equal(records.length, 0);
  assert.equal(store.snapshot().sessions[0]?.state, "working");
});

test("a notice does not replace a richer open ask", () => {
  const store = new HubStore();
  const { ask } = store.report({ ...DONE, kind: "permission", tool: "Bash", detail: "rm -rf dist" });
  const result = store.report({ agent: "claude", sessionId: "s1", kind: "notice", summary: "Claude needs permission" });

  assert.equal(result.ask, undefined);
  assert.equal(store.snapshot().asks[0]?.id, ask?.id);
});

test("expire records the miss and frees waiters", async () => {
  const records: HistoryRecord[] = [];
  const store = new HubStore({ onRecord: (record) => records.push(record) });
  const { ask } = store.report(DONE);
  assert.ok(ask);
  const pending = store.waitFor(ask.id, 10_000);
  store.expire(ask.id);

  assert.equal(await pending, null);
  assert.equal(records[0]?.outcome, "expired");
});

test("ended sessions leave the session list", () => {
  const store = new HubStore();
  store.report(DONE);
  store.report({ agent: "claude", sessionId: "s1", kind: "ended" });
  assert.equal(store.snapshot().sessions.length, 0);
});

test("sessions from different agents are tracked separately", () => {
  const store = new HubStore();
  store.report(DONE);
  store.report({ agent: "opencode", sessionId: "s1", kind: "working", cwd: "C:\\code\\web" });
  const projects = store.snapshot().sessions.map((session) => `${session.agent}:${session.project}`);
  assert.deepEqual(projects.sort(), ["claude:shop-api", "opencode:web"]);
});

test("computeStats reports the median reply and words answered", () => {
  const base = { at: 0, agent: "claude", kind: "done" } as const;
  const stats = computeStats([
    { ...base, outcome: "answered", waitMs: 30_000, words: 6 },
    { ...base, outcome: "answered", waitMs: 50_000, words: 4 },
    { ...base, agent: "opencode", outcome: "answered", waitMs: 90_000, words: 0 },
    { ...base, outcome: "expired", waitMs: 900_000, words: 0 },
  ]);
  assert.equal(stats.asks, 4);
  assert.equal(stats.answered, 3);
  assert.equal(stats.medianReplyMs, 50_000);
  assert.equal(stats.wordsReplied, 10);
  assert.deepEqual(stats.agents, ["claude", "opencode"]);
});

test("helpers flatten summaries and name projects on any OS", () => {
  assert.equal(projectName("C:\\Users\\me\\code\\api\\"), "api");
  assert.equal(projectName(undefined), "unknown project");
  assert.equal(shortSummary("## Done\n\n**All** tests pass\n```ts\nx\n```"), "Done All tests pass [code]");
  assert.equal(shortSummary("a".repeat(20), 10).length, 10);
  assert.equal(shortSummary("Renamed page_size in __init__ and *args"), "Renamed page_size in __init__ and *args");
  assert.equal(shortSummary("> note\n# Title"), "note Title");
});
