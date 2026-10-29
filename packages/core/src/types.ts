// Universal, host-agnostic contracts shared by every Bouncer adapter (Claude Code, Codex, VS Code, ...).

export type AgentPlatform = "claude-code" | "codex" | "vscode" | "cursor" | "generic";
export type BouncerMode = "strict" | "balanced" | "yolo";
export type TaskComplexity = "TRIVIAL" | "STANDARD" | "COMPLEX";
export type ModelTier = "fast" | "balanced" | "deep-reasoning"; // Haiku | Sonnet | Opus
export type EffortLevel = "low" | "medium" | "high";
export type IntelligenceLevel = 1 | 2 | 3; // 1 = Bronze (Local), 2 = Silver (8B), 3 = Gold (70B+/Flash)

export type IntelligenceBadge =
  | "🥉 LEVEL 1 (Local Git-Truth)"
  | "🥈 LEVEL 2 (Silver 8B AI)"
  | "🥇 LEVEL 3 (Gold 70B/Flash)";

export interface IntelligenceProfile {
  level: IntelligenceLevel;
  badge: IntelligenceBadge;
  providerName: string;
  modelName: string;
  minConfidenceThreshold: number; // 0.90 for Level 2, 0.80 for Level 3
}

export interface ActiveSessionState {
  detectedModelTier: ModelTier | "unknown";
  rawModelName?: string;
  detectedEffort?: EffortLevel;
  turnCount: number;
  transcriptSizeBytes: number;
  /** Real context size (input + cache tokens) of the latest assistant turn, when the host records it. */
  contextTokens?: number;
  /** The last few user prompts of this session (oldest first), so the AI can judge follow-ups in context. */
  recentPrompts?: string[];
  /** The model's context window when the host records it (Codex does); otherwise inferred. */
  contextWindow?: number;
}

export interface UsageBudget {
  recommendedModel: ModelTier;
  recommendedEffort: EffortLevel;
  maxExplorationToolCalls: number | "unlimited";
  delegateSearchToHaikuSubagent: boolean;
  outputStyle: "surgical-diff" | "standard-complete" | "deep-unrestricted";
}

export interface BouncerEvaluationInput {
  platform: AgentPlatform;
  hookEvent?: "UserPromptSubmit" | "Stop";
  prompt?: string;
  cwd: string;
  sessionId?: string;
  transcriptPath?: string;
  transcriptSizeBytes?: number;
}

export type BlockCategory =
  | "vague-prompt"
  | "model-overkill"
  | "context-bloat"
  | "contraband-secret"
  | "contraband-log"
  | "broad-scope"
  | "oversized-paste"
  | "eco-clear";

