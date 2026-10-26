import { CommanderError, Command } from "commander";

import { createBridgeCommand } from "./commands/bridge.js";
import { createCleanCommand } from "./commands/clean.js";
import { createCompanionCommand } from "./commands/companion.js";
import { createHooksCommand } from "./commands/hooks.js";
import { createNotifyCommand } from "./commands/notify.js";
import { createPackCommand } from "./commands/pack.js";
import { createPasteCommand } from "./commands/paste.js";
import { createWatchCommand } from "./commands/watch.js";
import { CliError } from "./utils/errors.js";
import { blank, fail, hint, isVerbose, printBanner, setVerbose, writeErr } from "./utils/logger.js";
import { VERSION } from "./version.js";

export type CliInvocation = "clidev" | "clp";

const SUBCOMMANDS = ["paste", "bridge", "companion", "watch", "notify", "hooks", "clean", "pack"] as const;

const EXAMPLES = `
Examples:
  $ clp                                  screenshot -> save -> path on your clipboard
  $ clidev bridge                        keep screenshots pasteable as @paths (Windows preview)
  $ clidev companion install             start that bridge automatically when Windows starts
  $ clidev watch "npm run build"         get pinged when the build finishes
  $ clidev hooks --claude                wire Stop + Notification hooks automatically
  $ npm run dev 2>&1 | clidev clean      strip ANSI, mask secrets, fold stack traces
  $ clidev pack "src/**/*.ts"            bundle context onto the clipboard
  $ clidev --help                        every command and flag

Docs: README.md   ·   Landing page: web/index.html
`;

/**
 * `clp` is a paste-first alias: bare invocation, or any flag that is not a
 * subcommand, is forwarded to `paste`. `clp --help` naturally shows paste help.
 */
export function prepareArgv(invocation: CliInvocation, argv: string[] = process.argv.slice(2)): string[] {
  if (invocation !== "clp") return argv;

  const first = argv[0];
  if (first === undefined) return ["paste"];
  if (first === "-V" || first === "--version") return argv;
  if (first.startsWith("-")) return ["paste", ...argv];
  if ((SUBCOMMANDS as readonly string[]).includes(first)) return argv;
  return ["paste", ...argv];
}

function buildProgram(invocation: CliInvocation): Command {
  const program = new Command();

  program
    .name(invocation)
    .description("The toolkit for visual context and lifecycle gaps in CLI coding agents")
    .version(VERSION, "-V, --version", "print the version")
    .option("--verbose", "show diagnostic detail and stack traces")
    .showHelpAfterError("(run `clidev --help` for usage)")
    .showSuggestionAfterError(true)
    .addHelpText("after", EXAMPLES)
    .hook("preAction", (thisCommand: Command) => {
      if (thisCommand.opts().verbose === true) setVerbose(true);
    });

  program.addCommand(createPasteCommand());
  program.addCommand(createBridgeCommand());
  program.addCommand(createCompanionCommand());
  program.addCommand(createWatchCommand());
  program.addCommand(createNotifyCommand());
  program.addCommand(createHooksCommand());
  program.addCommand(createCleanCommand());
  program.addCommand(createPackCommand());

  program.action(() => {
    printBanner(VERSION);
    program.outputHelp();
  });

  return program;
}

function installStreamGuards(): void {
  const handle = (error: NodeJS.ErrnoException): void => {
    // `clidev pack --print | head` closes stdout early; that is not an error.
    if (error.code === "EPIPE") process.exit(0);
  };
  process.stdout.on("error", handle);
  process.stderr.on("error", handle);

  const fatal = (error: unknown): void => {
    if ((error as NodeJS.ErrnoException | null)?.code === "EPIPE") process.exit(0);
    handleFatal(error);
    process.exit(process.exitCode === 0 ? 1 : (process.exitCode ?? 1));
  };

  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);
}

function handleFatal(error: unknown): void {
  if (error instanceof CommanderError) {
    // Commander already printed help/version/usage text.
    const benign = error.exitCode === 0 || error.code === "commander.helpDisplayed" || error.code === "commander.version";
    process.exitCode = benign ? 0 : error.exitCode;
    return;
  }

  blank();
  if (error instanceof CliError) {
    fail(error.message);
    for (const item of error.hints) hint(item);
    process.exitCode = error.exitCode;
    return;
  }

  fail(error instanceof Error ? error.message : String(error));
  if (isVerbose() && error instanceof Error && error.stack !== undefined) {
    writeErr(error.stack);
  } else {
    hint("re-run with --verbose for the full stack");
  }
  process.exitCode = 1;
}

export async function runCli(invocation: CliInvocation): Promise<void> {
  installStreamGuards();

  const program = buildProgram(invocation);
  program.exitOverride();

  try {
    await program.parseAsync(prepareArgv(invocation), { from: "user" });
  } catch (error) {
    handleFatal(error);
  }
}
