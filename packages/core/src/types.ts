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
  | "contraband-log";

export interface BouncerEvaluationResult {
  action: "allow" | "block";
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
}

export interface SessionStats {
  prompts: number;
  blocks: number;
  tokensSaved: number;
  /** Savings of the most recent prompt, shown in the after-answer footer. */
  lastTokensSaved: number;
  lastBlockCategory?: BlockCategory;
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
}

/** Raw (untrusted) JSON contract the BYOK model must return. */
export interface ClassifierResponse {
  complexity: TaskComplexity;
  matchedFiles: string[];
  confidence: number;
  rewrittenPrompt?: string;
  reason?: string;
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
