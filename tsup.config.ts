import { readFileSync } from "node:fs";

import { defineConfig } from "tsup";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * We bundle our own source but keep runtime dependencies external.
 * node-notifier ships platform binaries (snoretoast, terminal-notifier) that
 * cannot survive being inlined into a JS bundle, and clipboardy/fast-glob are
 * plain Node packages that resolve from node_modules at runtime.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    clp: "src/clp.ts",
  },
  outDir: "dist",
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [
    "@clack/prompts",
    "clipboardy",
    "commander",
    "fast-glob",
    "node-notifier",
    "picocolors",
  ],
  define: {
    __CLIDEV_VERSION__: JSON.stringify(pkg.version),
  },
});
