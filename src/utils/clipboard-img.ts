import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, unlinkSync } from "node:fs";
import { mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { screenshotFileName, screenshotsDir, uniqueFilePath } from "./paths.js";
import { hasCommand } from "./shell.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class ClipboardImageError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[] = []) {
    super(message);
    this.name = "ClipboardImageError";
    this.hints = hints;
  }
}

export interface CaptureOptions {
  dir?: string;
  keep?: number;
}

export interface CapturedScreenshot {
  filePath: string;
  bytes: number;
  platform: NodeJS.Platform;
  pruned: number;
}

/** The Windows clipboard sequence lets a companion skip unchanged contents. */
export function windowsClipboardSequence(): number | null {
  if (process.platform !== "win32") return null;

  const script = [
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class ClidevClipboardSequence {",
    "  [DllImport(\"user32.dll\")] public static extern uint GetClipboardSequenceNumber();",
    "}",
    "'@",
    "[ClidevClipboardSequence]::GetClipboardSequenceNumber()",
  ].join("\n");

  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 5_000, windowsHide: true, encoding: "utf8" },
    );
    const value = Number.parseInt((result.stdout ?? "").trim(), 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Streams sequence numbers from one hidden PowerShell process. Starting a new
 * PowerShell process for every poll would make an always-on companion noisy.
 */
export function watchWindowsClipboardSequence(
  intervalMs: number,
  onSequence: (sequence: number) => void,
): () => void {
  if (process.platform !== "win32") return () => undefined;

  const script = [
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class ClidevClipboardSequence {",
    "  [DllImport(\"user32.dll\")] public static extern uint GetClipboardSequenceNumber();",
    "}",
    "'@",
    "while ($true) {",
    "  [Console]::WriteLine([ClidevClipboardSequence]::GetClipboardSequenceNumber())",
    `  Start-Sleep -Milliseconds ${intervalMs}`,
    "}",
  ].join("\n");

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  child.stdout?.setEncoding("utf8");
  let pending = "";
  child.stdout?.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const sequence = Number.parseInt(line.trim(), 10);
      if (Number.isFinite(sequence)) onSequence(sequence);
    }
  });

  return () => {
    try {
      child.kill();
    } catch {
      // The process has already stopped.
    }
  };
}

/**
 * Adds text beside the image rather than replacing it. Rich composers may
 * choose the bitmap; ordinary terminals paste the text reference.
 */
export function addWindowsClipboardTextForImage(filePath: string, text: string): boolean {
  if (process.platform !== "win32") return false;

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$image = [System.Drawing.Image]::FromFile($env:CLIDEV_BRIDGE_IMAGE)",
    "try {",
    "  $data = New-Object System.Windows.Forms.DataObject",
    "  $data.SetImage($image)",
    "  $data.SetText($env:CLIDEV_BRIDGE_TEXT, [System.Windows.Forms.TextDataFormat]::UnicodeText)",
    "  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)",
    "} finally {",
    "  $image.Dispose()",
    "}",
  ].join("\n");

  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        timeout: 10_000,
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, CLIDEV_BRIDGE_IMAGE: filePath, CLIDEV_BRIDGE_TEXT: text },
      },
    );
    return result.status === 0 && result.error === undefined;
  } catch {
    return false;
  }
}

interface CaptureAttempt {
  ok: boolean;
  detail: string;
}

function removeQuietly(filePath: string): Promise<boolean> {
  return unlink(filePath).then(
    () => true,
    () => false,
  );
}

function runToFile(command: string, args: string[], target: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const file = createWriteStream(target);
    child.stdout?.pipe(file);

    child.on("error", () => {
      file.destroy();
      finish(false);
    });
    child.on("close", (code) => {
      file.end(() => finish(code === 0));
    });

    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 20_000);
    timer.unref();
  });
}

