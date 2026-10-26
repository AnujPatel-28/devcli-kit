import { spinner as createSpinner } from "@clack/prompts";
import pc from "picocolors";

import { truncateMiddle } from "./format.js";
import { stripAnsi } from "./sanitize.js";

/**
 * Decoration always goes to stderr so stdout stays a clean, pipeable payload:
 * `clidev paste | pbcopy`, `clidev clean > build.log`, `clidev pack --print | ...`.
 */
export const isInteractive =
  Boolean(process.stdout.isTTY && process.stderr.isTTY) &&
  !process.env.CI &&
  process.env.TERM !== "dumb";

let verbose = process.env.CLIDEV_DEBUG === "1";
let machineOutput = false;

export function setVerbose(value: boolean): void {
  verbose = value || process.env.CLIDEV_DEBUG === "1";
}

export function isVerbose(): boolean {
  return verbose;
}

/**
 * `--json` and `--print` mean stdout is data, not a terminal. Interactive
 * spinners (@clack/prompts writes to stdout) must not decorate it.
 */
export function setMachineOutput(value: boolean): void {
  machineOutput = value;
}

export function isMachineOutput(): boolean {
  return machineOutput;
}

const visibleWidth = (text: string): number => stripAnsi(text).length;

export function writeErr(text = ""): void {
  process.stderr.write(`${text}\n`);
}

/** Machine-readable payload line on stdout. */
export function payload(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

export function info(message: string): void {
  writeErr(`${pc.blue("›")} ${message}`);
}

export function success(message: string): void {
  writeErr(`${pc.green("✔")} ${message}`);
}

export function warn(message: string): void {
  writeErr(`${pc.yellow("!")} ${message}`);
}

export function fail(message: string): void {
  writeErr(`${pc.red("✖")} ${message}`);
}

export function hint(message: string): void {
  writeErr(`  ${pc.dim(`→ ${message}`)}`);
}

export function debug(message: string): void {
  if (verbose) writeErr(pc.dim(`  ${message}`));
}

export function blank(): void {
  writeErr("");
}

const WORDMARK = [
  " ██████ ██      ██ ██████  ███████ ██    ██",
  "██      ██      ██ ██   ██ ██      ██    ██",
  "██      ██      ██ ██   ██ █████   ██    ██",
  "██      ██      ██ ██   ██ ██       ██  ██ ",
  " ██████ ███████ ██ ██████  ███████   ████  ",
];

export function printBanner(version: string): void {
  const columns = process.stderr.columns ?? 80;
  if (columns < 52) {
    writeErr(`${pc.bold(pc.blue("clidev"))} ${pc.dim(`v${version}`)}`);
    writeErr(pc.dim("universal ai cli developer kit"));
    blank();
    return;
  }

  blank();
  for (const line of WORDMARK) writeErr(pc.blue(line));
  writeErr(`${pc.dim("  universal ai cli developer kit")}  ${pc.dim(`v${version}`)}`);
  writeErr(pc.dim(`  ${"─".repeat(Math.min(columns - 4, 64))}`));
  blank();
}

/** Boxed key/value summary. Values are clipped rather than wrapped. */
export function box(title: string, rows: Array<[string, string]>): void {
  const columns = Math.max(48, process.stderr.columns ?? 96);
  const maxWidth = Math.min(columns - 4, 100) - 4; // borders + padding
  const labelWidth = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  const gap = 2;
  const titleText = ` ${title} `;

  const clip = (text: string): string => truncateMiddle(text, Math.max(8, maxWidth));
  const body = rows.map(([label, value]) => {
    const padded = label.padEnd(labelWidth, " ");
    return `${padded}${" ".repeat(gap)}${clip(value)}`;
  });
  const contentWidth = Math.max(visibleWidth(titleText) + 1, ...body.map(visibleWidth));

  const dashes = Math.max(0, contentWidth - visibleWidth(titleText) - 1);
  const top = `${pc.blue("╭─")}${pc.bold(pc.blue(titleText))}${pc.blue(`${"─".repeat(dashes)}╮`)}`;
  const bottom = pc.blue(`╰${"─".repeat(contentWidth + 2)}╯`);

  const lines = body.map((line, index) => {
    const label = rows[index]?.[0] ?? "";
    const paddedLabel = label.padEnd(labelWidth, " ");
    const value = line.slice(labelWidth + gap);
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
    return `${pc.blue("│")} ${pc.dim(paddedLabel)}${" ".repeat(gap)}${value}${padding} ${pc.blue("│")}`;
  });

  writeErr([top, ...lines, bottom].join("\n"));
}

/** Indented guidance block, used for hook snippets and failure recovery. */
export function note(title: string, lines: string[]): void {
  blank();
  writeErr(pc.bold(pc.blue(title)));
  for (const line of lines) writeErr(`  ${line}`);
}

export async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!isInteractive || machineOutput) return task();

  const spin = createSpinner();
  spin.start(label);
  try {
    const result = await task();
    spin.stop(`${label} ${pc.dim("done")}`);
    return result;
  } catch (error) {
    spin.stop(`${label} ${pc.red("failed")}`);
    throw error;
  }
}
