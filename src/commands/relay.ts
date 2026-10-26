import { open } from "node:fs/promises";

import { Command } from "commander";

import { claudeEvent, claudeOutput } from "../adapters/claude.js";
import { opencodeAction, opencodeEvent, type OpencodeRelayInput } from "../adapters/opencode.js";
import { connectHub, reportEvent, waitForReply } from "../hub/client.js";
import { ASK_KINDS, type HubEvent, type Reply } from "../hub/protocol.js";
import { payload, writeErr } from "../utils/logger.js";

/** How long a hook waits for you before the agent falls back to its own prompt. */
export const DEFAULT_WAIT_SECONDS: Record<string, number> = {
  Stop: 900,
  PermissionRequest: 600,
};

/** Same waits by hub ask kind, for adapters that are not Claude Code. */
const WAIT_BY_KIND: Record<string, number> = { done: 900, question: 900, permission: 600 };

const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readTail(file: string): Promise<string | undefined> {
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/** Reports an event and, for asks, waits for your reply. Null when there is none. */
async function reportAndWait(event: HubEvent, waitSeconds: number): Promise<Reply | null> {
  const hub = await connectHub();
  if (hub === null) return null;
  const askId = await reportEvent(hub, event);
  if (askId === null || !ASK_KINDS.includes(event.kind)) return null;
  return waitForReply(hub, askId, waitSeconds * 1000);
}

async function relayClaude(event: string, waitSeconds: number | undefined): Promise<void> {
  const raw = await readStdin();
  const input: unknown = raw.trim().length > 0 ? JSON.parse(raw) : {};
  const record = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  record.hook_event_name ??= event;

  const needsTranscript =
    record.hook_event_name === "Stop" &&
    typeof record.last_assistant_message !== "string" &&
    typeof record.transcript_path === "string";
  const tail = needsTranscript ? await readTail(record.transcript_path as string) : undefined;

  const hubEvent = claudeEvent(record, tail);
  if (hubEvent === null) return;

  const seconds = waitSeconds ?? DEFAULT_WAIT_SECONDS[event] ?? DEFAULT_WAIT_SECONDS.Stop ?? 900;
  const reply = await reportAndWait(hubEvent, seconds);
  const output = claudeOutput(String(record.hook_event_name), reply);
  if (output !== null) payload(JSON.stringify(output));
}

async function relayOpencode(waitSeconds: number | undefined): Promise<void> {
  const raw = await readStdin();
  const input = JSON.parse(raw) as OpencodeRelayInput;
  const hubEvent = opencodeEvent(input);
  const reply =
    hubEvent === null ? null : await reportAndWait(hubEvent, waitSeconds ?? WAIT_BY_KIND[hubEvent.kind] ?? 900);
  payload(JSON.stringify(opencodeAction(input, reply)));
}

export function createRelayCommand(): Command {
  return new Command("relay")
    .description("Hook entry point: report an agent event to the hub and return your reply")
    .argument("<agent>", "agent adapter: claude or opencode")
    .argument("<event>", "the agent's event name, e.g. Stop or permission.asked")
    .option("--wait <seconds>", "how long to wait for a reply before giving control back", (value) =>
      Number.parseInt(value, 10),
    )
    .addHelpText(
      "after",
      `
You do not run this yourself: \`clidev hooks --claude\` or \`--opencode\` wires it
into the agent. It reads the event on stdin and prints the agent's reply on stdout.
If anything fails it prints nothing and exits 0, so the agent carries on normally.`,
    )
    .action(async (agent: string, event: string, options: { wait?: number }) => {
      const wait = Number.isFinite(options.wait) && (options.wait ?? 0) > 0 ? options.wait : undefined;
      try {
        if (agent === "claude") await relayClaude(event, wait);
        else if (agent === "opencode") await relayOpencode(wait);
        else writeErr(`clidev relay: no adapter for "${agent}" yet`);
      } catch (error) {
        // Never break the agent: a failed relay behaves like no hook at all.
        writeErr(`clidev relay: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}
