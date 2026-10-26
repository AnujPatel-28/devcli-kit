import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotifyCommand,
  hasClidevHooks,
  isClidevCommand,
  mergeClaudeHooks,
  removeClidevHooks,
} from "./claude-hooks.js";

const COMMANDS = {
  stop: 'clidev notify --title "Claude Code" --message "Task finished"',
  notification: 'clidev notify --title "Claude Code" --message "Waiting for your input"',
};

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
  const result = mergeClaudeHooks({}, COMMANDS);
  assert.equal(result.added, 2);
  assert.equal(result.updated, 0);
  assert.equal(hasClidevHooks(result.settings), true);

  const hooks = result.settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  assert.equal(hooks.Stop?.[0]?.hooks[0]?.command, COMMANDS.stop);
  assert.equal(hooks.Notification?.[0]?.hooks[0]?.command, COMMANDS.notification);
});

test("mergeClaudeHooks is idempotent", () => {
  const first = mergeClaudeHooks({}, COMMANDS).settings;
  const second = mergeClaudeHooks(first, COMMANDS);

  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
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

  const result = mergeClaudeHooks(existing, COMMANDS);
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
  const result = mergeClaudeHooks(existing, COMMANDS);
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
