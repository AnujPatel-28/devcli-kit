import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** `~` and `~/x` are expanded so flags behave the way a shell user expects. */
export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/** Overridable so tests never touch the real home directory. */
export function clidevHome(): string {
  const override = process.env.CLIDEV_HOME?.trim();
  return override ? path.resolve(expandHome(override)) : path.join(os.homedir(), ".clidev");
}

export function screenshotsDir(customDir?: string): string {
  if (customDir && customDir.trim().length > 0) {
    return path.resolve(expandHome(customDir));
  }
  return path.join(clidevHome(), "screenshots");
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** `shot_20261026-140122.png` — sorts lexicographically by capture time. */
export function screenshotTimestamp(date = new Date()): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${clock}`;
}

export function screenshotFileName(date = new Date()): string {
  return `shot_${screenshotTimestamp(date)}.png`;
}

/**
 * Two captures inside the same second must not overwrite each other, so we
 * fall back to `-1`, `-2`, ... suffixes.
 */
export async function uniqueFilePath(directory: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  const candidates = [path.join(directory, fileName)];
  for (let index = 1; index < 1000; index += 1) {
    candidates.push(path.join(directory, `${stem}-${index}${extension}`));
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(directory, `${stem}-${Date.now()}${extension}`);
}
