// Reader for Claude Code `.jsonl` session transcripts (one JSON event per line).
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import type { EffortLevel, TranscriptDigest, TurnUsage } from "./types.js";

export const RATE_LIMIT_SIGNATURES: RegExp[] = [
  /rate_limit_error/i,
  /usage limit reached/i,
  /\b5-hour limit\b/i,
  /\blimit reached\b.*\bresets?\b/i,
  /\bout of (?:extra )?usage\b/i,
  /"status"\s*:\s*429\b|\b429 Too Many Requests\b/i,
];

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "str_replace_based_edit_tool"]);
const EFFORTS: EffortLevel[] = ["low", "medium", "high"];

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface TranscriptEvent {
  type?: string;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  error?: unknown;
  message?: { id?: string; role?: string; model?: string; content?: string | ContentBlock[]; usage?: Usage };
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/** Tokens the model actually read on a turn = everything sent as input, cached or not. */
function contextTokensOf(usage: Usage | undefined): number | undefined {
  if (!usage) return undefined;
  const total = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  return total > 0 ? total : undefined;
}

export interface ReadTranscriptOptions {
  /** Only read the last N bytes (hot path). Omit to read everything. */
  tailBytes?: number;
}

export interface TranscriptRead {
  digest: TranscriptDigest;
  sizeBytes: number;
  effort?: EffortLevel;
  /** Real context size of the latest assistant turn (from its `usage`), if recorded. */
  contextTokens?: number;
  /** Rendered "role: text" lines for optional AI summarisation. */
  turns: string[];
}

function readText(path: string, tailBytes?: number): { text: string; size: number } {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = tailBytes && size > tailBytes ? size - tailBytes : 0;
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop the partial first line
    return { text, size };
  } finally {
    closeSync(fd);
  }
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Claude Code wraps slash commands and local output in tags; those are not human prompts. */
function isCommandWrapper(text: string): boolean {
  return /^\s*<(?:command-name|command-message|local-command-stdout|local-command-stderr|bash-input|bash-stdout|system-reminder)>/.test(text);
}

function commandEffort(text: string): EffortLevel | undefined {
  const m = text.match(/<command-name>\/?effort<\/command-name>[\s\S]*?<command-args>\s*(\w+)/i);
  const level = m?.[1]?.toLowerCase() as EffortLevel | undefined;
  return level && EFFORTS.includes(level) ? level : undefined;
}

export function emptyDigest(): TranscriptDigest {
  return { userPrompts: [], modifiedFiles: [], rateLimitHit: false, turnCount: 0 };
}

/**
 * Real usage of the latest turn: every assistant API call after the last real user prompt (tool loops
 * included). Claude Code writes one line per content block with the same message id and usage, so
 * calls are de-duplicated by id. Returns undefined when nothing was recorded.
 */
export function lastTurnUsage(path: string | undefined, tailBytes = 4 * 1024 * 1024): TurnUsage | undefined {
  if (!path || !existsSync(path)) return undefined;
  let text: string;
  try {
    text = readText(path, tailBytes).text;
  } catch {
    return undefined;
  }
  const events: TranscriptEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TranscriptEvent);
    } catch {
      /* partial first line of the tail */
    }
  }
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    const t = ev.type === "user" && ev.message?.role === "user" ? textOf(ev.message.content) : "";
    if (t.trim() && !ev.isMeta && !isCommandWrapper(t)) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const seen = new Set<string>();
  const sum: TurnUsage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, toolCalls: 0 };
  let calls = 0;
  for (const ev of events.slice(start + 1)) {
    const msg = ev.message;
    if (ev.type !== "assistant" || !msg || msg.model === "<synthetic>") continue;
    if (Array.isArray(msg.content)) sum.toolCalls += msg.content.filter((b) => b?.type === "tool_use").length;
    const id = msg.id ?? `line-${calls}`;
    if (!msg.usage || seen.has(id)) continue;
    seen.add(id);
    calls++;
    sum.input += msg.usage.input_tokens ?? 0;
    sum.cacheCreation += msg.usage.cache_creation_input_tokens ?? 0;
    sum.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
    sum.output += msg.usage.output_tokens ?? 0;
  }
  return calls ? sum : undefined;
}

/**
 * Cost of a turn in "input-token equivalents" (Anthropic list-price ratios): cache writes 1.25x,
 * cache reads 0.1x, output 5x. Lets turns with different cache patterns be compared fairly.
 */
export function turnCost(u: TurnUsage): number {
  return u.input + u.cacheCreation * 1.25 + u.cacheRead * 0.1 + u.output * 5;
}

/** Parse a transcript. Never throws: missing/corrupt files yield an empty digest. */
export function readTranscript(path: string | undefined, options: ReadTranscriptOptions = {}): TranscriptRead {
  const result: TranscriptRead = { digest: emptyDigest(), sizeBytes: 0, turns: [] };
  if (!path || !existsSync(path)) return result;

  let text: string;
  try {
    const r = readText(path, options.tailBytes);
    text = r.text;
    result.sizeBytes = r.size;
  } catch {
    return result;
  }

  const d = result.digest;
  const files = new Set<string>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const lastLines = lines.slice(-8);

  for (const line of lines) {
    let ev: TranscriptEvent;
    try {
      ev = JSON.parse(line) as TranscriptEvent;
    } catch {
      continue;
    }
    const msg = ev.message;
    if (!msg) continue;

    if (ev.type === "user" && msg.role === "user") {
      const t = textOf(msg.content);
      const effort = commandEffort(t);
      if (effort) result.effort = effort;
      if (ev.isMeta || !t.trim() || isCommandWrapper(t)) continue;
      d.userPrompts.push(t);
      d.turnCount += 1;
      result.turns.push(`USER: ${t}`);
    } else if (ev.type === "assistant") {
      if (msg.model && msg.model !== "<synthetic>") {
        d.rawModelName = msg.model;
        result.contextTokens = contextTokensOf(msg.usage) ?? result.contextTokens;
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.type === "tool_use" && block.name && FILE_EDIT_TOOLS.has(block.name)) {
            const p = block.input?.file_path ?? block.input?.notebook_path ?? block.input?.path;
            if (typeof p === "string") files.add(p);
          }
        }
      }
      const t = textOf(msg.content);
      if (t.trim()) result.turns.push(`ASSISTANT: ${t.slice(0, 2000)}`);
    }
  }

  // A rate-limit only counts if it is where the session ended, not an old recovered error.
  d.rateLimitHit = lastLines.some((l) => RATE_LIMIT_SIGNATURES.some((re) => re.test(l)));
  d.modifiedFiles = [...files];
  return result;
}