export interface BouncerEvaluationResult {
  action: "allow" | "block";
  /** Host the prompt came from (wording and stats). */
  platform?: AgentPlatform;
  blockCategory?: BlockCategory;
  intelligence: IntelligenceProfile;
  complexity: TaskComplexity;
  activeState: ActiveSessionState;
  usageBudget: UsageBudget;
  verifiedGitFiles: string[]; // Files actually modified in git status/diff
  highConfidenceHints: string[]; // Validated against git ls-files AND confidence >= threshold
  confidenceScore: number;
  reason?: string;
  suggestedCommand?: string;
  rewrittenPrompt?: string;
  handoverPrompt?: string;
  systemDirective: string;
  tokensSavedEstimate: number;
  /** Where an allowed prompt's savings come from (blocks are explained by `blockCategory`). */
  savings?: SavingsItem[];
  /** False when Bouncer wasn't sure of the task size, so it sent no limits (quality guard). */
  budgetApplied?: boolean;
  /** Shown to the user without blocking (Claude Code `systemMessage`), e.g. a context-size warning. */
  userNotice?: string;
  noticeCategory?: BlockCategory;
  /** Set when A/B measurement is on: "control" prompts were sent without any Bouncer guidance. */
  abGroup?: AbGroup;
  /** Eco mode was on for this prompt (for the context before/after comparison). */
  ecoActive?: boolean;
  handledByTier: 1 | 2 | 3;
  clipboardCopied?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration & persisted state (~/.bouncer/*.json)
// ---------------------------------------------------------------------------

export type PresetName = "groq-gold" | "gemini-gold" | "ollama-coder" | "cloudflare-gold";

export interface ProviderConfig {
  /** Human readable provider name, e.g. "Groq Cloud". */
  providerName: string;
  /** OpenAI-compatible chat completions endpoint. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  preset?: PresetName;
}

export interface BouncerConfig {
  mode: BouncerMode;
  provider?: ProviderConfig;
  /** Real context size (tokens) above which a /clear handover is recommended. Primary signal. */
  contextBloatThresholdTokens: number;
  /** Fallback when the transcript records no token usage: transcript file size in bytes. */
  contextBloatThresholdBytes: number;
  /** Hard timeout for any BYOK call made on the prompt hot path. */
  aiTimeoutMs: number;
  /** Set false to never touch the system clipboard. */
  clipboardEnabled: boolean;
  /** Show the "tokens saved" line after every Claude answer. */
  footerEnabled: boolean;
  /** A/B measurement: hold back Bouncer's guidance on a random half of prompts and compare real usage. */
  measure?: boolean;
  /**
   * Eco mode: when the session's context is above this many tokens and the prompt starts a new task,
   * Bouncer suggests a fresh session with a handover. Undefined = off.
   */
  ecoContextTokens?: number;
  /** Call the AI on every prompt (old behaviour). Default: only when a decision needs it (eco, vagueness). */
  aiEveryPrompt?: boolean;
}

export type AbGroup = "treatment" | "control";

/** Real usage of one Claude turn, read from the transcript's `usage` records. */
export interface TurnUsage {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  toolCalls: number;
}

/** Summed usage of measured turns in one A/B group. */
export interface AbBucket extends TurnUsage {
  turns: number;
}

export interface SavingsItem {
  label: string;
  tokens: number;
}

/** Snapshot of the most recent prompt, for the after-answer footer and the status line. */
export interface LastPromptInfo {
  action: "allow" | "block";
  blockCategory?: BlockCategory;
  complexity: TaskComplexity;
  recommendedModel: ModelTier;
  recommendedEffort: EffortLevel;
  detectedModel?: ModelTier | "unknown";
  hints: number;
  gitFiles: number;
  contextTokens?: number;
  ai: "ok" | "fail-open" | "skipped" | "idle" | "off" | "vip";
  budgetApplied?: boolean;
  platform?: AgentPlatform;
  /** The session's context window, for the "context used" bar. */
  contextWindow?: number;
  abGroup?: AbGroup;
  savings: SavingsItem[];
}

export interface SessionStats {
  prompts: number;
  blocks: number;
  tokensSaved: number;
  /** Savings of the most recent prompt, shown in the after-answer footer. */
  lastTokensSaved: number;
  lastBlockCategory?: BlockCategory;
  /** Savings credited for the last block; taken back if the user overrides it with ' !'. */
  lastBlockSaved?: number;
  /** Non-blocking notices already shown in this session (shown once). */
  noticed?: BlockCategory[];
  /** A/B prompt waiting for its turn to finish (the Stop hook reads the real usage). */
  pendingAb?: { group: AbGroup; complexity: TaskComplexity };
  last?: LastPromptInfo;
  /** Categories the user overrode with ' !' in this session; Bouncer stops blocking them here. */
  overrides: BlockCategory[];
  lastSeenAt: string;
}

export interface BouncerStats {
  promptsEvaluated: number;
  promptsAllowed: number;
  promptsBlocked: number;
  blocksByCategory: Partial<Record<BlockCategory, number>>;
  vipPasses: number;
  aiCalls: number;
  aiFailOpens: number;
  tokensSavedEstimate: number;
  rescuesGenerated: number;
  /** AI calls skipped because Level 1 was already certain (saves latency and free quota). */
  aiSkipped: number;
  sessions: Record<string, SessionStats>;
  /** A/B measurement results per task size. */
  ab?: Partial<Record<TaskComplexity, Partial<Record<AbGroup, AbBucket>>>>;
  /** Context size at prompt time, with eco mode off vs on: the measured effect of eco mode. */
  contextAtPrompt?: Partial<Record<"off" | "on", { n: number; sum: number }>>;
  firstSeenAt?: string;
  lastEvaluatedAt?: string;
}

// ---------------------------------------------------------------------------
// BYOK classifier contract
// ---------------------------------------------------------------------------

export interface ClassifierRequest {
  prompt: string;
  modifiedFiles: string[];
  workspaceFiles: string[];
  /** Earlier prompts of the same session; empty when this is the first prompt. */
  previousPrompts?: string[];
}

/** Raw (untrusted) JSON contract the BYOK model must return. */
export interface ClassifierResponse {
  complexity: TaskComplexity;
  matchedFiles: string[];
  confidence: number;
  rewrittenPrompt?: string;
  reason?: string;
  /** How sure the model is of the task size; low for follow-ups that only refer to earlier work. */
  sizeConfidence?: number;
  /** The prompt starts work unrelated to the session's earlier prompts. */
  newTask?: boolean;
  /** English code words the task is about (e.g. "logout", "header"), whatever language the prompt is in. */
  keywords?: string[];
  /** Judged from meaning and session context: nobody could tell what to change or answer. */
  vague?: boolean;
  /** When vague: what the prompt is missing, in the prompt's language (shown to the user). */
  missing?: string;
  /** The prompt asks for repo-wide work without naming a folder or file, in any language. */
  broadScope?: boolean;
}

export interface Classifier {
  readonly profile: IntelligenceProfile;
  classify(request: ClassifierRequest, signal: AbortSignal): Promise<ClassifierResponse>;
  summarizeProgress?(turns: string[], signal: AbortSignal): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Host adapters
// ---------------------------------------------------------------------------

export interface HostRenderOutput {
  /** 0 = allow, 2 = block (Claude Code convention: stderr is shown to the user). */
  exitCode: 0 | 2;
  stdout?: string;
  stderr?: string;
}

export interface HostAdapter<RawInput = unknown> {
  readonly platform: AgentPlatform;
  parseInput(raw: RawInput): BouncerEvaluationInput;
  render(result: BouncerEvaluationResult): HostRenderOutput;
}

// ---------------------------------------------------------------------------
// Rescue
// ---------------------------------------------------------------------------

export interface TranscriptDigest {
  userPrompts: string[];
  modifiedFiles: string[];
  rawModelName?: string;
  rateLimitHit: boolean;
  turnCount: number;
}

export interface RescuePackage {
  markdown: string;
  initialGoal?: string;
  interruptedTask?: string;
  sessionModifiedFiles: string[];
  gitStatusShort: string;
  gitDiffStat: string;
  branch?: string;
  executiveSummary?: string[];
  rateLimitDetected: boolean;
  savedTo?: string;
  clipboardCopied: boolean;
}
