import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { sendNotification } from "../utils/notifier.js";
import { clidevHome } from "../utils/paths.js";
import { renderInboxPage } from "./inbox-page.js";
import { agentLabel, shortSummary, type Ask, type HistoryRecord, type HubEvent, type Reply } from "./protocol.js";
import { HubStore } from "./store.js";

export const DEFAULT_HUB_PORT = 7477;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_WAIT_MS = 60_000;

export function hubPort(): number {
  const raw = Number.parseInt(process.env.CLIDEV_HUB_PORT ?? "", 10);
  return Number.isInteger(raw) && raw > 0 && raw < 65_536 ? raw : DEFAULT_HUB_PORT;
}

export function hubDir(): string {
  return path.join(clidevHome(), "hub");
}

export const tokenPath = (): string => path.join(hubDir(), "token");
const historyPath = (): string => path.join(hubDir(), "history.jsonl");

export interface HubOptions {
  port?: number;
  /** Show native toasts for new asks. Off in tests. */
  notify?: boolean;
  /** Persist the token and history under ~/.clidev/hub. Off in tests. */
  persist?: boolean;
  token?: string;
  log?: (line: string) => void;
}

export interface RunningHub {
  url: string;
  port: number;
  token: string;
  store: HubStore;
  close: () => Promise<void>;
}

async function loadHistory(): Promise<HistoryRecord[]> {
  try {
    const raw = await readFile(historyPath(), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as HistoryRecord];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function readBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(body: unknown): HubEvent | null {
  if (!isRecord(body)) return null;
  const { agent, sessionId, kind } = body;
  if (typeof agent !== "string" || typeof sessionId !== "string" || typeof kind !== "string") return null;
  const event: HubEvent = { agent, sessionId, kind: kind as HubEvent["kind"] };
  for (const field of ["cwd", "summary", "tool", "detail"] as const) {
    const value = body[field];
    if (typeof value === "string") event[field] = value;
  }
  if (body.canReply === false) event.canReply = false;
  return event;
}

function parseReply(body: unknown): Reply | null {
  if (!isRecord(body)) return null;
  const reply: Reply = {};
  if (typeof body.text === "string") reply.text = body.text;
  if (body.decision === "allow" || body.decision === "deny" || body.decision === "terminal") {
    reply.decision = body.decision;
  }
  return reply.text === undefined && reply.decision === undefined ? null : reply;
}

function toastFor(ask: Ask): { title: string; message: string } {
  const who = `${agentLabel(ask.agent)} · ${ask.project}`;
  if (ask.kind === "permission") {
    return { title: `${who} needs permission`, message: shortSummary(`${ask.tool ?? "tool"}: ${ask.detail ?? ""}`, 160) };
  }
  if (ask.kind === "question") {
    return { title: `${who} has a question`, message: shortSummary(ask.detail ?? ask.summary, 160) };
  }
  return { title: `${who} finished`, message: shortSummary(ask.summary, 160) };
}

/**
 * The local hub: one place every agent reports to, and the inbox you answer
 * from. Bound to 127.0.0.1, every API call needs the token, and the Host
 * header must be ours, so other websites (and DNS rebinding) cannot reach it.
 */
export async function startHub(options: HubOptions = {}): Promise<RunningHub> {
  const persist = options.persist !== false;
  const log = options.log ?? (() => undefined);
  const token = options.token ?? randomBytes(24).toString("hex");

  if (persist) await mkdir(hubDir(), { recursive: true });
  const store = new HubStore({
    history: persist ? await loadHistory() : [],
    onRecord: (record) => {
      if (persist) void appendFile(historyPath(), `${JSON.stringify(record)}\n`).catch(() => undefined);
    },
  });

  let port = options.port ?? hubPort();

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) send(response, 400, { error: error instanceof Error ? error.message : String(error) });
      else response.end();
    });
  });

  const allowedHosts = (): Set<string> => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (!allowedHosts().has(request.headers.host ?? "")) {
      send(response, 403, { error: "unexpected host" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:",
        "x-frame-options": "DENY",
      });
      response.end(renderInboxPage(token));
      return;
    }

    if (method === "GET" && url.pathname === "/api/health") {
      send(response, 200, { ok: true, app: "clidev-hub", pid: process.pid });
      return;
    }

    if (request.headers["x-clidev-token"] !== token) {
      send(response, 401, { error: "missing or wrong token" });
      return;
    }

    if (method === "GET" && url.pathname === "/api/state") {
      send(response, 200, store.snapshot());
      return;
    }

    if (method === "POST" && url.pathname === "/api/events") {
      const event = parseEvent(await readBody(request));
      if (event === null) {
        send(response, 400, { error: "expected { agent, sessionId, kind }" });
        return;
      }
      const result = store.report(event);
      if (result.ask !== undefined) {
        log(`${agentLabel(event.agent)} · ${result.ask.project}: ${result.ask.kind}`);
        if (options.notify !== false) {
          const toast = toastFor(result.ask);
          void sendNotification({ ...toast, sound: true, bell: false }).catch(() => undefined);
        }
      }
      send(response, 200, { askId: result.ask?.id ?? null, state: result.session.state });
      return;
    }

    const askRoute = /^\/api\/asks\/([\w-]+)\/(wait|reply|expire)$/u.exec(url.pathname);
    if (method === "POST" && askRoute !== null) {
      const id = askRoute[1] ?? "";
      const action = askRoute[2];
      const body = await readBody(request);

      if (action === "wait") {
        const requested = isRecord(body) && typeof body.timeoutMs === "number" ? body.timeoutMs : MAX_WAIT_MS;
        const ask = store.getAsk(id);
        if (ask === undefined) {
          send(response, 404, { error: "unknown ask" });
          return;
        }
        const reply = await store.waitFor(id, Math.min(Math.max(requested, 0), MAX_WAIT_MS));
        send(response, 200, { status: store.getAsk(id)?.status ?? "gone", reply });
        return;
      }

      if (action === "expire") {
        store.expire(id);
        send(response, 200, { ok: true });
        return;
      }

      const reply = parseReply(body);
      if (reply === null) {
        send(response, 400, { error: "expected { text } or { decision }" });
        return;
      }
      const accepted = store.reply(id, reply);
      send(response, accepted ? 200 : 409, accepted ? { ok: true } : { error: "this ask is no longer open" });
      return;
    }

    if (method === "POST" && url.pathname === "/api/shutdown") {
      send(response, 200, { ok: true });
      setImmediate(() => void close());
      return;
    }

    send(response, 404, { error: "not found" });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  // Only the instance that owns the port publishes a token.
  if (persist) await writeFile(tokenPath(), token, { encoding: "utf8", mode: 0o600 });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    if (persist) await rm(tokenPath(), { force: true });
  };

  return { url: `http://127.0.0.1:${port}/`, port, token, store, close };
}
