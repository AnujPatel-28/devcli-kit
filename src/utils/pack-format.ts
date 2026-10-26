import path from "node:path";

import { estimateTokens, formatCount } from "./format.js";

export interface PackFile {
  path: string;
  content: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".astro": "astro",
  ".bash": "bash",
  ".c": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".dockerfile": "dockerfile",
  ".env": "dotenv",
  ".go": "go",
  ".graphql": "graphql",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".java": "java",
  ".js": "js",
  ".json": "json",
  ".jsx": "jsx",
  ".kt": "kotlin",
  ".lua": "lua",
  ".md": "md",
  ".mjs": "js",
  ".php": "php",
  ".prisma": "prisma",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "bash",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "ts",
  ".tsx": "tsx",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "bash",
};

const LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".gitignore": "gitignore",
  ".env": "dotenv",
  ".npmrc": "ini",
};

export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".7z",
  ".avi",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".node",
  ".otf",
  ".pdf",
  ".png",
  ".so",
  ".sqlite",
  ".tar",
  ".tiff",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

export function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** NUL bytes in the first 8 KB are a reliable "this is not text" signal. */
export function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8_000);
  return sample.includes(0);
}

export function languageFor(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  const byName = LANGUAGE_BY_FILENAME[base];
  if (byName) return byName;
  return LANGUAGE_BY_EXTENSION[path.extname(base)] ?? "";
}

interface TreeNode {
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function createNode(): TreeNode {
  return { children: new Map(), isFile: false };
}

export function buildTree(paths: string[]): string {
  const root = createNode();

  for (const raw of paths) {
    const segments = raw
      .replace(/\\/gu, "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    let node = root;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      let child = node.children.get(segment);
      if (!child) {
        child = createNode();
        node.children.set(segment, child);
      }
      child.isFile = isFile;
      node = child;
    });
  }

  const lines: string[] = [];
  const walk = (node: TreeNode, prefix: string): void => {
    const entries = [...node.children.entries()].sort(([leftName, left], [rightName, right]) => {
      if (left.isFile !== right.isFile) return left.isFile ? 1 : -1;
      return leftName.localeCompare(rightName);
    });

    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? "└── " : "├── "}${name}${child.isFile ? "" : "/"}`);
      if (!child.isFile) walk(child, `${prefix}${last ? "    " : "│   "}`);
    });
  };

  walk(root, "");
  return lines.join("\n");
}

/** A fence must be longer than any backtick run inside the file it wraps. */
function fenceFor(content: string): string {
  const runs = content.match(/`{3,}/gu) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2);
  return "`".repeat(longest + 1);
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

export interface RenderOptions {
  generatedAt?: Date;
  title?: string;
}

export interface RenderedBundle {
  markdown: string;
  chars: number;
  lines: number;
  tokens: number;
}

export function renderBundle(files: PackFile[], options: RenderOptions = {}): RenderedBundle {
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const chars = files.reduce((sum, file) => sum + file.content.length, 0);
  const lines = files.reduce((sum, file) => sum + countLines(file.content), 0);
  const tokens = estimateTokens(chars);
  const tree = buildTree(files.map((file) => file.path));

  const parts: string[] = [
    "# Project context",
    "",
    `> ${options.title ?? "clidev pack"} · ${formatCount(files.length)} ${
      files.length === 1 ? "file" : "files"
    } · ${formatCount(lines)} lines · ~${formatCount(tokens)} tokens`,
    `> Generated ${generatedAt}`,
  ];

  if (tree.length > 0) {
    parts.push("", "## Tree", "", "```text", tree, "```");
  }

  for (const file of files) {
    const fence = fenceFor(file.content);
    const language = languageFor(file.path);
    parts.push(
      "",
      "---",
      "",
      `## ${file.path}`,
      "",
      `${fence}${language}`,
      file.content.replace(/\s+$/u, ""),
      fence,
    );
  }

  const markdown = `${parts.join("\n")}\n`;
  return { markdown, chars, lines, tokens };
}
