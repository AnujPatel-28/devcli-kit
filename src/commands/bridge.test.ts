import assert from "node:assert/strict";
import test from "node:test";

import { bridgeText } from "./bridge.js";

const screenshot = "C:\\Users\\Anuj\\.clidev\\screenshots\\shot.png";

test("bridge text supports an agent @path, bare path and readable prompt", () => {
  assert.equal(bridgeText(screenshot, "at"), `@${screenshot}`);
  assert.equal(bridgeText(screenshot, "path"), screenshot);
  assert.equal(bridgeText(screenshot, "prompt"), `Please inspect this screenshot: ${screenshot}`);
});
