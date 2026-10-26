import { readFile } from "node:fs/promises";

import { Command } from "commander";

import { pngToDataUrl, writeClipboard } from "../utils/clipboard.js";
import { ClipboardImageError, captureClipboardImage } from "../utils/clipboard-img.js";
import { CliError } from "../utils/errors.js";
import { formatBytes } from "../utils/format.js";
import { box, payload, setMachineOutput, warn, withSpinner } from "../utils/logger.js";

interface PasteOptions {
  at?: boolean;
  base64?: boolean;
  out?: string;
  keep?: string;
  copy?: boolean;
  json?: boolean;
}

export function createPasteCommand(): Command {
  return new Command("paste")
    .alias("p")
    .description("Capture the clipboard image as a PNG and hand its path to an AI CLI")
    .option("--at", "emit an @path reference instead of a bare path")
    .option("--base64", "emit a data:image/png;base64 URL instead of a path")
    .option("--out <dir>", "save screenshots into <dir> instead of ~/.clidev/screenshots")
    .option("--keep <count>", "keep only the newest <count> captures", "100")
    .option("--no-copy", "leave the clipboard untouched")
    .option("--json", "emit machine-readable JSON on stdout")
    .addHelpText(
      "after",
      `
Examples:
  $ clp                       capture, save, copy the absolute path
  $ clp --at                  copy @~/.clidev/screenshots/shot_20261026-140122.png
  $ clidev paste --base64     copy a data URL for chat-style agents
  $ clp --no-copy             print the path only (scripts, CI, tests)

The payload goes to stdout, decoration to stderr — so piping stays clean.

Windows PowerShell reserves 'clp' for Clear-ItemProperty: call 'clp.cmd' there,
or run 'Remove-Item Alias:clp' once to free the name.`,
    )
    .action(async (options: PasteOptions) => {
      setMachineOutput(options.json === true);
      const keep = Number.parseInt(options.keep ?? "100", 10);
      if (!Number.isFinite(keep) || keep < 0) {
        throw new CliError("--keep must be a non-negative integer", 2);
      }
      if (options.at === true && options.base64 === true) {
        throw new CliError("--at and --base64 are mutually exclusive", 2);
      }

      let screenshot;
      try {
        screenshot = await withSpinner("reading the clipboard", () =>
          captureClipboardImage({ dir: options.out, keep }),
        );
      } catch (error) {
        if (error instanceof ClipboardImageError) {
          throw new CliError(error.message, 1, error.hints);
        }
        throw error;
      }

      let kind = "absolute path";
      let outputPayload = screenshot.filePath;

      if (options.base64 === true) {
        const buffer = await readFile(screenshot.filePath);
        outputPayload = pngToDataUrl(buffer);
        kind = "base64 data URL";
      } else if (options.at === true) {
        outputPayload = `@${screenshot.filePath}`;
        kind = "@file reference";
      }

      const shouldCopy = options.copy !== false;
      const copied = shouldCopy ? await writeClipboard(outputPayload) : false;

      if (options.json === true) {
        payload(
          JSON.stringify(
            {
              path: screenshot.filePath,
              bytes: screenshot.bytes,
              platform: screenshot.platform,
              kind,
              payload: outputPayload,
              copied,
              pruned: screenshot.pruned,
            },
            null,
            2,
          ),
        );
        return;
      }

      payload(outputPayload);

      if (shouldCopy && !copied) {
        warn("clipboard write failed — copy the line above manually");
      }

      box("screenshot ready", [
        ["file", screenshot.filePath],
        ["size", formatBytes(screenshot.bytes)],
        ["clipboard", copied ? kind : "not copied"],
        ["next", "Ctrl+V inside Claude Code, Antigravity or OpenCode"],
      ]);
    });
}
