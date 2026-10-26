import { spawnSync } from "node:child_process";
import path from "node:path";

const commandCache = new Map<string, boolean>();

/** Cheap, cached `which`/`where` lookup. Never throws, never uses a shell. */
export function hasCommand(command: string): boolean {
  const cached = commandCache.get(command);
  if (cached !== undefined) return cached;

  const locator = process.platform === "win32" ? "where" : "which";
  let found = false;
  try {
    const result = spawnSync(locator, [command], {
      stdio: "ignore",
      timeout: 4_000,
      windowsHide: true,
    });
    found = result.status === 0;
  } catch {
    found = false;
  }
  commandCache.set(command, found);
  return found;
}

/**
 * Quotes for the two shells our hook commands may run in. Node's own `execPath`
 * and the absolute script path are the only things we ever quote, so a plain
 * double-quote wrap is enough.
 */
export function quoteArg(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value;
}

/**
 * Hooks outlive the current shell, so they need a command that still resolves
 * later: the global `clidev` binary when it exists, otherwise an absolute
 * `node <dist/index.js>` invocation.
 */
export function resolveCliInvocation(): string {
  const override = process.env.CLIDEV_BIN?.trim();
  if (override) return override;
  if (hasCommand("clidev")) return "clidev";

  const script = process.argv[1];
  if (script) {
    return `${quoteArg(process.execPath)} ${quoteArg(path.resolve(script))}`;
  }
  return "clidev";
}
