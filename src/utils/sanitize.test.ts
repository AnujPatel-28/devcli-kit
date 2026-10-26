import assert from "node:assert/strict";
import test from "node:test";

import { cleanLog, collapseNoise, maskSecrets, stripAnsi } from "./sanitize.js";

test("stripAnsi removes CSI colour codes", () => {
  assert.equal(stripAnsi("\u001B[31mred\u001B[0m text"), "red text");
  assert.equal(stripAnsi("\u001B[1m\u001B[38;5;208mbold\u001B[0m"), "bold");
});

test("stripAnsi removes OSC 8 hyperlinks and window titles", () => {
  const input = "\u001B]8;;https://example.dev\u0007link\u001B]8;;\u0007";
  assert.equal(stripAnsi(input), "link");
  assert.equal(stripAnsi("\u001B]0;title\u0007visible"), "visible");
});

test("stripAnsi leaves unicode and plain text untouched", () => {
  const input = "✔ finished · 42ms — ünïcode 日本語";
  assert.equal(stripAnsi(input), input);
});

test("maskSecrets redacts provider credentials", () => {
  const input = [
    "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz012345",
    "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "aws AKIAIOSFODNN7EXAMPLE",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
  ].join("\n");

  const result = maskSecrets(input);

  assert.ok(result.redactions >= 5, `expected >= 5 redactions, got ${result.redactions}`);
  assert.ok(!result.text.includes("sk-proj-"));
  assert.ok(!result.text.includes("sk-ant-"));
  assert.ok(!result.text.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(!result.text.includes("abcdefghijklmnopqrstuvwxyz012345"));
  assert.match(result.text, /OPENAI_API_KEY=\[REDACTED_SECRET\]/u);
  assert.match(result.text, /token: \[REDACTED_SECRET\]/u);
});

test("maskSecrets handles JSON-shaped secrets and keeps the key", () => {
  const result = maskSecrets('{"api_key": "abcdef1234567890", "mode": "prod"}');
  assert.match(result.text, /"api_key": "\[REDACTED_SECRET\]"/u);
  assert.match(result.text, /"mode": "prod"/u);
});

test("maskSecrets leaves ordinary prose alone", () => {
  const prose = "the token budget is fine and the password reset flow still works";
  assert.equal(maskSecrets(prose).redactions, 0);
});

test("maskSecrets is idempotent", () => {
  const once = maskSecrets("API_TOKEN=abcdef1234567890").text;
  const twice = maskSecrets(once);
  assert.equal(twice.redactions, 0);
  assert.equal(twice.text, once);
});

test("maskSecrets redacts private keys, JWTs and URL credentials", () => {
  const input = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEA1234",
    "-----END RSA PRIVATE KEY-----",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "postgres://admin:hunter2@localhost:5432/db",
  ].join("\n");

  const result = maskSecrets(input);

  assert.ok(!result.text.includes("MIIEowIBAAKCAQEA1234"));
  assert.ok(!result.text.includes("eyJhbGciOiJIUzI1NiJ9"));
  assert.ok(!result.text.includes("hunter2"));
  assert.match(result.text, /postgres:\/\/admin:\[REDACTED_SECRET\]@/u);
});

test("collapseNoise hides node_modules frame runs but keeps app frames", () => {
  const log = [
    "TypeError: boom",
    "    at fn (C:\\proj\\node_modules\\pkg\\index.js:1:1)",
    "    at fn (C:\\proj\\node_modules\\pkg\\index.js:2:1)",
    "    at fn (C:\\proj\\node_modules\\pkg\\index.js:3:1)",
    "    at main (C:\\proj\\src\\index.ts:10:5)",
  ].join("\n");

  const result = collapseNoise(log);

  assert.match(result.text, /3 internal frames hidden/u);
  assert.match(result.text, /src\\index\.ts/u);
  assert.equal(result.hiddenFrames, 3);
});

test("collapseNoise keeps short stack runs intact", () => {
  const log = [
    "    at a (node_modules/a/index.js:1:1)",
    "    at b (node_modules/b/index.js:1:1)",
  ].join("\n");

  assert.equal(collapseNoise(log).hiddenFrames, 0);
  assert.match(collapseNoise(log).text, /node_modules\/a/u);
});

test("collapseNoise keeps only the final carriage-return frame", () => {
  assert.equal(collapseNoise("10%\r55%\r100% done").text, "100% done");
});

test("collapseNoise folds repeated lines", () => {
  const result = collapseNoise(["warn", "warn", "warn", "warn", "end"].join("\n"));
  assert.match(result.text, /repeated 3 more times/u);
  assert.equal(result.duplicateLines, 3);
});

test("cleanLog reports the savings it actually made", () => {
  const input = "\u001B[32m✔\u001B[0m OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx";
  const result = cleanLog(input);

  assert.equal(result.stats.ansiRemoved, 2);
  assert.equal(result.stats.redactions, 1);
  assert.equal(result.text.includes("sk-abcdef"), false);
  assert.ok(result.stats.outputChars < result.stats.inputChars);
  assert.ok(result.stats.estimatedTokensSaved >= 1);
});
