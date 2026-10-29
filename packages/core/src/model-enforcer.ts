// Detects the active Claude model/effort and decides when a task is overkill for it.
import { formatNotice, pasteStep } from "./messages.js";
import { readTranscript } from "./transcript.js";
import type { ActiveSessionState, BouncerMode, ModelTier, TaskComplexity, UsageBudget } from "./types.js";

/** Bytes of transcript tail read on the hot path; enough to find the latest assistant model. */
export const HOT_PATH_TAIL_BYTES = 1024 * 1024;

export function tierFromModelName(model: string | undefined): ModelTier | "unknown" {
  if (!model) return "unknown";
  const m = model.toLowerCase();
  if (m.includes("opus")) return "deep-reasoning";
  if (m.includes("sonnet")) return "balanced";
  if (m.includes("haiku")) return "fast";
  return "unknown";
}

export function detectActiveSession(transcriptPath?: string, transcriptSizeBytes?: number): ActiveSessionState {
  const read = readTranscript(transcriptPath, { tailBytes: HOT_PATH_TAIL_BYTES });
  const rawModelName = read.digest.rawModelName;
  return {
    detectedModelTier: tierFromModelName(rawModelName),
    rawModelName,
    detectedEffort: read.effort,
    turnCount: read.digest.turnCount,
    transcriptSizeBytes: transcriptSizeBytes ?? read.sizeBytes,
    contextTokens: read.contextTokens,
    recentPrompts: read.digest.userPrompts.slice(-3).map((p) => p.slice(0, 300)),
    contextWindow: read.contextWindow,
  };
}

export interface BloatThresholds {
  contextBloatThresholdTokens: number;
  contextBloatThresholdBytes: number;
}

/**
 * Context bloat check. Transcript bytes overstate context badly (tool output, metadata, compacted
 * history all stay in the file), so the real token count from `usage` wins whenever it exists.
 */
/** Standard Claude context window; the configured bloat threshold is expressed against it. */
export const STANDARD_CONTEXT_WINDOW = 200_000;
export const LARGE_CONTEXT_WINDOW = 1_000_000;

/**
 * The session's context window. Transcripts don't record it, but a context already larger than 200k
 * (or a "[1m]" model id) proves the 1M window is in use.
 */
export function contextWindowFor(state: ActiveSessionState): number {
  if (state.contextWindow) return state.contextWindow;
  if ((state.contextTokens ?? 0) > STANDARD_CONTEXT_WINDOW || /\[1m\]/i.test(`${state.rawModelName ?? ""} ${state.hostModelName ?? ""}`)) return LARGE_CONTEXT_WINDOW;
  return STANDARD_CONTEXT_WINDOW;
}

/** Bloat threshold in tokens, scaled to the session's context window (150k of 200k = 750k of 1M). */
export function bloatThresholdTokens(state: ActiveSessionState, t: BloatThresholds): number {
  return Math.round((t.contextBloatThresholdTokens * contextWindowFor(state)) / STANDARD_CONTEXT_WINDOW);
}

export function isContextBloated(state: ActiveSessionState, t: BloatThresholds): boolean {
  if (state.contextTokens !== undefined) return state.contextTokens > bloatThresholdTokens(state, t);
  return state.transcriptSizeBytes > t.contextBloatThresholdBytes;
}

/**
 * Opus Overkill Guard: Opus burns roughly 5x the quota of Sonnet.
 * - balanced: block TRIVIAL work on Opus
 * - strict:   block TRIVIAL and STANDARD work on Opus
 * - yolo:     never block
 */
export function isOpusOverkill(state: ActiveSessionState, complexity: TaskComplexity, mode: BouncerMode): boolean {
  if (state.detectedModelTier !== "deep-reasoning" || mode === "yolo") return false;
  if (complexity === "TRIVIAL") return true;
  return mode === "strict" && complexity === "STANDARD";
}

/**
 * Below this context, switching model is cheap. The prompt cache belongs to one model, so a switch makes
 * the new model write the whole context to its cache once (1.25x) instead of reading it (0.1x): in a big
 * session that one write costs more than a small task saves on a cheaper model.
 */
export const CHEAP_SWITCH_CONTEXT = 50_000;

export const OPUS_OVERKILL_MESSAGE = formatNotice({
  title: "🛑 OPUS ON A SMALL TASK",
  body: ["This looks like a routine task: Sonnet does it just as well, and Opus uses much more of your quota.", "✔ Your prompt is on your clipboard."],
  steps: ["type `/model sonnet`", pasteStep()],
  overrideAsk: "Keep Opus?",
  pasteToOverride: true,
});

/** Warn mode (`bouncer opus warn`): one line, the prompt has already gone through. */
export const OPUS_WARN_MESSAGE =
  "🕶️ Bouncer · 🛑 Opus on a small task: sent anyway. Sonnet does this just as well for less quota → `/model sonnet`.";

/** What goes on the clipboard after an Opus block: pasting it as is sends it, on whichever model. */
export function opusClipboardText(prompt: string): string {
  return `${prompt.replace(/\s+$/, "")} !`;
}

export function buildUsageBudget(complexity: TaskComplexity): UsageBudget {
  switch (complexity) {
    case "TRIVIAL":
      return {
        recommendedModel: "fast",
        recommendedEffort: "low",
        maxExplorationToolCalls: 3,
        delegateSearchToHaikuSubagent: false,
        outputStyle: "surgical-diff",
      };
    case "STANDARD":
      return {
        recommendedModel: "balanced",
        recommendedEffort: "medium",
        maxExplorationToolCalls: 10,
        delegateSearchToHaikuSubagent: true,
        outputStyle: "standard-complete",
      };
    case "COMPLEX":
      // VIP Velvet Rope: lift every brevity and tool-call restriction.
      return {
        recommendedModel: "deep-reasoning",
        recommendedEffort: "high",
        maxExplorationToolCalls: "unlimited",
        delegateSearchToHaikuSubagent: false,
        outputStyle: "deep-unrestricted",
      };
  }
}

const MODEL_COMMAND: Record<ModelTier, string> = {
  fast: "/model haiku",
  balanced: "/model sonnet",
  "deep-reasoning": "/model opus",
};

export function recommendedCommand(budget: UsageBudget): string {
  return `${MODEL_COMMAND[budget.recommendedModel]} && /effort ${budget.recommendedEffort}`;
}

/** Rough per-task token cost used for savings estimates. */
export const TYPICAL_TASK_TOKENS: Record<TaskComplexity, number> = {
  TRIVIAL: 8_000,
  STANDARD: 25_000,
  COMPLEX: 60_000,
};

/** Relative quota weight of each tier (Sonnet = 1). */
export const TIER_COST_WEIGHT: Record<ModelTier, number> = {
  fast: 1 / 3,
  balanced: 1,
  "deep-reasoning": 5,
};
