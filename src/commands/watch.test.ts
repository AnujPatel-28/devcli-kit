import assert from "node:assert/strict";
import test from "node:test";

import { normaliseWatchCommand } from "./watch.js";

test("a single quoted command is passed through untouched", () => {
  assert.equal(
    normaliseWatchCommand(['claude -p "fix the failing tests"']),
    'claude -p "fix the failing tests"',
  );
});

test("simple argv is joined with single spaces", () => {
  assert.equal(normaliseWatchCommand(["npm", "run", "build"]), "npm run build");
  assert.equal(normaliseWatchCommand(["npm", "test", "--", "--watch=false"]), "npm test -- --watch=false");
});

test("argv fragments containing spaces are re-quoted", () => {
  assert.equal(
    normaliseWatchCommand(["node", "-e", "console.log('hello world')"]),
    'node -e "console.log(\'hello world\')"',
  );
});

test("blank fragments are dropped and empty input stays empty", () => {
  assert.equal(normaliseWatchCommand(["  ", "echo", " hi "]), "echo hi");
  assert.equal(normaliseWatchCommand([]), "");
});
