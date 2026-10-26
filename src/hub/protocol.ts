/**
 * The wire format every agent adapter speaks to the hub. Adapters translate an
 * agent's own hook payload into a HubEvent, and translate a Reply back into
 * whatever that agent accepts.
 */

export const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  watch: "clidev watch",
};

export function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

export type EventKind = "working" | "done" | "permission" | "question" | "notice" | "ended";
export type AskKind = "done" | "permission" | "question";

export const ASK_KINDS: readonly EventKind[] = ["done", "permission", "question"];

export interface HubEvent {
  agent: string;
  sessionId: string;
  kind: EventKind;
  cwd?: string;
  summary?: string;
  /** Tool the agent wants to run, for permission asks. */
  tool?: string;
  /** What the tool will do: a command line, a file path, a short JSON excerpt. */
  detail?: string;
  /** False when the reporter cannot carry a reply back (notify-only agents). */
  canReply?: boolean;
}

export type Decision = "allow" | "deny" | "terminal";

export interface Reply {
  text?: string;
  decision?: Decision;
}

export type AskStatus = "open" | "answered" | "expired" | "superseded";

export interface Ask {
  id: string;
  agent: string;
  sessionId: string;
  kind: AskKind;
  project: string;
  summary: string;
  tool?: string;
  detail?: string;
  canReply: boolean;
  createdAt: number;
  status: AskStatus;
  reply?: Reply;
  answeredAt?: number;
}

export type SessionState = "working" | "waiting" | "done" | "ended";

export interface Session {
  key: string;
  agent: string;
  sessionId: string;
  project: string;
  cwd?: string;
  state: SessionState;
  summary?: string;
  updatedAt: number;
  openAskId?: string;
}

/** One line of ~/.clidev/hub/history.jsonl — what the stats card is built from. */
export interface HistoryRecord {
  at: number;
  agent: string;
  kind: AskKind;
  outcome: "answered" | "expired";
  waitMs: number;
  words: number;
  decision?: Decision;
}

export interface HubStats {
  asks: number;
  answered: number;
  medianReplyMs: number | null;
  wordsReplied: number;
  agents: string[];
}

export interface HubSnapshot {
  sessions: Session[];
  asks: Ask[];
  recent: Ask[];
  stats: HubStats;
}

export function projectName(cwd: string | undefined): string {
  if (cwd === undefined || cwd.trim().length === 0) return "unknown project";
  const parts = cwd.split(/[\\/]+/u).filter((part) => part.length > 0);
  return parts.at(-1) ?? cwd;
}

export function countWords(text: string | undefined): number {
  if (text === undefined) return 0;
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/** One readable paragraph for a toast or a card, never a wall of markdown. */
export function shortSummary(text: string | undefined, max = 280): string {
  if (text === undefined) return "";
  const flat = text
    .replace(/```[\s\S]*?```/gu, " [code] ")
    .replace(/[#*_`>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function computeStats(records: readonly HistoryRecord[]): HubStats {
  const answered = records.filter((record) => record.outcome === "answered");
  const waits = answered.map((record) => record.waitMs).sort((a, b) => a - b);
  let median: number | null = null;
  if (waits.length > 0) {
    const middle = Math.floor(waits.length / 2);
    median =
      waits.length % 2 === 1
        ? (waits[middle] ?? 0)
        : Math.round(((waits[middle - 1] ?? 0) + (waits[middle] ?? 0)) / 2);
  }

  return {
    asks: records.length,
    answered: answered.length,
    medianReplyMs: median,
    wordsReplied: answered.reduce((sum, record) => sum + record.words, 0),
    agents: [...new Set(records.map((record) => record.agent))].sort(),
  };
}