async function isValidPng(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (info.size < 32) return false;

    const handle = await open(filePath, "r");
    try {
      const header = Buffer.alloc(PNG_SIGNATURE.length);
      await handle.read(header, 0, header.length, 0);
      return header.equals(PNG_SIGNATURE);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function captureWindows(target: string): CaptureAttempt {
  const escaped = target.replace(/'/gu, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    `$path = '${escaped}'`,
    "try { $img = [System.Windows.Forms.Clipboard]::GetImage() } catch { $img = $null }",
    "if ($img) {",
    "  $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  $img.Dispose()",
    "  exit 0",
    "}",
    "try { $files = [System.Windows.Forms.Clipboard]::GetFileDropList() } catch { $files = $null }",
    "if ($files) {",
    "  foreach ($file in $files) {",
    "    if ($file -match '\\.(png|jpe?g|bmp|gif|webp|tiff?)$') {",
    "      try {",
    "        $source = [System.Drawing.Image]::FromFile($file)",
    "        $source.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)",
    "        $source.Dispose()",
    "        exit 0",
    "      } catch { }",
    "    }",
    "  }",
    "}",
    "exit 1",
  ].join("\n");

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    { timeout: 20_000, windowsHide: true, encoding: "utf8" },
  );

  if (result.error) {
    return { ok: false, detail: result.error.message };
  }
  if (result.status === 0) return { ok: true, detail: "" };

  return { ok: false, detail: (result.stderr ?? "").trim() };
}

function runAppleScript(script: string): CaptureAttempt {
  const result = spawnSync("osascript", ["-e", script], {
    timeout: 15_000,
    encoding: "utf8",
  });
  if (result.error) return { ok: false, detail: result.error.message };
  if (result.status === 0) return { ok: true, detail: "" };
  return { ok: false, detail: (result.stderr ?? "").trim() };
}

function appleScriptFor(target: string, format: "PNGf" | "TIFF"): string {
  const escaped = target.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  return [
    `set targetFile to POSIX file "${escaped}"`,
    "try",
    `  set imageData to the clipboard as «class ${format}»`,
    "on error",
    '  error "no-image" number 1',
    "end try",
    "set fileHandle to open for access targetFile with write permission",
    "set eof fileHandle to 0",
    "write imageData to fileHandle",
    "close access fileHandle",
  ].join("\n");
}

function captureMac(target: string): CaptureAttempt {
  if (hasCommand("pngpaste")) {
    const result = spawnSync("pngpaste", [target], { timeout: 15_000, encoding: "utf8" });
    if (result.status === 0 && !result.error) return { ok: true, detail: "" };
    if (result.error) return { ok: false, detail: result.error.message };
  }

  const png = runAppleScript(appleScriptFor(target, "PNGf"));
  if (png.ok) return png;

  // Some apps put only a TIFF on the pasteboard; sips is bundled with macOS.
  const tiffPath = `${target}.tiff`;
  const tiff = runAppleScript(appleScriptFor(tiffPath, "TIFF"));
  if (tiff.ok) {
    const converted = spawnSync("sips", ["-s", "format", "png", tiffPath, "--out", target], {
      timeout: 15_000,
      stdio: "ignore",
    });
    try {
      unlinkSync(tiffPath);
    } catch {
      // best effort cleanup
    }
    if (!converted.error && converted.status === 0) return { ok: true, detail: "" };
  }

  return { ok: false, detail: png.detail || tiff.detail };
}

async function captureLinux(target: string): Promise<CaptureAttempt> {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === "wayland";
  const attempts: Array<{ tool: string; args: string[] }> = [];

  if (hasCommand("wl-paste")) {
    attempts.push({ tool: "wl-paste", args: ["--type", "image/png"] });
  }
  if (hasCommand("xclip")) {
    attempts.push({ tool: "xclip", args: ["-selection", "clipboard", "-t", "image/png", "-o"] });
  }

  if (attempts.length === 0) {
    return { ok: false, detail: "neither wl-paste nor xclip is installed" };
  }

  for (const attempt of attempts) {
    if (await runToFile(attempt.tool, attempt.args, target)) return { ok: true, detail: "" };
  }

  return {
    ok: false,
    detail: wayland
      ? "wl-paste could not read an image/png from the Wayland clipboard"
      : "xclip could not read an image/png from the X11 clipboard",
  };
}

function failureHints(platform: NodeJS.Platform, detail: string): string[] {
  const hints: string[] = [];

  if (platform === "win32") {
    hints.push("Press Win+Shift+S to snip a region — it lands on the clipboard.");
    hints.push("Copying an image file in Explorer also works (PNG, JPG, BMP, GIF).");
  } else if (platform === "darwin") {
    hints.push("Press Cmd+Ctrl+Shift+4 to capture a region straight to the clipboard.");
    hints.push("For the fastest path: brew install pngpaste.");
  } else if (platform === "linux") {
    hints.push("Wayland: sudo apt install wl-clipboard   ·   X11: sudo apt install xclip");
    hints.push("GNOME: Ctrl+Shift+PrintScreen copies a screenshot to the clipboard.");
  }

  if (detail.length > 0) hints.push(`detail: ${detail}`);
  return hints;
}

async function pruneScreenshots(directory: string, keep: number, keepFile: string): Promise<number> {
  if (keep <= 0) return 0;

  try {
    const names = (await readdir(directory)).filter((name) => /^shot_.*\.png$/u.test(name));
    if (names.length <= keep) return 0;

    const entries = await Promise.all(
      names.map(async (name) => {
        const full = path.join(directory, name);
        if (full === keepFile) return null;
        try {
          const info = await stat(full);
          return { full, time: info.mtimeMs };
        } catch {
          return null;
        }
      }),
    );

    const files = entries
      .filter((entry): entry is { full: string; time: number } => entry !== null)
      .sort((left, right) => right.time - left.time);

    let pruned = 0;
    for (const file of files.slice(Math.max(0, keep - 1))) {
      if (await removeQuietly(file.full)) pruned += 1;
    }
    return pruned;
  } catch {
    return 0;
  }
}

/**
 * Reads the system clipboard image, writes a validated PNG under
 * `~/.clidev/screenshots/`, prunes old captures and returns the absolute path.
 */
export async function captureClipboardImage(
  options: CaptureOptions = {},
): Promise<CapturedScreenshot> {
  const directory = screenshotsDir(options.dir);
  await mkdir(directory, { recursive: true });
  const target = await uniqueFilePath(directory, screenshotFileName());

  let attempt: CaptureAttempt;
  switch (process.platform) {
    case "win32":
      attempt = captureWindows(target);
      break;
    case "darwin":
      attempt = captureMac(target);
      break;
    case "linux":
      attempt = await captureLinux(target);
      break;
    default:
      throw new ClipboardImageError(
        `clidev paste does not support ${process.platform} yet.`,
        ["Copy the image to a file and use an @path reference instead."],
      );
  }

  if (!attempt.ok || !(await isValidPng(target))) {
    await removeQuietly(target);
    throw new ClipboardImageError(
      "No image found on the clipboard.",
      failureHints(process.platform, attempt.detail),
    );
  }

  const info = await stat(target);
  const pruned = await pruneScreenshots(directory, options.keep ?? 100, target);

  return { filePath: target, bytes: info.size, platform: process.platform, pruned };
}
