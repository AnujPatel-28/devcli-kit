import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";

import {
  buildNotifyCommand,
  mergeClaudeHooks,
  removeClidevHooks,
  type JsonRecord,
} from "../utils/claude-hooks.js";
import { CliError, isErrnoException } from "../utils/errors.js";
import { box, hint, note, payload, setMachineOutput, success, warn } from "../utils/logger.js";
import { expandHome, screenshotTimestamp } from "../utils/paths.js";
import { resolveCliInvocation } from "../utils/shell.js";

interface HooksOptions {
  claude?: boolean;
  remove?: boolean;
  dryRun?: boolean;
  backup?: boolean;
  command?: string;
}

function claudeSettingsPath(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  const directory = configured
    ? path.resolve(expandHome(configured))
    : path.join(os.homedir(), ".claude");
  return path.join(directory, "settings.json");
}

async function readSettings(settingsPath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return {};
    throw new CliError(
      `Could not read ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (raw.trim().length === 0) return {};

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CliError(`${settingsPath} is not valid JSON — refusing to modify it.`, 1, [
      "Fix the file by hand, or run with --dry-run to inspect the planned change.",
    ]);
  }
}

async function writeSettings(
  settingsPath: string,
  settings: JsonRecord,
  options: { backup: boolean },
): Promise<string | null> {
  await mkdir(path.dirname(settingsPath), { recursive: true });

  let backupPath: string | null = null;
  if (options.backup) {
    const candidate = `${settingsPath}.bak-${screenshotTimestamp()}`;
    try {
      await copyFile(settingsPath, candidate);
      backupPath = candidate;
    } catch (error) {
      if (!(isErrnoException(error) && error.code === "ENOENT")) throw error;
    }
  }

  // Write next to the target then rename, so a crash can never truncate config.
  const temporaryPath = `${settingsPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, settingsPath);

  return backupPath;
}

function printIntegrationGuide(): void {
  note("Wire the same alerts into every other agent", [
    "Antigravity CLI   clidev watch \"agy --print 'fix the failing tests'\" --title Antigravity",
    'OpenCode          clidev watch "opencode" --title OpenCode',
    "Aider             clidev watch \"aider --message 'refactor auth'\" --title Aider",
    'Any long build    clidev watch "npm run build" --sound',
    "",
    "Shell alias       alias cc='clidev watch \"claude\" --title \"Claude Code\"'",
    'Manual ping       clidev notify --title Done --message "tests passed"',
  ]);
}

export function createHooksCommand(): Command {
  return new Command("hooks")
    .description("Install lifecycle notification hooks into your AI CLI tools")
    .option("--claude", "inject Stop + Notification hooks into ~/.claude/settings.json")
    .option("--remove", "remove clidev hooks instead of installing them")
    .option("--dry-run", "print the resulting settings.json without writing it")
    .option("--no-backup", "skip the timestamped settings.json backup")
    .option("--command <bin>", "override the clidev binary the hooks should call")
    .addHelpText(
      "after",
      `
Examples:
  $ clidev hooks --claude
  $ clidev hooks --claude --dry-run        inspect the JSON first
  $ clidev hooks --claude --remove         undo, keeping your other hooks
  $ clidev hooks                           show wiring guides for other agents

Writes are atomic, idempotent, and never touch an invalid settings.json.`,
    )
    .action(async (options: HooksOptions) => {
      setMachineOutput(options.dryRun === true);
      const bin = options.command?.trim() ?? "";
      const executable = bin.length > 0 ? bin : resolveCliInvocation();
      const commands = {
        stop: buildNotifyCommand(executable, "Claude Code", "Task finished"),
        notification: buildNotifyCommand(executable, "Claude Code", "Waiting for your input"),
      };

      if (options.remove === true) {
        const settingsPath = claudeSettingsPath();
        const parsed = await readSettings(settingsPath);
        const result = removeClidevHooks(parsed);

        if (options.dryRun === true) {
          payload(JSON.stringify(result.settings, null, 2));
          return;
        }
        if (result.removed === 0) {
          warn(`no clidev hooks found in ${settingsPath}`);
          return;
        }

        const backup = await writeSettings(settingsPath, result.settings, {
          backup: options.backup !== false,
        });
        success(`removed ${result.removed} clidev hook${result.removed === 1 ? "" : "s"}`);
        hint(settingsPath);
        if (backup) hint(`backup: ${backup}`);
        return;
      }

      if (options.claude !== true) {
        printIntegrationGuide();
        hint("run `clidev hooks --claude` to install the Claude Code hooks automatically");
        return;
      }

      const settingsPath = claudeSettingsPath();
      const parsed = await readSettings(settingsPath);
      const merged = mergeClaudeHooks(parsed, commands);

      if (options.dryRun === true) {
        payload(JSON.stringify(merged.settings, null, 2));
        return;
      }

      const backup = await writeSettings(settingsPath, merged.settings, {
        backup: options.backup !== false,
      });

      success("Claude Code hooks are wired up");
      box("hooks installed", [
        ["file", settingsPath],
        ["Stop", merged.added > 0 ? "added" : "updated in place"],
        ["Notification", merged.added > 0 ? "added" : "updated in place"],
        ["backup", backup ?? "none (new file)"],
        ["restart", "reopen the Claude Code session to reload settings.json"],
      ]);
      printIntegrationGuide();
    });
}
