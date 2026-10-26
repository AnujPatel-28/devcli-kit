import { Command } from "commander";

import {
  ClipboardImageError,
  addWindowsClipboardTextForImage,
  captureClipboardImage,
  watchWindowsClipboardSequence,
} from "../utils/clipboard-img.js";
import { CliError } from "../utils/errors.js";
import { formatBytes } from "../utils/format.js";
import { box, hint, success, warn, writeErr } from "../utils/logger.js";
import { sendNotification } from "../utils/notifier.js";

export type BridgeFormat = "at" | "path" | "prompt";

interface BridgeOptions {
  out?: string;
  keep?: string;
  interval?: string;
  format?: BridgeFormat;
  once?: boolean;
  notify?: boolean;
}

export function bridgeText(filePath: string, format: BridgeFormat): string {
  switch (format) {
    case "path":
      return filePath;
    case "prompt":
      return `Please inspect this screenshot: ${filePath}`;
    case "at":
      return `@${filePath}`;
  }
}

function parseBoundedInt(value: string | undefined, fallback: number, flag: string, min: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new CliError(`${flag} must be an integer of at least ${min}`, 2);
  }
  return parsed;
}

async function bridgeCurrentClipboard(options: {
  out?: string;
  keep: number;
  format: BridgeFormat;
  notify: boolean;
}): Promise<{ path: string; text: string; bytes: number }> {
  const captured = await captureClipboardImage({ dir: options.out, keep: options.keep });
  const text = bridgeText(captured.filePath, options.format);

  if (!addWindowsClipboardTextForImage(captured.filePath, text)) {
    throw new CliError("Could not add the image reference to the Windows clipboard.", 1, [
      "Another app may be holding the clipboard. Take the screenshot again.",
    ]);
  }

  if (options.notify) {
    await sendNotification({
      title: "clidev screenshot ready",
      message: "Focus an agent and press Ctrl+V to paste its image reference.",
      bell: false,
    });
  }

  return { path: captured.filePath, text, bytes: captured.bytes };
}

export function createBridgeCommand(): Command {
  return new Command("bridge")
    .description("Keep clipboard screenshots pasteable as image references in terminal agents (Windows preview)")
    .option("--out <dir>", "save screenshots into <dir> instead of ~/.clidev/screenshots")
    .option("--keep <count>", "keep only the newest <count> captures", "100")
    .option("--interval <ms>", "clipboard poll interval in milliseconds", "500")
    .option("--format <kind>", "text pasted into a terminal: at, path, or prompt", "at")
    .option("--once", "bridge the image currently on the clipboard, then exit")
    .option("--no-notify", "do not show the screenshot-ready toast")
    .addHelpText(
      "after",
      `
Examples:
  $ clidev bridge                         # start the opt-in Windows clipboard companion
  $ clidev bridge --once                  # verify the screenshot currently on the clipboard
  $ clidev bridge --format prompt         # Ctrl+V: Please inspect this screenshot: C:\\...

When an image reaches the Windows clipboard, bridge saves a PNG and adds text
alongside the bitmap. Rich chat composers can still choose the image; text-only
agent terminals receive the @path reference when you press Ctrl+V. Press Ctrl+C
to stop. It cannot infer completion for every interactive agent: use an agent
hook where available, or clidev watch as the portable process-exit fallback.`,
    )
    .action(async (options: BridgeOptions) => {
      if (process.platform !== "win32") {
        throw new CliError("clidev bridge is currently a Windows preview.", 1, [
          "Use `clp --at` for the explicit cross-platform screenshot path workflow.",
        ]);
      }

      const keep = parseBoundedInt(options.keep, 100, "--keep", 0);
      const interval = parseBoundedInt(options.interval, 500, "--interval", 100);
      const format = options.format ?? "at";
      if (format !== "at" && format !== "path" && format !== "prompt") {
        throw new CliError("--format must be one of: at, path, prompt", 2);
      }

      const settings = { out: options.out, keep, format, notify: options.notify !== false };
      const showCapture = (result: { path: string; text: string; bytes: number }): void => {
        success("clipboard screenshot bridged");
        box("Ctrl+V is ready", [
          ["file", result.path],
          ["size", formatBytes(result.bytes)],
          ["terminal text", result.text],
          ["next", "focus a text-only agent input and press Ctrl+V"],
        ]);
      };

      if (options.once === true) {
        showCapture(await bridgeCurrentClipboard(settings));
        return;
      }

      writeErr("clidev bridge is running — screenshots will become pasteable @paths. Press Ctrl+C to stop.\n");
      let processing = false;
      let lastSequence: number | null = null;
      let ignoreBridgeSequence = false;
      const stopWatching = watchWindowsClipboardSequence(interval, async (sequence) => {
        if (lastSequence === null) {
          lastSequence = sequence;
          return;
        }
        if (processing) return;
        if (sequence === lastSequence) return;
        if (ignoreBridgeSequence) {
          lastSequence = sequence;
          ignoreBridgeSequence = false;
          return;
        }

        processing = true;
        lastSequence = sequence;
        try {
          showCapture(await bridgeCurrentClipboard(settings));
          // Writing the combined image + text payload produces one expected
          // sequence change. Ignore it so the same screenshot is not re-saved.
          ignoreBridgeSequence = true;
        } catch (error) {
          // Copying ordinary text is expected and must remain silent.
          if (!(error instanceof ClipboardImageError)) {
            warn(error instanceof Error ? error.message : String(error));
          }
        } finally {
          processing = false;
        }
      });

      await new Promise<void>((resolve) => {
        const stop = (): void => {
          stopWatching();
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
          hint("clipboard bridge stopped");
          resolve();
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      });
    });
}
