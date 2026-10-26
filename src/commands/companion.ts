import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { Command } from "commander";

import { CliError } from "../utils/errors.js";
import { box, hint, success, warn } from "../utils/logger.js";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "clidev Companion";

function psLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

/** An encoded command avoids quoting hazards in the Windows Run registry value. */
export function windowsStartupCommand(nodePath: string, scriptPath: string): string {
  const script = [
    `$node = ${psLiteral(nodePath)}`,
    `$entry = ${psLiteral(scriptPath)}`,
    "Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @($entry, 'bridge', '--no-notify')",
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`;
}

function companionEntry(): { nodePath: string; scriptPath: string } {
  const scriptPath = process.argv[1];
  if (!scriptPath || !existsSync(scriptPath)) {
    throw new CliError("Could not locate the clidev executable for login startup.", 1, [
      "Build and run the installed CLI: npm run build && npm link",
    ]);
  }
  return { nodePath: process.execPath, scriptPath };
}

function reg(args: string[]): { ok: boolean; detail: string } {
  try {
    const result = spawnSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
    return {
      ok: result.status === 0 && result.error === undefined,
      detail: (result.stderr || result.stdout || result.error?.message || "").trim(),
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function installed(): boolean {
  return reg(["query", RUN_KEY, "/v", VALUE_NAME]).ok;
}

function assertWindows(): void {
  if (process.platform !== "win32") {
    throw new CliError("clidev companion startup is currently Windows-only.", 1, [
      "Run `clidev bridge` manually, or use `clp --at` on macOS and Linux.",
    ]);
  }
}

export function createCompanionCommand(): Command {
  const companion = new Command("companion").description(
    "Install or inspect the opt-in Windows clipboard companion",
  );

  companion
    .command("status")
    .description("show whether bridge will start at Windows login")
    .action(() => {
      assertWindows();
      box("clidev companion", [
        ["login startup", installed() ? "installed" : "not installed"],
        ["does", "starts `clidev bridge --no-notify` hidden at sign-in"],
        ["does not", "inject keystrokes, read text, or send anything over the network"],
      ]);
    });

  companion
    .command("install")
    .description("start the clipboard bridge automatically at Windows login")
    .action(() => {
      assertWindows();
      const { nodePath, scriptPath } = companionEntry();
      const startup = windowsStartupCommand(nodePath, scriptPath);
      const result = reg(["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", startup, "/f"]);
      if (!result.ok) {
        throw new CliError("Could not install the clidev login companion.", 1, [result.detail]);
      }
      success("clidev Companion will start at your next Windows sign-in");
      hint("For this session, start it now with: clidev bridge");
    });

  companion
    .command("uninstall")
    .description("stop starting the clipboard bridge at Windows login")
    .action(() => {
      assertWindows();
      const result = reg(["delete", RUN_KEY, "/v", VALUE_NAME, "/f"]);
      if (!result.ok) {
        warn("clidev Companion was not installed");
        return;
      }
      success("clidev Companion will no longer start at Windows login");
      hint("A bridge already running remains active until you stop it or sign out.");
    });

  companion.addHelpText(
    "after",
    `
Examples:
  $ clidev companion install
  $ clidev companion status
  $ clidev companion uninstall

Install adds one per-user Windows Run entry. At sign-in it starts only the local
clipboard bridge in a hidden process. It never injects input into agent apps,
reads copied text, uploads screenshots, or changes agent configuration.`,
  );

  return companion;
}
