import assert from "node:assert/strict";
import test from "node:test";

import { windowsStartupCommand } from "./companion.js";

test("Windows startup command encodes paths without exposing shell quoting", () => {
  const command = windowsStartupCommand("C:\\Program Files\\nodejs\\node.exe", "C:\\work\\dist\\index.js");
  assert.match(command, /^powershell\.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand /u);
  assert.doesNotMatch(command, /Program Files/u);
});
