import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";
import fg from "fast-glob";

import { writeClipboard } from "../utils/clipboard.js";
import { CliError } from "../utils/errors.js";
import { formatBytes, formatCount } from "../utils/format.js";
import { box, hint, payload, setMachineOutput, warn, withSpinner } from "../utils/logger.js";
import { isBinaryPath, looksBinary, renderBundle, type PackFile } from "../utils/pack-format.js";
import { expandHome } from "../utils/paths.js";

const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lockb",
  "**/*.min.js",
  "**/*.map",
  "**/.DS_Store",
];

interface PackOptions {
  all?: boolean;
  print?: boolean;
  out?: string;
  copy?: boolean;
  maxBytes?: string;
  maxTokens?: string;
  json?: boolean;
}

interface CollectedFiles {
  files: PackFile[];
  bytes: number;
  skippedBinary: string[];
  skippedLarge: string[];
  truncated: string[];
}

function parsePositiveInt(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError(`${flag} must be a positive integer`, 2);
  }
  return value;
}

function gitChangedFiles(root: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain"],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        const files: string[] = [];
        for (const line of stdout.split("\n")) {
          if (line.trim().length === 0) continue;
          const status = line.slice(0, 2);
          if (status.includes("D")) continue; // deleted files cannot be packed

          let file = line.slice(3).trim();
          const arrow = file.lastIndexOf(" -> ");
          if (arrow !== -1) file = file.slice(arrow + 4);
          if (file.startsWith('"') && file.endsWith('"')) {
            file = file.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
          }
          if (file.length > 0) files.push(file);
        }
        resolve(files);
      },
    );
  });
}

async function globFiles(entries: string[]): Promise<string[]> {
  const matches = await fg(entries, {
    cwd: process.cwd(),
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    unique: true,
    absolute: false,
    ignore: DEFAULT_IGNORES,
  });

  return matches.map((match) => match.split(path.sep).join("/")).sort();
}

interface ResolvedInputs {
  files: string[];
  source: "patterns" | "all" | "git-changed" | "src" | "none";
}

async function resolveInputs(patterns: string[], all: boolean): Promise<ResolvedInputs> {
  if (patterns.length > 0) {
    return { files: await globFiles(patterns), source: "patterns" };
  }
  if (all) {
    return { files: await globFiles(["**/*"]), source: "all" };
  }

  const changed = await gitChangedFiles(process.cwd());
  if (changed.length > 0) {
    const existing = await globFiles(changed);
    if (existing.length > 0) return { files: existing, source: "git-changed" };
  }

  const fallback = await globFiles(["src/**/*"]);
  if (fallback.length > 0) return { files: fallback, source: "src" };

  return { files: [], source: "none" };
}

async function collectFiles(
  relativePaths: string[],
  maxBytes: number,
  maxTokens: number,
): Promise<CollectedFiles> {
  const files: PackFile[] = [];
  const skippedBinary: string[] = [];
  const skippedLarge: string[] = [];
  const truncated: string[] = [];

  let bytes = 0;
  let remainingChars = maxTokens * 4;

  for (const relative of relativePaths) {
    if (isBinaryPath(relative)) {
      skippedBinary.push(relative);
      continue;
    }

    const absolute = path.resolve(process.cwd(), relative);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      continue;
    }
    if (!info.isFile() || info.size === 0) continue;

    if (info.size > maxBytes) {
      skippedLarge.push(relative);
      continue;
    }
    if (info.size > remainingChars) {
      truncated.push(relative);
      continue;
    }

    const buffer = await readFile(absolute);
    if (looksBinary(buffer)) {
      skippedBinary.push(relative);
      continue;
    }

    const content = buffer.toString("utf8").replace(/^\uFEFF/u, "");
    files.push({ path: relative, content });
    bytes += info.size;
    remainingChars -= content.length;
  }

  return { files, bytes, skippedBinary, skippedLarge, truncated };
}

