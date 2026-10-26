import { readFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { writeClipboard } from "../utils/clipboard.js";
import { CliError } from "../utils/errors.js";
import { formatCount } from "../utils/format.js";
import { box, payload, setMachineOutput, warn, withSpinner } from "../utils/logger.js";
import { expandHome } from "../utils/paths.js";
import { cleanLog } from "../utils/sanitize.js";

interface CleanOptions {
  file?: string;
  copy?: boolean;
  keepFrames?: boolean;
  keepDuplicates?: boolean;
  json?: boolean;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";

  process.stdin.setEncoding("utf8");
  let data = "";
  for await (const chunk of process.stdin) {
    data += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
  }
  return data;
}

export function createCleanCommand(): Command {
  return new Command("clean")
    .description("Strip ANSI noise, mask leaked secrets and collapse stack traces")
    .option("-f, --file <path>", "read from a file instead of stdin")
    .option("--no-copy", "do not copy the cleaned text to the clipboard")
    .option("--keep-frames", "keep every node_modules / node:internal stack frame")
    .option("--keep-duplicates", "keep repeated log lines verbatim")
    .option("--json", "emit JSON { text, stats } on stdout")
    .addHelpText(
      "after",
      `
Examples:
  $ npm run build 2>&1 | clidev clean
  $ cat dev-server.log | clidev clean --json | jq .stats
  $ clidev clean --file crash.log --keep-frames

The cleaned text goes to stdout and the clipboard; stats go to stderr.`,
    )
    .action(async (options: CleanOptions) => {
      setMachineOutput(options.json === true);
      let input: string;
      if (options.file !== undefined) {
        const filePath = path.resolve(expandHome(options.file));
        try {
          input = await readFile(filePath, "utf8");
        } catch (error) {
          throw new CliError(
            `Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else {
        input = await withSpinner("reading stdin", readStdin);
      }

      if (input.trim().length === 0) {
        throw new CliError("No log input received.", 1, [
          "Pipe a command: npm run build 2>&1 | clidev clean",
          "Or point at a file: clidev clean --file build.log",
        ]);
      }

      const result = cleanLog(input, {
        keepFrames: options.keepFrames === true,
        keepDuplicates: options.keepDuplicates === true,
      });

      const shouldCopy = options.copy !== false && result.text.length > 0;
      const copied = shouldCopy ? await writeClipboard(result.text) : false;

      if (options.json === true) {
        payload(JSON.stringify({ text: result.text, stats: result.stats, copied }, null, 2));
        return;
      }

      payload(result.text);

      if (shouldCopy && !copied) {
        warn("clipboard write failed — the cleaned text is on stdout");
      }

      const { stats } = result;
      box("clean complete", [
        ["size", `${formatCount(stats.inputChars)} → ${formatCount(stats.outputChars)} chars`],
        [
          "saved",
          `${formatCount(stats.savedChars)} chars (${stats.savedPercent}%) · ~${formatCount(
            stats.estimatedTokensSaved,
          )} tokens`,
        ],
        ["ansi", `${formatCount(stats.ansiRemoved)} escape sequences stripped`],
        ["secrets", `${formatCount(stats.redactions)} redacted`],
        [
          "noise",
          `${formatCount(stats.hiddenFrames)} stack frames · ${formatCount(
            stats.duplicateLines,
          )} repeats collapsed`,
        ],
        ["clipboard", copied ? "cleaned text copied" : "not copied"],
      ]);
    });
}
