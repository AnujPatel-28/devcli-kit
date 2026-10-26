import { runCli } from "./cli.js";

// `clp` exists so a screenshot is always one word away. It resolves to the exact
// same code path as `clidev paste`; only the default subcommand differs.
await runCli("clp");
