import assert from "node:assert/strict";
import test from "node:test";

import { prepareArgv } from "./cli.js";

test("clp with no arguments runs paste", () => {
  assert.deepEqual(prepareArgv("clp", []), ["paste"]);
});

test("clp forwards paste flags", () => {
  assert.deepEqual(prepareArgv("clp", ["--at"]), ["paste", "--at"]);
  assert.deepEqual(prepareArgv("clp", ["--base64", "--no-copy"]), [
    "paste",
    "--base64",
    "--no-copy",
  ]);
});

test("clp --help shows paste help, clp --version shows the version", () => {
  assert.deepEqual(prepareArgv("clp", ["--help"]), ["paste", "--help"]);
  assert.deepEqual(prepareArgv("clp", ["--version"]), ["--version"]);
  assert.deepEqual(prepareArgv("clp", ["-V"]), ["-V"]);
});

test("clp still allows explicit subcommands", () => {
  assert.deepEqual(prepareArgv("clp", ["clean"]), ["clean"]);
  assert.deepEqual(prepareArgv("clp", ["watch", "npm test"]), ["watch", "npm test"]);
});

test("clidev arguments pass through untouched", () => {
  assert.deepEqual(prepareArgv("clidev", []), []);
  assert.deepEqual(prepareArgv("clidev", ["pack", "src/**/*.ts"]), ["pack", "src/**/*.ts"]);
});
