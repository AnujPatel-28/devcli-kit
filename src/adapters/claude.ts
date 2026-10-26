import type { HubEvent, Reply } from "../hub/protocol.js";

/**
 * Claude Code adapter: hook stdin -> HubEvent, and Reply -> hook stdout.
 *
 * Stop              returns {"decision":"block","reason":<reply>} so Claude keeps working
 * PermissionRequest returns hookSpecificOutput.decision {behavior: allow | deny}
 * anything else     is informational; no stdout means "carry on as normal"
 */

export const CLAUDE_RELAY_EVENTS = [
  "UserPromptSubmit",
  "Stop",
  "PermissionRequest",
  "Notification",
  "SessionEnd",
] as const;

export type ClaudeRelayEvent = (typeof CLAUDE_RELAY_EVENTS)[number];

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The one line a human needs to approve or refuse a tool call. */
export function describeToolInput(tool: string, input: unknown): string {
  if (!isRecord(input)) return "";
  const command = str(input.command);
  if (command !== undefined) return truncate(command, 400);
  const target = str(input.file_path) ?? str(input.notebook_path) ?? str(input.url) ?? str(input.path);
  if (target !== undefined) return target;
  if (tool === "AskUserQuestion" && Array.isArray(input.questions)) {
    return input.questions
      .map((question) => {
        if (!isRecord(question)) return "";
        const options = Array.isArray(question.options)
          ? question.options
              .map((option) => (isRecord(option) ? str(option.label) : undefined))
              .filter((label): label is string => label !== undefined)
          : [];
        const text = str(question.question) ?? "";
        return options.length > 0 ? `${text} (${options.join(" / ")})` : text;
      })
      .filter((line) => line.length > 0)
      .join("\n");
  }
  return truncate(JSON.stringify(input), 300);
}

/**
 * Last assistant text in a Claude Code transcript (JSONL). Used when the Stop
 * payload does not carry `last_assistant_message` itself.
 */
export function lastAssistantText(jsonl: string): string | undefined {
  const lines = jsonl.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // the tail read can start mid-line
    }
    if (!isRecord(entry) || entry.type !== "assistant" || !isRecord(entry.message)) continue;
    const content = entry.message.content;
    if (typeof content === "string" && content.trim()) return content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map((block) => (isRecord(block) && block.type === "text" ? str(block.text) : undefined))
      .filter((part): part is string => part !== undefined)
      .join("\n");
    if (text.trim()) return text;
  }
  return undefined;
}

export function claudeEvent(input: unknown, transcriptTail?: string): HubEvent | null {
  if (!isRecord(input)) return null;
  const sessionId = str(input.session_id) ?? "default";
  const base = { agent: "claude", sessionId, ...(str(input.cwd) ? { cwd: str(input.cwd) } : {}) };

  switch (input.hook_event_name) {
    case "UserPromptSubmit":
      return { ...base, kind: "working", summary: str(input.prompt) ?? "Working" };
    case "Stop": {
      const summary =
        str(input.last_assistant_message) ??
        (transcriptTail === undefined ? undefined : lastAssistantText(transcriptTail));
      return { ...base, kind: "done", summary: summary ?? "Claude finished its turn." };
    }
    case "PermissionRequest": {
      const tool = str(input.tool_name) ?? "a tool";
      const detail = describeToolInput(tool, input.tool_input);
      if (tool === "AskUserQuestion") {
        return { ...base, kind: "question", tool, detail, summary: "Claude has a question for you" };
      }
      return { ...base, kind: "permission", tool, detail, summary: `Claude wants to use ${tool}` };
    }
    case "Notification":
      return { ...base, kind: "notice", summary: str(input.message) ?? "Claude needs your attention" };
    case "SessionEnd":
      return { ...base, kind: "ended" };
    default:
      return null;
  }
}

/** The JSON Claude Code should read on stdout, or null to change nothing. */
export function claudeOutput(event: string, reply: Reply | null): JsonRecord | null {
  if (reply === null || reply.decision === "terminal") return null;

  if (event === "Stop") {
    return reply.text ? { decision: "block", reason: reply.text } : null;
  }

  if (event === "PermissionRequest") {
    if (reply.decision === "allow") {
      return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
    }
    if (reply.decision !== "deny" && !reply.text) return null;
    // A spoken answer to a question, or "no, do X instead", reaches Claude as
    // the denial message, which it reads and acts on.
    const message = reply.text
      ? `The user replied from the clidev inbox: ${reply.text}`
      : "Denied from the clidev inbox.";
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message },
      },
    };
  }

  return null;
}
