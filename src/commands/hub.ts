import { spawn } from "node:child_process";

import { Command } from "commander";

import { connectHub, hubBase } from "../hub/client.js";
import { hubPort, startHub } from "../hub/server.js";
import { CliError, isErrnoException } from "../utils/errors.js";
import { box, hint, info, payload, success, warn } from "../utils/logger.js";

interface HubOptions {
  background?: boolean;
  stop?: boolean;
}

function openInBrowser(url: string): boolean {
  try {
    const [command, args] =
      process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function stopHub(): Promise<void> {
  const hub = await connectHub({ start: false });
  if (hub === null) {
    warn("no clidev hub is running");
    return;
  }
  await fetch(`${hub.base}/api/shutdown`, {
    method: "POST",
    headers: { "x-clidev-token": hub.token },
  }).catch(() => undefined);
  success("clidev hub stopped");
}

export function createHubCommand(): Command {
  return new Command("hub")
    .description("Run the local hub every agent reports to (started automatically by hooks)")
    .option("--background", "run quietly; used when a hook starts the hub for you")
    .option("--stop", "stop the running hub")
    .addHelpText(
      "after",
      `
The hub listens on 127.0.0.1:${hubPort()} only (override with CLIDEV_HUB_PORT).
Agent hooks start it automatically, so you rarely run this by hand.

Examples:
  $ clidev hub             run in the foreground and log each ask
  $ clidev hub --stop      shut it down
  $ clidev inbox           open the reply page`,
    )
    .action(async (options: HubOptions) => {
      if (options.stop === true) {
        await stopHub();
        return;
      }

      const quiet = options.background === true;
      let hub;
      try {
        hub = await startHub({ log: quiet ? undefined : (line) => info(line) });
      } catch (error) {
        if (isErrnoException(error) && error.code === "EADDRINUSE") {
          if (quiet) return;
          throw new CliError(`Port ${hubPort()} is already in use.`, 1, [
            "If a clidev hub is already running, just run `clidev inbox`.",
            "Otherwise pick another port: CLIDEV_HUB_PORT=7488 clidev hub",
          ]);
        }
        throw error;
      }

      const shutdown = (): void => {
        void hub.close().then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      if (quiet) return;
      success("clidev hub is running");
      box("hub", [
        ["inbox", hub.url],
        ["listens", "127.0.0.1 only, token-protected"],
        ["stop", "Ctrl+C, or clidev hub --stop"],
      ]);
    });
}

export function createInboxCommand(): Command {
  return new Command("inbox")
    .description("Open the inbox where you answer your agents (starts the hub if needed)")
    .option("--no-open", "print the URL instead of opening a browser")
    .action(async (options: { open?: boolean }) => {
      const hub = await connectHub();
      if (hub === null) {
        throw new CliError("Could not start the clidev hub.", 1, [
          "Run `clidev hub` in a terminal to see why.",
        ]);
      }
      const url = `${hubBase()}/`;
      if (options.open !== false && openInBrowser(url)) {
        success(`inbox opened: ${url}`);
        hint("hold your Wispr key, speak your reply, press Ctrl+Enter");
        return;
      }
      payload(url);
    });
}
