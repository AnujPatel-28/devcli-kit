import { estimateTokens } from "./format.js";

export interface CleanOptions {
  /** Keep every `node_modules` / `node:internal` stack frame. */
  keepFrames?: boolean;
  /** Keep consecutive duplicate lines instead of summarising them. */
  keepDuplicates?: boolean;
}

export interface CleanStats {
  inputChars: number;
  outputChars: number;
  savedChars: number;
  savedPercent: number;
  ansiRemoved: number;
  redactions: number;
  redactionKinds: Record<string, number>;
  hiddenFrames: number;
  duplicateLines: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  estimatedTokensSaved: number;
}

export interface CleanResult {
  text: string;
  stats: CleanStats;
}

const REDACTED = "[REDACTED_SECRET]";

const ANSI_PATTERNS: readonly RegExp[] = [
  /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu, // OSC: window titles, hyperlinks
  /\u001B[P^_][\s\S]*?\u001B\\/gu, // DCS / SOS / PM / APC payloads
  /\u001B\[[0-?]*[ -/]*[@-~]/gu, // CSI: colours, cursor movement, erasing
  /\u001B[@-Z\\-_]/gu, // two-character escapes
];

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const FRAME_LINE = /^\s+at\s/u;
const INTERNAL_FRAME = /(?:node_modules|node:internal)/u;

/** Removes every ANSI escape sequence, including OSC 8 hyperlinks. */
export function stripAnsi(text: string): string {
  let output = text;
  for (const pattern of ANSI_PATTERNS) output = output.replace(pattern, "");
  return output;
}

/** Drops C0 control characters while preserving newlines and tabs. */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}

export function countAnsi(text: string): number {
  let count = 0;
  for (const pattern of ANSI_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

interface SecretRule {
  name: string;
  pattern: RegExp;
  /** Receives the match plus its capture groups (offset/input stripped). */
  replace: (match: string, ...groups: string[]) => string;
}

const constant = (): string => REDACTED;

const SECRET_RULES: readonly SecretRule[] = [
  {
    name: "private-key",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
    replace: constant,
  },
  {
    name: "anthropic-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/gu,
    replace: constant,
  },
  {
    name: "openai-key",
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/gu,
    replace: constant,
  },
  {
    name: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/gu,
    replace: constant,
  },
  {
    name: "gitlab-token",
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}/gu,
    replace: constant,
  },
  {
    name: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/gu,
    replace: constant,
  },
  {
    name: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
    replace: constant,
  },
  {
    name: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu,
    replace: constant,
  },
  {
    name: "stripe-key",
    pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/gu,
    replace: constant,
  },
  {
    name: "huggingface-token",
    pattern: /\bhf_[A-Za-z0-9]{30,}/gu,
    replace: constant,
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
    replace: constant,
  },
  {
    name: "bearer-token",
    pattern: /\b(bearer)(\s+)[A-Za-z0-9._~+/=-]{16,}/giu,
    replace: (_match, scheme = "Bearer", space = " ") => `${scheme}${space}${REDACTED}`,
  },
  {
    name: "url-credentials",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]{3,})@/giu,
    replace: (_match, scheme = "", user = "") => `${scheme}${user}:${REDACTED}@`,
  },
  {
    name: "env-secret",
    pattern:
      /(["']?)([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|AUTH)[A-Za-z0-9_]*)\1(\s*[:=]\s*)(["']?)(?!\[REDACTED)([^\s"',}]{6,})\4/giu,
    replace: (_match, openQuote = "", key = "", separator = "", valueQuote = "") =>
      `${openQuote}${key}${openQuote}${separator}${valueQuote}${REDACTED}${valueQuote}`,
  },
];

export interface MaskResult {
  text: string;
  redactions: number;
  kinds: Record<string, number>;
}

