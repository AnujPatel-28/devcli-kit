import { spawn } from "node:child_process";

import { Command } from "commander";

import { CliError } from "../utils/errors.js";
import { formatDuration } from "../utils/format.js";
import { info, payload, success, warn } from "../utils/logger.js";
import { sendNotification } from "../utils/notifier.js";

interface WatchOptions {
  title?: string;
  sound?: boolean;
  bell?: boolean;
  onlyFail?: boolean;
  quiet?: boolean;
  json?: boolean;
}

interface WatchResult {
  command: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  durationMs: number;
  notified: boolean;
  delivered: boolean;
  via: string;
}

function quoteIfNeeded(part: string): string {
  // Multi-part argv loses its original quoting; re-wrap anything with spaces so
  // the shell sees the same argument the user typed.
  return /\s/u.test(part) && !part.includes('"') ? `"${part}"` : part;
}

export function normaliseWatchCommand(command: string[]): string {
  const parts = command.map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] ?? "";
  return parts.map(quoteIfNeeded).join(" ");
}

export async function runWatched(command: string[], options: WatchOptions): Promise<number> {
  const commandLine = normaliseWatchCommand(command);
  if (commandLine.length === 0) {
    throw new CliError("Nothing to watch.", 2, ['Try: clidev watch "npm run build"']);
  }

  const startedAt = performance.now();
  const child = spawn(commandLine, {
    shell: true,
    stdio: "inherit",
    // A POSIX process group lets us forward Ctrl+C to the whole pipeline.
    detached: process.platform !== "win32",
  });

  let interrupted: NodeJS.Signals | null = null;

  const forward = (signal: NodeJS.Signals): void => {
    interrupted = signal;
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      try {
        child.kill(signal);
      } catch {
        // The child already exited; nothing to forward.
      }
    }
  };

  const onInterrupt = (): void => forward("SIGINT");
  const onTerminate = (): void => forward("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  const spawnState: { error: Error | null } = { error: null };
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("error", (error) => {
        spawnState.error = error;
        resolve({ code: 127, signal: null });
      });
      child.on("close", (code, signal) => resolve({ code, signal }));
    },
  );

  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);

  if (spawnState.error) {
    throw new CliError(`Could not start the command: ${spawnState.error.message}`, 127);
  }

  const durationMs = performance.now() - startedAt;
  const signalled = outcome.code === null && outcome.signal !== null;
  const exitCode = signalled ? (outcome.signal === "SIGINT" ? 130 : 143) : (outcome.code ?? 1);
  const succeeded = exitCode === 0;

  const suffix = interrupted ? ` · interrupted with ${interrupted}` : "";
  const message = `${commandLine} ${succeeded ? "finished" : "failed"} in ${formatDuration(
    durationMs,
  )} (exit ${exitCode})${suffix}`;

  const shouldNotify = options.onlyFail !== true || !succeeded;
  let delivered = false;
  let via = "none";

  if (shouldNotify) {
    const result = await sendNotification({
      title: options.title ?? "clidev watch",
      message,
      sound: options.sound === true,
      bell: options.bell !== false,
    });
    delivered = result.delivered;
    via = result.via;
  }

  const summary: WatchResult = {
    command: commandLine,
    exitCode,
    signal: outcome.signal,
    durationMs: Math.round(durationMs),
    notified: shouldNotify,
    delivered,
    via,
  };

  if (options.json === true) {
    payload(JSON.stringify(summary, null, 2));
    return exitCode;
  }

  if (options.quiet !== true) {
    if (succeeded) success(`${commandLine} finished in ${formatDuration(durationMs)}`);
    else warn(`${commandLine} exited ${exitCode} after ${formatDuration(durationMs)}`);

    if (!shouldNotify) info("notification suppressed by --only-fail");
    else if (delivered) info(`notification delivered via ${via}`);
    else info("notification blocked — terminal bell still fired");
  }

  return exitCode;
}

export function createWatchCommand(): Command {
  return new Command("watch")
    .description("Run a command and get a desktop notification when it finishes or fails")
    .argument("<command...>", "command to run (quote it, or use -- for pipes and flags)")
    .option("-t, --title <title>", "notification title", "clidev watch")
    .option("--sound", "ask the OS to play the notification sound")
    .option("--no-bell", "do not ring the terminal bell")
    .option("--only-fail", "stay silent when the command succeeds")
    .option("--quiet", "do not print the completion summary")
    .option("--json", "emit machine-readable JSON on stdout")
    .addHelpText(
      "after",
      `
Examples:
  $ clidev watch "npm run build"
  $ clidev watch "claude -p 'fix the failing tests'" --title "Claude Code"
  $ clidev watch -- npm test -- --watch=false
  $ clidev watch "pnpm e2e" --only-fail --sound

Exit code is the wrapped command's exit code, so CI and shell scripts behave.`,
    )
    .action(async (command: string[], options: WatchOptions) => {
      process.exitCode = await runWatched(command, options);
    });
}
