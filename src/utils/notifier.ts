import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import notifier from "node-notifier";

import { hasCommand } from "./shell.js";

export interface NotifyRequest {
  title: string;
  message: string;
  sound?: boolean;
  bell?: boolean;
}

export interface NotifyOutcome {
  delivered: boolean;
  via: string;
  bellRung: boolean;
  detail?: string;
}

const NOTIFY_TIMEOUT_MS = 5_000;

function ringBell(): void {
  try {
    process.stderr.write("\u0007");
  } catch {
    // A closed stderr is not a reason to crash a build.
  }
}

function notifyViaNodeNotifier(request: NotifyRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, NOTIFY_TIMEOUT_MS);
    try {
      notifier.notify(
        {
          title: request.title,
          message: request.message,
          sound: request.sound === true,
          wait: false,
          timeout: 5,
        },
        (error: Error | null) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Native toasts come from node-notifier first. If its bundled helper is blocked
 * (locked-down Windows, missing libnotify, headless CI) we fall back to the OS
 * native command. Values travel as environment variables / argv, never as
 * interpolated shell code.
 */
function notifyViaPlatform(request: NotifyRequest): boolean {
  try {
    if (process.platform === "win32") {
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
        "$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
        "$texts = $template.GetElementsByTagName('text')",
        "$texts.Item(0).AppendChild($template.CreateTextNode($env:CLIDEV_TITLE)) | Out-Null",
        "$texts.Item(1).AppendChild($template.CreateTextNode($env:CLIDEV_MESSAGE)) | Out-Null",
        "$toast = [Windows.UI.Notifications.ToastNotification]::new($template)",
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('clidev').Show($toast)",
      ].join("; ");

      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        {
          timeout: 8_000,
          windowsHide: true,
          stdio: "ignore",
          env: { ...process.env, CLIDEV_TITLE: request.title, CLIDEV_MESSAGE: request.message },
        },
      );
      return result.status === 0;
    }

    if (process.platform === "darwin") {
      const script =
        'display notification (system attribute "CLIDEV_MESSAGE") with title (system attribute "CLIDEV_TITLE")';
      const result = spawnSync("osascript", ["-e", script], {
        timeout: 8_000,
        stdio: "ignore",
        env: { ...process.env, CLIDEV_TITLE: request.title, CLIDEV_MESSAGE: request.message },
      });
      return result.status === 0;
    }

    if (hasCommand("notify-send")) {
      const result = spawnSync("notify-send", ["--app-name=clidev", request.title, request.message], {
        timeout: 8_000,
        stdio: "ignore",
      });
      return result.status === 0;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * node-notifier's Windows toaster opens a named pipe and waits for the toast's
 * whole lifecycle (~10s), which blows a Claude hook timeout. Its bundled
 * SnoreToast binary does the same job in ~300ms, so we call that directly and
 * keep node-notifier as a cross-platform fallback.
 */
function snoreToastExecutable(): string | null {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const packageJson = requireFromHere.resolve("node-notifier/package.json");
    const binary = process.arch === "x64" ? "snoretoast-x64.exe" : "snoretoast-x86.exe";
    const candidate = path.join(path.dirname(packageJson), "vendor", "snoreToast", binary);
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

interface Attempt {
  delivered: boolean;
  detail?: string;
}

function notifyViaSnoreToast(executable: string, request: NotifyRequest): Promise<Attempt> {
  const args = ["-t", request.title, "-m", request.message];
  if (request.sound === true) {
    args.push("-s", "Notification.Default");
  } else {
    args.push("-silent");
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (attempt: Attempt): void => {
      if (settled) return;
      settled = true;
      resolve(attempt);
    };

    // SnoreToast stays alive for the toast's lifetime, so it must not hold our
    // process open. A detached spawn resolves as soon as the binary starts.
    const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true });

    child.once("error", (error) => finish({ delivered: false, detail: error.message }));
    child.once("spawn", () => {
      child.unref();
      finish({ delivered: true });
    });

    const timer = setTimeout(() => finish({ delivered: true }), 1_500);
    timer.unref();
  });
}

export async function sendNotification(request: NotifyRequest): Promise<NotifyOutcome> {
  const title = request.title.trim().length > 0 ? request.title.trim() : "clidev";
  const message = request.message.trim().length > 0 ? request.message.trim() : "Done";
  const bellRung = request.bell !== false;
  const payloadRequest: NotifyRequest = { ...request, title, message };

  if (bellRung) ringBell();

  let detail: string | undefined;

  if (process.platform === "win32") {
    const executable = snoreToastExecutable();
    if (executable !== null) {
      const result = await notifyViaSnoreToast(executable, payloadRequest);
      if (result.delivered) return { delivered: true, via: "snoretoast", bellRung };
      detail = result.detail;
    }
    if (notifyViaPlatform(payloadRequest)) {
      return { delivered: true, via: "powershell-toast", bellRung };
    }
  }

  try {
    await notifyViaNodeNotifier(payloadRequest);
    return { delivered: true, via: "node-notifier", bellRung };
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }

  if (process.platform !== "win32" && notifyViaPlatform(payloadRequest)) {
    const via = process.platform === "darwin" ? "osascript" : "notify-send";
    return { delivered: true, via, bellRung };
  }

  return {
    delivered: false,
    via: "none",
    bellRung,
    detail: detail ?? "no native notifier available",
  };
}
