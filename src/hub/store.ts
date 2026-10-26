import { randomUUID } from "node:crypto";

import {
  ASK_KINDS,
  computeStats,
  countWords,
  projectName,
  shortSummary,
  type Ask,
  type AskKind,
  type HistoryRecord,
  type HubEvent,
  type HubSnapshot,
  type Reply,
  type Session,
} from "./protocol.js";

export interface ReportResult {
  session: Session;
  /** Present when the event opened a new ask the user should hear about. */
  ask?: Ask;
}

export interface StoreOptions {
  now?: () => number;
  history?: HistoryRecord[];
  onRecord?: (record: HistoryRecord) => void;
}

const RECENT_LIMIT = 20;
/** Closed asks stay readable so a relay re-polling between chunks still gets its reply. */
const CLOSED_LIMIT = 200;

/**
 * Sessions and asks for every agent the hub has heard from. Pure state: no
 * sockets, no files, no clock unless one is injected, so it is fully testable.
 */
export class HubStore {
  private readonly sessions = new Map<string, Session>();
  private readonly asks = new Map<string, Ask>();
  private readonly waiters = new Map<string, Set<(reply: Reply | null) => void>>();
  private readonly closed: string[] = [];
  private readonly recent: Ask[] = [];
  private readonly history: HistoryRecord[];
  private readonly now: () => number;
  private readonly onRecord: (record: HistoryRecord) => void;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.history = [...(options.history ?? [])];
    this.onRecord = options.onRecord ?? (() => undefined);
  }

  report(event: HubEvent): ReportResult {
    const key = `${event.agent}:${event.sessionId}`;
    const at = this.now();
    const session: Session = this.sessions.get(key) ?? {
      key,
      agent: event.agent,
      sessionId: event.sessionId,
      project: projectName(event.cwd),
      state: "working",
      updatedAt: at,
    };
    if (event.cwd !== undefined) {
      session.cwd = event.cwd;
      session.project = projectName(event.cwd);
    }
    session.updatedAt = at;
    this.sessions.set(key, session);

    // Anything new from the agent means an older question is no longer the
    // one it is waiting on.
    const previous = session.openAskId === undefined ? undefined : this.asks.get(session.openAskId);

    if (event.kind === "notice") {
      // Notices duplicate a richer ask (Claude's idle / permission pings), so
      // they only matter when nothing is open yet.
      if (previous?.status === "open") return { session };
      session.state = "waiting";
      if (event.summary !== undefined) session.summary = shortSummary(event.summary);
      return { session };
    }

    if (previous?.status === "open") this.close(previous, "superseded");
    delete session.openAskId;

    if (event.kind === "working") {
      session.state = "working";
      if (event.summary !== undefined) session.summary = shortSummary(event.summary);
      return { session };
    }

    if (event.kind === "ended") {
      session.state = "ended";
      return { session };
    }

    if (!ASK_KINDS.includes(event.kind)) return { session };

    const ask: Ask = {
      id: randomUUID(),
      agent: event.agent,
      sessionId: event.sessionId,
      kind: event.kind as AskKind,
      project: session.project,
      summary: shortSummary(event.summary, 600),
      canReply: event.canReply !== false,
      createdAt: at,
      status: "open",
    };
    if (event.tool !== undefined) ask.tool = event.tool;
    if (event.detail !== undefined) ask.detail = event.detail;

    this.asks.set(ask.id, ask);
    session.openAskId = ask.id;
    session.state = event.kind === "done" ? "done" : "waiting";
    session.summary = shortSummary(
      event.kind === "done" ? event.summary : `${event.tool ?? "tool"}: ${event.detail ?? event.summary ?? ""}`,
    );
    return { session, ask };
  }

  getAsk(id: string): Ask | undefined {
    return this.asks.get(id);
  }

  /** Returns false when the ask is unknown or no longer open. */
  reply(id: string, reply: Reply): boolean {
    const ask = this.asks.get(id);
    if (ask?.status !== "open") return false;

    const text = reply.text?.trim();
    ask.reply = {};
    if (text) ask.reply.text = text;
    if (reply.decision !== undefined) ask.reply.decision = reply.decision;
    ask.answeredAt = this.now();
    this.close(ask, "answered");

    const session = this.sessions.get(`${ask.agent}:${ask.sessionId}`);
    if (session !== undefined && session.openAskId === ask.id) {
      delete session.openAskId;
      const continues = ask.reply.decision !== "terminal" && (ask.kind !== "done" || ask.reply.text !== undefined);
      session.state = continues ? "working" : session.state;
      session.updatedAt = ask.answeredAt;
    }
    return true;
  }

  /** Resolves with the reply, or null when it expires, is superseded or times out. */
  waitFor(id: string, timeoutMs: number): Promise<Reply | null> {
    const ask = this.asks.get(id);
    if (ask === undefined) return Promise.resolve(null);
    if (ask.status === "answered") return Promise.resolve(ask.reply ?? null);
    if (ask.status !== "open") return Promise.resolve(null);

    return new Promise((resolve) => {
      const set = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, set);
      const done = (reply: Reply | null): void => {
        clearTimeout(timer);
        set.delete(done);
        resolve(reply);
      };
      const timer = setTimeout(() => done(null), Math.max(0, timeoutMs));
      set.add(done);
    });
  }

  /** The reporter gave up waiting: the agent falls back to its own prompt. */
  expire(id: string): void {
    const ask = this.asks.get(id);
    if (ask?.status === "open") this.close(ask, "expired");
  }

  snapshot(): HubSnapshot {
    const sessions = [...this.sessions.values()]
      .filter((session) => session.state !== "ended")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const asks = [...this.asks.values()]
      .filter((ask) => ask.status === "open")
      .sort((a, b) => a.createdAt - b.createdAt);
    return {
      sessions,
      asks,
      recent: [...this.recent],
      stats: computeStats(this.history),
    };
  }

  private close(ask: Ask, status: "answered" | "expired" | "superseded"): void {
    ask.status = status;
    this.closed.push(ask.id);
    while (this.closed.length > CLOSED_LIMIT) {
      const oldest = this.closed.shift();
      if (oldest !== undefined) this.asks.delete(oldest);
    }

    if (status !== "superseded") {
      const record: HistoryRecord = {
        at: this.now(),
        agent: ask.agent,
        kind: ask.kind,
        outcome: status,
        waitMs: (ask.answeredAt ?? this.now()) - ask.createdAt,
        words: countWords(ask.reply?.text),
      };
      if (ask.reply?.decision !== undefined) record.decision = ask.reply.decision;
      this.history.push(record);
      this.onRecord(record);
      this.recent.unshift(ask);
      this.recent.length = Math.min(this.recent.length, RECENT_LIMIT);
    }

    const waiting = this.waiters.get(ask.id);
    this.waiters.delete(ask.id);
    for (const resolve of waiting ?? []) resolve(status === "answered" ? (ask.reply ?? null) : null);
  }
}
