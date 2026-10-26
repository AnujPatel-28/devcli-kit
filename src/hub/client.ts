import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { HubEvent, Reply } from "./protocol.js";
import { hubPort, tokenPath } from "./server.js";

const START_TIMEOUT_MS = 5_000;
const WAIT_CHUNK_MS = 50_000;

export interface HubConnection {
  base: string;
  token: string;
}

export function hubBase(): string {
  return `http://127.0.0.1:${hubPort()}`;
}

async function isHubUp(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) });
    const body = (await response.json()) as { app?: string };
    return body.app === "clidev-hub";
  } catch {
    return false;
  }
}

async function readToken(): Promise<string | null> {
  try {
    const token = (await readFile(tokenPath(), "utf8")).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Starts `clidev hub` detached, using the same node + script that is running now. */
function spawnHub(): void {
  const script = process.argv[1];
  if (script === undefined) return;
  const child = spawn(process.execPath, [path.resolve(script), "hub", "--background"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

/** Connects to the running hub, starting one in the background when needed. */
export async function connectHub(options: { start?: boolean } = {}): Promise<HubConnection | null> {
  const base = hubBase();
  let up = await isHubUp(base);
  if (!up && options.start !== false) {
    spawnHub();
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!up && Date.now() < deadline) {
      await delay(150);
      up = await isHubUp(base);
    }
  }
  if (!up) return null;

  // The hub writes its token right after it starts listening.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const token = await readToken();
    if (token !== null) return { base, token };
    await delay(100);
  }
  return null;
}

async function call<T>(hub: HubConnection, route: string, body: unknown, timeoutMs = 5_000): Promise<T> {
  const response = await fetch(`${hub.base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-clidev-token": hub.token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`hub answered ${response.status} for ${route}`);
  return (await response.json()) as T;
}

export async function reportEvent(hub: HubConnection, event: HubEvent): Promise<string | null> {
  const result = await call<{ askId: string | null }>(hub, "/api/events", event);
  return result.askId;
}

/**
 * Waits up to `totalMs` for a reply, in chunks, so a long wait survives HTTP
 * idle limits. Marks the ask expired when time runs out so the inbox shows it.
 */
export async function waitForReply(hub: HubConnection, askId: string, totalMs: number): Promise<Reply | null> {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    const chunk = Math.min(WAIT_CHUNK_MS, deadline - Date.now());
    let result: { status: string; reply: Reply | null };
    try {
      result = await call(hub, `/api/asks/${askId}/wait`, { timeoutMs: chunk }, chunk + 10_000);
    } catch {
      return null; // hub went away: let the agent fall back to its own prompt
    }
    if (result.reply !== null) return result.reply;
    if (result.status !== "open") return null;
  }
  await call(hub, `/api/asks/${askId}/expire`, {}).catch(() => undefined);
  return null;
}
