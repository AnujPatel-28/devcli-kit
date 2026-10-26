import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTree,
  isBinaryPath,
  languageFor,
  looksBinary,
  renderBundle,
} from "./pack-format.js";

test("buildTree sorts directories before files with box connectors", () => {
  const tree = buildTree(["src/cli.ts", "src/commands/pack.ts", "src/commands/clean.ts", "README.md"]);
  assert.equal(
    tree,
    [
      "├── src/",
      "│   ├── commands/",
      "│   │   ├── clean.ts",
      "│   │   └── pack.ts",
      "│   └── cli.ts",
      "└── README.md",
    ].join("\n"),
  );
});

test("buildTree normalises windows separators", () => {
  assert.equal(buildTree(["src\\utils\\logger.ts"]), "└── src/\n    └── utils/\n        └── logger.ts");
});

test("languageFor resolves extensions and well-known filenames", () => {
  assert.equal(languageFor("src/cli.ts"), "ts");
  assert.equal(languageFor("src/App.tsx"), "tsx");
  assert.equal(languageFor("Dockerfile"), "dockerfile");
  assert.equal(languageFor("scripts/build.sh"), "bash");
  assert.equal(languageFor("file.unknown"), "");
});

test("binary detection covers extensions and NUL bytes", () => {
  assert.equal(isBinaryPath("shot.png"), true);
  assert.equal(isBinaryPath("src/cli.ts"), false);
  assert.equal(looksBinary(Buffer.from([0x61, 0x00, 0x62])), true);
  assert.equal(looksBinary(Buffer.from("plain text")), false);
});

test("renderBundle emits a tree, stats and language-tagged fences", () => {
  const bundle = renderBundle(
    [
      { path: "src/a.ts", content: "export const a = 1;" },
      { path: "notes.md", content: "# Notes" },
    ],
    { generatedAt: new Date("2026-10-26T12:00:00.000Z") },
  );

  assert.match(bundle.markdown, /^# Project context/u);
  assert.match(bundle.markdown, /2 files · 2 lines/u);
  assert.match(bundle.markdown, /Generated 2026-10-26T12:00:00.000Z/u);
  assert.match(bundle.markdown, /## Tree/u);
  assert.match(bundle.markdown, /```ts\nexport const a = 1;\n```/u);
  assert.match(bundle.markdown, /```md\n# Notes\n```/u);
  assert.equal(bundle.tokens, Math.ceil(bundle.chars / 4));
  assert.equal(bundle.lines, 2);
});

test("renderBundle lengthens the fence when content contains backticks", () => {
  const content = "```js\nconsole.log(1);\n```";
  const bundle = renderBundle([{ path: "snippet.md", content }]);
  assert.match(bundle.markdown, /````md\n```js/u);
  assert.match(bundle.markdown, /```\n````\n$/u);
});

test("renderBundle handles an empty file list without crashing", () => {
  const bundle = renderBundle([]);
  assert.match(bundle.markdown, /0 files/u);
  assert.equal(bundle.tokens, 0);
  assert.equal(bundle.lines, 0);
});
