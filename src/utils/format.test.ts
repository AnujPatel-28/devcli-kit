import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateTokens,
  formatBytes,
  formatCount,
  formatDuration,
  plural,
  truncateMiddle,
} from "./format.js";

test("estimateTokens uses the 4-chars-per-token rule", () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(1), 1);
  assert.equal(estimateTokens(400), 100);
  assert.equal(estimateTokens(401), 101);
});

test("formatBytes scales units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1_258_291), "1.2 MB");
});

test("formatDuration covers ms, seconds, minutes and hours", () => {
  assert.equal(formatDuration(240), "240ms");
  assert.equal(formatDuration(12_340), "12.3s");
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatDuration(3_780_000), "1h 3m");
});

test("formatCount uses thousands separators", () => {
  assert.equal(formatCount(18_204), "18,204");
});

test("plural picks the right form", () => {
  assert.equal(plural(1, "file"), "file");
  assert.equal(plural(2, "file"), "files");
  assert.equal(plural(0, "entry", "entries"), "entries");
});

test("truncateMiddle keeps both ends of long paths", () => {
  const path = "C:\\Users\\Anuj\\.clidev\\screenshots\\shot_20261026-140122.png";
  const clipped = truncateMiddle(path, 24);
  assert.equal(clipped.length, 24);
  assert.ok(clipped.startsWith("C:\\Users"));
  assert.ok(clipped.endsWith(".png"));
  assert.ok(clipped.includes("…"));
  assert.equal(truncateMiddle("short", 24), "short");
});
