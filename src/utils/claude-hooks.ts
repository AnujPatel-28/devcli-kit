export type JsonRecord = Record<string, unknown>;

/** One hook clidev owns inside Claude Code's settings.json. */
export interface ClaudeHookSpec {
  event: string;
  command: string;
  /** Seconds Claude Code lets the hook run. */
  timeout: number;
}

export interface HookMergeResult {
  settings: JsonRecord;
  added: number;
  updated: number;
  /** clidev hooks on events this install no longer uses (e.g. switching modes). */
  removed: number;
}

export interface HookRemoveResult {
  settings: JsonRecord;
  removed: number;
}


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

/** Notify-only mode: a toast when Claude stops or waits, nothing more. */
export function notifyHookSpecs(bin: string): ClaudeHookSpec[] {
  return [
    { event: "Stop", command: buildNotifyCommand(bin, "Claude Code", "Task finished"), timeout: 10 },
    {
      event: "Notification",
      command: buildNotifyCommand(bin, "Claude Code", "Waiting for your input"),
      timeout: 10,
    },
  ];
}

/**
 * Reply mode: every lifecycle event goes to the hub. Stop and PermissionRequest
 * wait for your answer, so their timeout is the relay's wait plus headroom.
 */
export function relayHookSpecs(bin: string, waits: { Stop: number; PermissionRequest: number }): ClaudeHookSpec[] {
  const relay = (event: string): string => `${bin} relay claude ${event}`;
  return [
    { event: "UserPromptSubmit", command: relay("UserPromptSubmit"), timeout: 10 },
    { event: "Stop", command: relay("Stop"), timeout: waits.Stop + 60 },
    { event: "PermissionRequest", command: relay("PermissionRequest"), timeout: waits.PermissionRequest + 60 },
    { event: "Notification", command: relay("Notification"), timeout: 10 },
    { event: "SessionEnd", command: relay("SessionEnd"), timeout: 10 },
  ];
}

/**
 * Idempotent merge: existing clidev entries are updated in place, clidev
 * entries on events outside `specs` are dropped, and everything else in the
 * file is preserved byte-for-byte after a JSON round-trip.
 */
export function mergeClaudeHooks(input: unknown, specs: readonly ClaudeHookSpec[]): HookMergeResult {
  const wanted = new Set(specs.map((spec) => spec.event));
  const stale = removeClidevHooks(input, (event) => !wanted.has(event));
  const settings = stale.settings;
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  if (hooks !== settings.hooks) settings.hooks = hooks;

  let added = 0;
  let updated = 0;

  for (const spec of specs) {
    const list = Array.isArray(hooks[spec.event]) ? (hooks[spec.event] as unknown[]) : [];
    let found = false;

    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const inner = Array.isArray(entry.hooks) ? entry.hooks : [];
      for (const hook of inner) {
        if (!isRecord(hook)) continue;
        if (typeof hook.command !== "string" || !isClidevCommand(hook.command)) continue;
        found = true;
        hook.type = "command";
        if (hook.command !== spec.command || hook.timeout !== spec.timeout) {
          hook.command = spec.command;
          hook.timeout = spec.timeout;
          updated += 1;
        }
      }
    }

    if (!found) {
      list.push({ hooks: [{ type: "command", command: spec.command, timeout: spec.timeout }] });
      added += 1;
    }
    hooks[spec.event] = list;
  }

  return { settings, added, updated, removed: stale.removed };
}

export function removeClidevHooks(
  input: unknown,
  inEvent: (event: string) => boolean = () => true,
): HookRemoveResult {
  const settings = cloneRecord(input);
  const hooks = isRecord(settings.hooks) ? settings.hooks : null;
  if (!hooks) return { settings, removed: 0 };

  let removed = 0;

  for (const event of Object.keys(hooks)) {
    if (!inEvent(event)) continue;
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