/** Masks well-known credential shapes while leaving the surrounding log intact. */
export function maskSecrets(text: string): MaskResult {
  let output = text;
  let redactions = 0;
  const kinds: Record<string, number> = {};

  for (const rule of SECRET_RULES) {
    let hits = 0;
    output = output.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      // The replacer receives (...groups, offset, wholeString).
      const groups = rest.slice(0, -2).map((group) => (typeof group === "string" ? group : ""));
      hits += 1;
      return rule.replace(match, ...groups);
    });
    if (hits > 0) {
      redactions += hits;
      kinds[rule.name] = (kinds[rule.name] ?? 0) + hits;
    }
  }

  return { text: output, redactions, kinds };
}

function collapseFrames(
  lines: string[],
  keepFrames: boolean,
): { lines: string[]; hiddenFrames: number } {
  const output: string[] = [];
  let buffer: string[] = [];
  let hiddenFrames = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    if (!keepFrames && buffer.length > 2) {
      output.push(`    at … (${buffer.length} internal frames hidden)`);
      hiddenFrames += buffer.length;
    } else {
      output.push(...buffer);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (FRAME_LINE.test(line) && INTERNAL_FRAME.test(line)) {
      buffer.push(line);
    } else {
      flush();
      output.push(line);
    }
  }
  flush();

  return { lines: output, hiddenFrames };
}

function collapseDuplicates(
  lines: string[],
  keepDuplicates: boolean,
): { lines: string[]; duplicateLines: number } {
  const output: string[] = [];
  let duplicateLines = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    let run = 1;
    while (index + run < lines.length && lines[index + run] === line) run += 1;

    if (!keepDuplicates && run > 2 && line.length > 0) {
      output.push(line, `    … repeated ${run - 1} more times`);
      duplicateLines += run - 1;
    } else {
      for (let copy = 0; copy < run; copy += 1) output.push(line);
    }
    index += run;
  }

  return { lines: output, duplicateLines };
}

function collapseBlankRuns(lines: string[]): string[] {
  const output: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }
    output.push(line);
  }

  while (output.length > 0 && (output[0] ?? "").trim() === "") output.shift();
  while (output.length > 0 && (output[output.length - 1] ?? "").trim() === "") output.pop();

  return output;
}

export interface NoiseResult {
  text: string;
  hiddenFrames: number;
  duplicateLines: number;
}

/**
 * Normalises terminal output: rewrites `\r` progress lines, trims trailing
 * whitespace, hides framework stack frames, folds repeated lines and squashes
 * blank-line runs.
 */
export function collapseNoise(text: string, options: CleanOptions = {}): NoiseResult {
  const normalised = text
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => {
      const carriage = line.lastIndexOf("\r");
      const visible = carriage === -1 ? line : line.slice(carriage + 1);
      return visible.replace(/[ \t]+$/u, "");
    });

  const frames = collapseFrames(normalised, options.keepFrames === true);
  const duplicates = collapseDuplicates(frames.lines, options.keepDuplicates === true);
  const lines = collapseBlankRuns(duplicates.lines);

  return {
    text: lines.join("\n"),
    hiddenFrames: frames.hiddenFrames,
    duplicateLines: duplicates.duplicateLines,
  };
}

export function cleanLog(input: string, options: CleanOptions = {}): CleanResult {
  const inputChars = input.length;
  const ansiRemoved = countAnsi(input);
  const withoutAnsi = stripControlChars(stripAnsi(input));
  const masked = maskSecrets(withoutAnsi);
  const noise = collapseNoise(masked.text, options);
  const outputChars = noise.text.length;
  const savedChars = Math.max(0, inputChars - outputChars);

  return {
    text: noise.text,
    stats: {
      inputChars,
      outputChars,
      savedChars,
      savedPercent: inputChars === 0 ? 0 : Math.round((savedChars / inputChars) * 100),
      ansiRemoved,
      redactions: masked.redactions,
      redactionKinds: masked.kinds,
      hiddenFrames: noise.hiddenFrames,
      duplicateLines: noise.duplicateLines,
      estimatedTokensBefore: estimateTokens(inputChars),
      estimatedTokensAfter: estimateTokens(outputChars),
      estimatedTokensSaved: Math.max(0, estimateTokens(inputChars) - estimateTokens(outputChars)),
    },
  };
}
