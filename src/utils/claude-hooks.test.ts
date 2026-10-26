import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotifyCommand,
  hasClidevHooks,
  isClidevCommand,
  mergeClaudeHooks,
  notifyHookSpecs,
  relayHookSpecs,
  removeClidevHooks,
} from "./claude-hooks.js";

const COMMANDS = {
  stop: 'clidev notify --title "Claude Code" --message "Task finished"',
  notification: 'clidev notify --title "Claude Code" --message "Waiting for your input"',
};
const SPECS = notifyHookSpecs("clidev");
const RELAY = relayHookSpecs("clidev", { Stop: 900, PermissionRequest: 600 });

type HookFile = Record<string, Array<{ hooks: Array<{ command: string; timeout?: number }> }>>;

test("buildNotifyCommand produces a shell-safe command", () => {
  assert.equal(
    buildNotifyCommand("clidev", "Claude Code", "Say \"hi\""),
    'clidev notify --title "Claude Code" --message "Say \'hi\'"',
  );
});

test("isClidevCommand recognises alias and absolute installs", () => {
  assert.equal(isClidevCommand("clidev notify --title x"), true);
  assert.equal(isClidevCommand('node "C:/tools/clidev/dist/index.js" notify'), true);
  assert.equal(isClidevCommand("npm run lint"), false);
});

test("mergeClaudeHooks adds both events to an empty settings file", () => {
  const result = mergeClaudeHooks({}, SPECS);
  assert.equal(result.added, 2);
  assert.equal(result.updated, 0);
  assert.equal(hasClidevHooks(result.settings), true);

  const hooks = result.settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  assert.equal(hooks.Stop?.[0]?.hooks[0]?.command, COMMANDS.stop);
  assert.equal(hooks.Notification?.[0]?.hooks[0]?.command, COMMANDS.notification);
});

test("mergeClaudeHooks is idempotent", () => {
  const first = mergeClaudeHooks({}, SPECS).settings;
  const second = mergeClaudeHooks(first, SPECS);

  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.removed, 0);
  assert.deepEqual(second.settings, first);
});

test("mergeClaudeHooks preserves unrelated settings and hooks", () => {
  const existing = {
    model: "opus",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo before" }] }],
      Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }],
    },
  };

  const result = mergeClaudeHooks(existing, SPECS);
  const settings = result.settings as typeof existing;

  assert.equal(settings.model, "opus");
  assert.equal(settings.hooks.PreToolUse?.[0]?.matcher, "Bash");
  assert.equal(settings.hooks.Stop?.length, 2);
  assert.equal(result.added, 2);
});

test("mergeClaudeHooks rewrites a stale clidev command in place", () => {
  const existing = {
    hooks: { Stop: [{ hooks: [{ type: "command", command: "clidev notify --old" }] }] },
  };
  const result = mergeClaudeHooks(existing, SPECS);
  const stop = result.settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;

  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(stop.Stop?.[0]?.hooks[0]?.command, COMMANDS.stop);
});

test("removeClidevHooks strips only our entries", () => {
  const existing = {
    hooks: {
      Stop: [
        { hooks: [{ type: "command", command: "notify-send done" }] },
        { hooks: [{ type: "command", command: "clidev notify --title x" }] },
      ],
      Notification: [{ hooks: [{ type: "command", command: "clidev notify --title y" }] }],
    },
  };

  const result = removeClidevHooks(existing);
  const hooks = result.settings.hooks as Record<string, Array<{ hooks: unknown[] }>>;

  assert.equal(result.removed, 2);
  assert.equal(hooks.Stop?.length, 1);
  assert.equal("Notification" in hooks, false);
  assert.equal(hasClidevHooks(result.settings), false);
});

test("removing from a file without hooks is a no-op", () => {
  const result = removeClidevHooks({ model: "sonnet" });
  assert.equal(result.removed, 0);
  assert.deepEqual(result.settings, { model: "sonnet" });
});

test("relayHookSpecs routes every event through clidev relay with room to wait", () => {
  const byEvent = Object.fromEntries(RELAY.map((spec) => [spec.event, spec]));
  assert.equal(byEvent.Stop?.command, "clidev relay claude Stop");
  assert.equal(byEvent.Stop?.timeout, 960);
  assert.equal(byEvent.PermissionRequest?.timeout, 660);
  assert.equal(byEvent.UserPromptSubmit?.timeout, 10);
  assert.ok(RELAY.every((spec) => isClidevCommand(spec.command)));
});

test("switching from notify-only to relay replaces our hooks and keeps the user's", () => {
  const existing = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }],
    },
  };
  const notifyOnly = mergeClaudeHooks(existing, SPECS).settings;
  const relay = mergeClaudeHooks(notifyOnly, RELAY);
  const hooks = relay.settings.hooks as HookFile;

  assert.equal(relay.updated, 2); // Stop + Notification rewritten in place
  assert.equal(relay.added, 3); // UserPromptSubmit, PermissionRequest, SessionEnd
  assert.equal(relay.removed, 0);
  assert.equal(hooks.Stop?.[0]?.hooks[0]?.command, "notify-send done");
  assert.equal(hooks.Stop?.[1]?.hooks[0]?.command, "clidev relay claude Stop");
  assert.equal(hooks.Stop?.[1]?.hooks[0]?.timeout, 960);
});

test("switching back to notify-only drops relay-only events", () => {
  const relay = mergeClaudeHooks({}, RELAY).settings;
  const back = mergeClaudeHooks(relay, SPECS);
  const hooks = back.settings.hooks as HookFile;

  assert.equal(back.removed, 3);
  assert.deepEqual(Object.keys(hooks).sort(), ["Notification", "Stop"]);
  assert.equal(hooks.Stop?.[0]?.hooks[0]?.command, COMMANDS.stop);
});
