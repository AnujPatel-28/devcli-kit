import clipboardy from "clipboardy";

/** Clipboard writes are best-effort: a headless machine has no clipboard. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await clipboardy.write(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboard(): Promise<string | null> {
  try {
    return await clipboardy.read();
  } catch {
    return null;
  }
}

export function pngToDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
