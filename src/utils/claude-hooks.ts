export type JsonRecord = Record<string, unknown>;

export interface HookCommands {
  stop: string;
  notification: string;
}

export interface HookMergeResult {
  settings: JsonRecord;
  added: number;
  updated: number;
}

export interface HookRemoveResult {
  settings: JsonRecord;
  removed: number;
}

export const CLAUDE_HOOK_EVENTS = ["Stop", "Notification"] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  return structuredClone(value);
}

/** True when a hook command is one of ours, regardless of absolute install path. */
export function isClidevCommand(command: string): boolean {
  return /\bclidev\b/u.test(command) || /[\\/]dist[\\/]index\.js/u.test(command);
}

function shellQuote(value: string): string {
  // Double quotes are meaningful inside cmd.exe, so we normalise them away.
  return value.replace(/"/gu, "'");
}

export function buildNotifyCommand(bin: string, title: string, message: string): string {
  return `${bin} notify --title "${shellQuote(title)}" --message "${shellQuote(message)}"`;
}

/**
 * Idempotent merge: existing clidev entries are updated in place, everything
 * else in the file is preserved byte-for-byte after a JSON round-trip.
 */
export function mergeClaudeHooks(input: unknown, commands: HookCommands): HookMergeResult {
  const settings = cloneRecord(input);
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  if (hooks !== settings.hooks) settings.hooks = hooks;

  let added = 0;
  let updated = 0;

  const upsert = (event: string, command: string): void => {
    const list = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    let found = false;

    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const inner = Array.isArray(entry.hooks) ? entry.hooks : [];
      for (const hook of inner) {
        if (!isRecord(hook)) continue;
        if (typeof hook.command !== "string" || !isClidevCommand(hook.command)) continue;
        found = true;
        hook.type = "command";
        if (hook.command !== command) {
          hook.command = command;
          updated += 1;
        }
      }
    }

    if (!found) {
      list.push({ hooks: [{ type: "command", command, timeout: 10 }] });
      added += 1;
    }
    hooks[event] = list;
  };

  upsert("Stop", commands.stop);
  upsert("Notification", commands.notification);

  return { settings, added, updated };
}

export function removeClidevHooks(input: unknown): HookRemoveResult {
  const settings = cloneRecord(input);
  const hooks = isRecord(settings.hooks) ? settings.hooks : null;
  if (!hooks) return { settings, removed: 0 };

  let removed = 0;

  for (const event of Object.keys(hooks)) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;

    const kept: unknown[] = [];
    for (const entry of list) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
        kept.push(entry);
        continue;
      }

      const inner = entry.hooks.filter(
        (hook) =>
          !(isRecord(hook) && typeof hook.command === "string" && isClidevCommand(hook.command)),
      );
      removed += entry.hooks.length - inner.length;
      if (inner.length > 0) kept.push({ ...entry, hooks: inner });
    }

    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }

  return { settings, removed };
}

export function hasClidevHooks(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.hooks)) return false;
  return Object.values(input.hooks).some(
    (list) =>
      Array.isArray(list) &&
      list.some(
        (entry) =>
          isRecord(entry) &&
          Array.isArray(entry.hooks) &&
          entry.hooks.some(
            (hook) =>
              isRecord(hook) && typeof hook.command === "string" && isClidevCommand(hook.command),
          ),
      ),
  );
}
