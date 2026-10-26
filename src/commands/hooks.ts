import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";

import { opencodePluginPath, renderOpencodePlugin } from "../adapters/opencode.js";
import {
  mergeClaudeHooks,
  notifyHookSpecs,
  relayHookSpecs,
  removeClidevHooks,
  type JsonRecord,
} from "../utils/claude-hooks.js";
import { DEFAULT_WAIT_SECONDS } from "./relay.js";
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
  notifyOnly?: boolean;
  opencode?: boolean;
}

const OPENCODE_MARKER = "clidev → OpenCode plugin";

/** Absolute node + clidev script, so the plugin keeps working outside this shell. */
function selfCommand(): string[] {
  const script = process.argv[1];
  return script === undefined ? ["clidev"] : [process.execPath, path.resolve(script)];
}

async function handleOpencode(options: HooksOptions): Promise<void> {
  const pluginPath = opencodePluginPath();

  if (options.remove === true) {
    let existing: string;
    try {
      existing = await readFile(pluginPath, "utf8");
    } catch {
      warn(`no clidev plugin found at ${pluginPath}`);
      return;
    }
    if (!existing.includes(OPENCODE_MARKER)) {
      throw new CliError(`${pluginPath} was not written by clidev, so it was left alone.`);
    }
    if (options.dryRun === true) {
      payload(`would delete ${pluginPath}`);
      return;
    }
    await rm(pluginPath);
    success("removed the clidev OpenCode plugin");
    hint(pluginPath);
    return;
  }

  const source = renderOpencodePlugin(selfCommand());
  if (options.dryRun === true) {
    payload(`// ${pluginPath}\n${source}`);
    return;
  }

  try {
    const existing = await readFile(pluginPath, "utf8");
    if (!existing.includes(OPENCODE_MARKER)) {
      throw new CliError(`${pluginPath} already exists and was not written by clidev.`, 1, [
        "Rename or remove that file, then run this again.",
      ]);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
  }

  await mkdir(path.dirname(pluginPath), { recursive: true });
  const temporaryPath = `${pluginPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, source, "utf8");
  await rename(temporaryPath, pluginPath);

  success("OpenCode now reports to the clidev inbox");
  box("plugin installed", [
    ["file", pluginPath],
    ["events", "finished, permission, question; answered in the TUI closes the card"],
    ["restart", "restart OpenCode to load the plugin"],
  ]);
  hint("open the inbox with `clidev inbox`; OpenCode's own prompts stay live, answer in either place");
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
    "OpenCode          clidev hooks --opencode   (full inbox replies)",
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
    .option("--claude", "wire Claude Code into the clidev inbox (~/.claude/settings.json)")
    .option("--notify-only", "only show a toast when Claude stops or waits; no replies")
    .option("--opencode", "install the clidev plugin into OpenCode (~/.config/opencode/plugins)")
    .option("--remove", "remove clidev hooks instead of installing them")
    .option("--dry-run", "print the resulting settings.json without writing it")
    .option("--no-backup", "skip the timestamped settings.json backup")
    .option("--command <bin>", "override the clidev binary the hooks should call")
    .addHelpText(
      "after",
      `
Examples:
  $ clidev hooks --claude                  answer Claude from the inbox, by voice
  $ clidev hooks --claude --notify-only    just a toast when it stops or waits
  $ clidev hooks --opencode                answer OpenCode from the same inbox
  $ clidev hooks --opencode --remove       uninstall the OpenCode plugin
  $ clidev hooks --claude --dry-run        inspect the JSON first
  $ clidev hooks --claude --remove         undo, keeping your other hooks
  $ clidev hooks                           show wiring guides for other agents

Writes are atomic, idempotent, and never touch an invalid settings.json.`,
    )
    .action(async (options: HooksOptions) => {
      setMachineOutput(options.dryRun === true);
      if (options.opencode === true) {
        await handleOpencode(options);
        if (options.claude !== true) return;
      }
      const bin = options.command?.trim() ?? "";
      const executable = bin.length > 0 ? bin : resolveCliInvocation();
      const specs =
        options.notifyOnly === true
          ? notifyHookSpecs(executable)
          : relayHookSpecs(executable, {
              Stop: DEFAULT_WAIT_SECONDS.Stop ?? 900,
              PermissionRequest: DEFAULT_WAIT_SECONDS.PermissionRequest ?? 600,
            });

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
        hint("run `clidev hooks --claude` or `clidev hooks --opencode` to wire an agent into the inbox");
        return;
      }

      const settingsPath = claudeSettingsPath();
      const parsed = await readSettings(settingsPath);
      const merged = mergeClaudeHooks(parsed, specs);

      if (options.dryRun === true) {
        payload(JSON.stringify(merged.settings, null, 2));
        return;
      }

      const backup = await writeSettings(settingsPath, merged.settings, {
        backup: options.backup !== false,
      });

      const replies = options.notifyOnly !== true;
      success(replies ? "Claude Code now reports to the clidev inbox" : "Claude Code hooks are wired up");
      box("hooks installed", [
        ["file", settingsPath],
        ["events", specs.map((spec) => spec.event).join(", ")],
        ["changes", `${merged.added} added · ${merged.updated} updated · ${merged.removed} removed`],
        ["backup", backup ?? "none (new file)"],
        ["restart", "reopen the Claude Code session to reload settings.json"],
      ]);
      if (replies) {
        hint("open the inbox with `clidev inbox`; the hub starts by itself when Claude needs you");
        hint(
          `a hook waits ${Math.round((DEFAULT_WAIT_SECONDS.Stop ?? 900) / 60)} min for your reply, then Claude carries on as normal`,
        );
        return;
      }
      printIntegrationGuide();
    });
}
