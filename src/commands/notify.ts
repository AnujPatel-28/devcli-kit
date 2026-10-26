import { Command } from "commander";

import { payload, success, warn } from "../utils/logger.js";
import { sendNotification } from "../utils/notifier.js";

interface NotifyOptions {
  title?: string;
  message?: string;
  sound?: boolean;
  bell?: boolean;
  json?: boolean;
}

export function createNotifyCommand(): Command {
  return new Command("notify")
    .description("Fire a native desktop notification and ring the terminal bell")
    .option("-t, --title <title>", "notification title", "clidev")
    .option("-m, --message <message>", "notification body", "Done")
    .option("--sound", "ask the OS to play the notification sound")
    .option("--no-bell", "do not ring the terminal bell")
    .option("--json", "emit machine-readable JSON on stdout")
    .addHelpText(
      "after",
      `
Examples:
  $ clidev notify --title "Claude Code" --message "Task finished"
  $ clidev notify -t Build -m "tests passed" --sound

This is the exact command the Claude Code hooks call. It never exits non-zero
because a blocked toast must not break your pipeline.`,
    )
    .action(async (options: NotifyOptions) => {
      const result = await sendNotification({
        title: options.title ?? "clidev",
        message: options.message ?? "Done",
        sound: options.sound === true,
        bell: options.bell !== false,
      });

      if (options.json === true) {
        payload(JSON.stringify(result, null, 2));
        return;
      }

      if (result.delivered) {
        success(`notification delivered via ${result.via}`);
        return;
      }

      warn(
        result.detail
          ? `toast blocked (${result.detail}) — terminal bell still fired`
          : "toast blocked — terminal bell still fired",
      );
    });
}