export function createPackCommand(): Command {
  return new Command("pack")
    .description("Bundle files into one markdown block and copy it to the clipboard")
    .argument("[patterns...]", "glob patterns (default: git-changed files, then src/**/*)")
    .option("--all", "pack every text file in the current directory")
    .option("--print", "print the markdown bundle to stdout")
    .option("--out <file>", "also write the bundle to <file>")
    .option("--no-copy", "do not copy the bundle to the clipboard")
    .option("--max-bytes <n>", "skip files larger than <n> bytes", "100000")
    .option("--max-tokens <n>", "stop adding files after roughly <n> tokens", "150000")
    .option("--json", "emit machine-readable JSON on stdout")
    .addHelpText(
      "after",
      `
Examples:
  $ clidev pack                          changed files, or src/**/* as a fallback
  $ clidev pack "src/**/*.ts" --print    inspect the bundle
  $ clidev pack src/cli.ts README.md     explicit files
  $ clidev pack --all --max-tokens 60000 whole repo, bounded

Binary files, lockfiles and node_modules are skipped automatically.`,
    )
    .action(async (patterns: string[], options: PackOptions) => {
      setMachineOutput(options.json === true || options.print === true);
      const maxBytes = parsePositiveInt(options.maxBytes, 100_000, "--max-bytes");
      const maxTokens = parsePositiveInt(options.maxTokens, 150_000, "--max-tokens");

      const inputs = await withSpinner("collecting files", () =>
        resolveInputs(patterns, options.all === true),
      );

      if (inputs.files.length === 0) {
        throw new CliError("No files matched.", 1, [
          'Pass a glob: clidev pack "src/**/*.ts"',
          "Or pack the whole repo: clidev pack --all",
        ]);
      }

      const collected = await withSpinner(
        `reading ${formatCount(inputs.files.length)} files`,
        () => collectFiles(inputs.files, maxBytes, maxTokens),
      );

      if (collected.files.length === 0) {
        throw new CliError("Every matched file was binary, empty, or larger than --max-bytes.", 1, [
          "Raise the limit: clidev pack --max-bytes 400000",
        ]);
      }

      const rendered = renderBundle(collected.files, {
        title: `clidev pack · ${inputs.source}`,
      });

      if (options.out !== undefined) {
        const outPath = path.resolve(expandHome(options.out));
        await writeFile(outPath, rendered.markdown, "utf8");
      }

      const copied = options.copy === false ? false : await writeClipboard(rendered.markdown);

      if (options.json === true) {
        payload(
          JSON.stringify(
            {
              source: inputs.source,
              files: collected.files.length,
              bytes: collected.bytes,
              lines: rendered.lines,
              chars: rendered.chars,
              tokens: rendered.tokens,
              skippedBinary: collected.skippedBinary,
              skippedLarge: collected.skippedLarge,
              truncated: collected.truncated,
              out: options.out === undefined ? null : path.resolve(expandHome(options.out)),
              copied,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (options.print === true) payload(rendered.markdown);

      if (copied === false && options.copy !== false) {
        warn("clipboard write failed — use --print or --out to capture the bundle");
      }

      box("context packed", [
        ["files", formatCount(collected.files.length)],
        ["size", formatBytes(collected.bytes)],
        ["tokens", `~${formatCount(rendered.tokens)}`],
        ["source", inputs.source],
        ["clipboard", copied ? "markdown bundle copied" : "not copied"],
        ["out", options.out === undefined ? "—" : path.resolve(expandHome(options.out))],
      ]);

      if (collected.skippedBinary.length > 0) {
        hint(`${formatCount(collected.skippedBinary.length)} binary files skipped`);
      }
      if (collected.skippedLarge.length > 0) {
        hint(`${formatCount(collected.skippedLarge.length)} files over ${formatBytes(maxBytes)} skipped`);
      }
      if (collected.truncated.length > 0) {
        warn(`${formatCount(collected.truncated.length)} files dropped at the --max-tokens budget`);
      }
    });
}
