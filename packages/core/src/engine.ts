// Safe 3-tier evaluation orchestrator: Level 1 (local) -> optional Level 2/3 AI -> enforcement.
import { copyToClipboard, type ClipboardWriter } from "./clipboard.js";
import { applySafetyLaws, buildIntelligenceProfile, BYOKClassifier, withDeadline } from "./byok-provider.js";
import { GitContext } from "./git-context.js";
import {
  buildUsageBudget,
  detectActiveSession,
  isContextBloated,
  isOpusOverkill,
  OPUS_OVERKILL_MESSAGE,
  TIER_COST_WEIGHT,
  TYPICAL_TASK_TOKENS,
} from "./model-enforcer.js";
import { RescueEngine } from "./rescue.js";
import { DEFAULT_CONFIG, loadConfig, recordEvaluation, type EvaluationStatsDelta } from "./storage.js";
import {
  classifyComplexity,
  extractFileMentions,
  isVaguePrompt,
  isVipPass,
  matchModifiedFiles,
  resolveMentions,
  scanContraband,
} from "./tier1-local.js";
import type {
  BouncerConfig,
  BouncerEvaluationInput,
  BouncerEvaluationResult,
  Classifier,
  IntelligenceProfile,
  RescuePackage,
  TaskComplexity,
  UsageBudget,
} from "./types.js";

export interface BouncerEngineOptions {
  /** Overrides on top of ~/.bouncer/config.json (or defaults). */
  config?: Partial<BouncerConfig>;
  /** Skip reading ~/.bouncer/config.json entirely. */
  ignoreStoredConfig?: boolean;
  /** Inject a classifier (tests); `null` disables AI even if a provider is configured. */
  classifier?: Classifier | null;
  gitFactory?: (cwd: string) => GitContext;
  clipboard?: ClipboardWriter;
  /** Persist stats / handover files under ~/.bouncer. Default true. */
  persist?: boolean;
}

export interface StopOutcome {
  rateLimitDetected: boolean;
  rescue?: RescuePackage;
}

/** Claude Code hook convention: 0 = let the prompt through, 2 = block and show stderr. */
export function exitCodeFor(result: BouncerEvaluationResult): 0 | 2 {
  return result.action === "block" ? 2 : 0;
}

const uniq = (xs: string[]) => [...new Set(xs)];
const estTokens = (text: string) => Math.ceil(text.length / 4);
const MAX_LISTED_FILES = 15;

const MODEL_LABEL = { fast: "Haiku", balanced: "Sonnet", "deep-reasoning": "Opus" } as const;

export class BouncerEngine {
  readonly config: BouncerConfig;
  readonly intelligence: IntelligenceProfile;
  private readonly classifier: Classifier | null;
  private readonly gitFactory: (cwd: string) => GitContext;
  private readonly clipboard: ClipboardWriter;
  private readonly persist: boolean;

  constructor(options: BouncerEngineOptions = {}) {
    const base = options.ignoreStoredConfig ? { ...DEFAULT_CONFIG } : loadConfig();
    this.config = { ...base, ...options.config };
    this.classifier =
      options.classifier !== undefined
        ? options.classifier
        : this.config.provider
          ? new BYOKClassifier(this.config.provider)
          : null;
    this.intelligence = this.classifier?.profile ?? buildIntelligenceProfile(undefined);
    this.gitFactory = options.gitFactory ?? ((cwd) => new GitContext(cwd));
    this.clipboard = options.clipboard ?? copyToClipboard;
    this.persist = options.persist ?? true;
  }

  private async copy(text: string): Promise<boolean> {
    if (!this.config.clipboardEnabled) return false;
    try {
      return await this.clipboard(text);
    } catch {
      return false;
    }
  }

  private finish(result: BouncerEvaluationResult, delta: EvaluationStatsDelta = {}): BouncerEvaluationResult {
    if (this.persist) recordEvaluation(result, delta);
    return result;
  }

  /** Evaluate a UserPromptSubmit. Never throws: any internal failure fails open (allow). */
  async evaluate(input: BouncerEvaluationInput): Promise<BouncerEvaluationResult> {
    try {
      return await this.evaluateUnsafe(input);
    } catch (error) {
      const complexity: TaskComplexity = "STANDARD";
      return {
        action: "allow",
        intelligence: this.intelligence,
        complexity,
        activeState: { detectedModelTier: "unknown", turnCount: 0, transcriptSizeBytes: input.transcriptSizeBytes ?? 0 },
        usageBudget: buildUsageBudget(complexity),
        verifiedGitFiles: [],
        highConfidenceHints: [],
        confidenceScore: 0,
        reason: `Bouncer internal error, failing open: ${error instanceof Error ? error.message : String(error)}`,
        systemDirective: "",
        tokensSavedEstimate: 0,
        handledByTier: 1,
      };
    }
  }

  private async evaluateUnsafe(input: BouncerEvaluationInput): Promise<BouncerEvaluationResult> {
    const prompt = input.prompt ?? "";
    const mode = this.config.mode;
    const local = classifyComplexity(prompt);

    const activeState = detectActiveSession(input.transcriptPath, input.transcriptSizeBytes);
    const base = {
      intelligence: this.intelligence,
      activeState,
      verifiedGitFiles: [] as string[],
      highConfidenceHints: [] as string[],
      handledByTier: 1 as const,
    };

    // 1. VIP pass ("... !"): bypass every check, add nothing.
    if (isVipPass(prompt)) {
      return this.finish(
        {
          ...base,
          action: "allow",
          complexity: local.complexity,
          usageBudget: buildUsageBudget("COMPLEX"),
          confidenceScore: local.confidence,
          reason: "VIP pass (trailing '!'): all checks bypassed.",
          systemDirective: "",
          tokensSavedEstimate: 0,
        },
        { vipPass: true },
      );
    }

    // 2. Contraband: always checked before anything (including any LLM) sees the prompt.
    const contraband = scanContraband(prompt);
    if (contraband && (contraband.category === "contraband-secret" || mode !== "yolo")) {
      const isSecret = contraband.category === "contraband-secret";
      return this.finish({
        ...base,
        action: "block",
        blockCategory: contraband.category,
        complexity: local.complexity,
        usageBudget: buildUsageBudget(local.complexity),
        confidenceScore: 1,
        reason: isSecret
          ? `🚫 CONTRABAND: ${contraband.detail}. Your prompt was NOT sent. Remove the secret (use an env var reference instead) and rotate the key if it was ever shared.`
          : `🚫 CONTRABAND: ${contraband.detail}. Save it to a file and reference only the relevant lines (e.g. the last 30 lines or the first stack trace), or append ' !' to send anyway.`,
        systemDirective: "",
        tokensSavedEstimate: isSecret ? 0 : estTokens(prompt),
      });
    }

    // Slash commands (/model, /clear, /bouncer ...) are host controls, not tasks: let them through untouched.
    if (/^\s*\/[\w:-]+/.test(prompt)) {
      return this.finish({
        ...base,
        action: "allow",
        complexity: local.complexity,
        usageBudget: buildUsageBudget(local.complexity),
        confidenceScore: 1,
        reason: "Slash command: not evaluated.",
        systemDirective: "",
        tokensSavedEstimate: 0,
      });
    }

    // 3. Level 1 git-truth context (zero network).
    const git = this.gitFactory(input.cwd);
    const isRepo = git.isRepo();
    const verifiedGitFiles = isRepo ? git.validateFiles(git.modifiedFiles()) : [];
    const exactHints = isRepo ? git.validateFiles(resolveMentions(extractFileMentions(prompt), git.lsFiles())) : [];
    const gitHints = matchModifiedFiles(prompt, verifiedGitFiles);

    let complexity = local.complexity;
    let hints = uniq([...exactHints, ...gitHints]);
    let confidenceScore = exactHints.length ? 1 : gitHints.length ? 0.85 : local.confidence;
    let handledByTier: 1 | 2 | 3 = 1;
    let rewrittenPrompt: string | undefined;
    let aiReason: string | undefined;
    const delta: EvaluationStatsDelta = {};

    // 4. Optional Level 2/3 AI, hard deadline, fail-open to Level 1.
    if (this.classifier && this.intelligence.level > 1) {
      delta.aiCalled = true;
      const classifier = this.classifier;
      const ai = await withDeadline(
        (signal) =>
          classifier.classify(
            { prompt, modifiedFiles: verifiedGitFiles, workspaceFiles: isRepo ? git.workspaceSample(40) : [] },
            signal,
          ),
        this.config.aiTimeoutMs,
      );
      if (ai.value) {
        const safe = applySafetyLaws(ai.value, git, this.intelligence);
        complexity = ai.value.complexity;
        hints = uniq([...exactHints, ...safe.hints, ...gitHints]);
        confidenceScore = ai.value.confidence;
        rewrittenPrompt = ai.value.rewrittenPrompt;
        aiReason = ai.value.reason;
        handledByTier = this.intelligence.level;
      } else {
        delta.aiFailedOpen = true;
        aiReason = ai.timedOut
          ? `AI timed out after ${this.config.aiTimeoutMs}ms; fell back to LEVEL 1`
          : "AI unavailable; fell back to LEVEL 1";
      }
    }

    const usageBudget = buildUsageBudget(complexity);
    const common = {
      ...base,
      complexity,
      usageBudget,
      verifiedGitFiles,
      highConfidenceHints: hints,
      confidenceScore,
      handledByTier,
    };

    // 5. Crowd control: context bloat -> /clear + handover.
    if (mode !== "yolo" && isContextBloated(activeState, this.config)) {
      const rescue = new RescueEngine({
        git,
        clipboard: this.clipboard,
        clipboardEnabled: this.config.clipboardEnabled,
        persist: this.persist,
      });
      const pkg = await rescue.build({
        cwd: input.cwd,
        transcriptPath: input.transcriptPath,
        reason: "context-bloat",
        pendingPrompt: prompt,
      });
      const size =
        activeState.contextTokens !== undefined
          ? `context is ~${Math.round(activeState.contextTokens / 1000)}k tokens`
          : `transcript is ${Math.round(activeState.transcriptSizeBytes / 1024)}KB`;
      return this.finish(
        {
          ...common,
          action: "block",
          blockCategory: "context-bloat",
          reason: `🧹 CROWD CONTROL: This session's ${size}, so every turn re-reads a bloated context. Run '/clear', then press Cmd+V / Ctrl+V to paste the handover${pkg.clipboardCopied ? " (already on your clipboard)" : pkg.savedTo ? ` (saved at ${pkg.savedTo})` : ""}. Append ' !' to continue anyway.`,
          suggestedCommand: "/clear",
          handoverPrompt: pkg.markdown,
          clipboardCopied: pkg.clipboardCopied,
          systemDirective: "",
          tokensSavedEstimate: activeState.contextTokens ?? Math.round(activeState.transcriptSizeBytes / 4),
        },
        delta,
      );
    }

    // 6. Vague prompt (strict only). LAW 3: a rewrite only ever goes to the clipboard.
    if (mode === "strict" && isVaguePrompt(prompt)) {
      const clipboardCopied = rewrittenPrompt ? await this.copy(rewrittenPrompt) : false;
      return this.finish(
        {
          ...common,
          action: "block",
          blockCategory: "vague-prompt",
          reason: `🤨 VAGUE PROMPT: Name the file, function or exact error so Claude doesn't burn tokens hunting.${clipboardCopied ? " A sharper rewrite is on your clipboard — review it and paste with Cmd+V / Ctrl+V." : ""} Append ' !' to send as-is.`,
          rewrittenPrompt,
          clipboardCopied,
          systemDirective: "",
          tokensSavedEstimate: TYPICAL_TASK_TOKENS.STANDARD / 2,
        },
        delta,
      );
    }

    // 7. Opus overkill. The exact, untouched prompt goes to the clipboard.
    if (isOpusOverkill(activeState, complexity, mode)) {
      const clipboardCopied = await this.copy(prompt);
      return this.finish(
        {
          ...common,
          action: "block",
          blockCategory: "model-overkill",
          reason: OPUS_OVERKILL_MESSAGE,
          suggestedCommand: "/model sonnet",
          clipboardCopied,
          systemDirective: "",
          tokensSavedEstimate: Math.round(
            TYPICAL_TASK_TOKENS[complexity] * (TIER_COST_WEIGHT["deep-reasoning"] - TIER_COST_WEIGHT.balanced),
          ),
        },
        delta,
      );
    }

    // 8. Allow, with an advisory (LAW 4) directive. LAW 3: the prompt itself is never modified.
    return this.finish(
      {
        ...common,
        action: "allow",
        reason: aiReason ?? local.reason,
        systemDirective: buildSystemDirective(complexity, usageBudget, verifiedGitFiles, hints, activeState.detectedModelTier),
        tokensSavedEstimate: estimateAllowSavings(complexity, hints.length > 0, usageBudget),
      },
      delta,
    );
  }

  /** Stop hook: if the session ended on a rate-limit, build the rescue package. */
  async handleStop(input: BouncerEvaluationInput): Promise<StopOutcome> {
    try {
      if (!RescueEngine.detectRateLimit(input.transcriptPath)) return { rateLimitDetected: false };
      const rescue = await this.rescue(input.cwd, input.transcriptPath, "rate-limit");
      return { rateLimitDetected: true, rescue };
    } catch {
      return { rateLimitDetected: false };
    }
  }

  /** `bouncer rescue` / automatic rate-limit rescue. */
  rescue(cwd: string, transcriptPath?: string, reason: "manual" | "rate-limit" = "manual"): Promise<RescuePackage> {
    return new RescueEngine({
      git: this.gitFactory(cwd),
      classifier: this.classifier,
      clipboard: this.clipboard,
      clipboardEnabled: this.config.clipboardEnabled,
      persist: this.persist,
    }).build({ cwd, transcriptPath, reason });
  }
}

function listFiles(files: string[]): string {
  const shown = files.slice(0, MAX_LISTED_FILES).map((f) => `@${f}`);
  if (files.length > MAX_LISTED_FILES) shown.push(`(+${files.length - MAX_LISTED_FILES} more)`);
  return shown.join(", ");
}

export function buildSystemDirective(
  complexity: TaskComplexity,
  budget: UsageBudget,
  verifiedGitFiles: string[],
  hints: string[],
  activeTier: string,
): string {
  const lines: string[] = [];
  const tools = budget.maxExplorationToolCalls === "unlimited" ? "no tool-call limit" : `≤${budget.maxExplorationToolCalls} exploration tool calls`;
  lines.push(
    `[Bouncer] Task: ${complexity} · Budget: ${MODEL_LABEL[budget.recommendedModel]} / ${budget.recommendedEffort} effort · ${tools} · output: ${budget.outputStyle}.`,
  );

  if (verifiedGitFiles.length) lines.push(`Ground truth — files modified in git right now: ${listFiles(verifiedGitFiles)}.`);

  // LAW 4: hints are advisory starting points, never exclusive instructions.
  const fallback =
    complexity === "STANDARD"
      ? "if the target logic is elsewhere, delegate search to the `bouncer-scout` subagent"
      : "if the target logic is elsewhere, search for it";
  if (hints.length) lines.push(`Check these verified workspace files first: ${listFiles(hints)}; ${fallback}.`);

  switch (complexity) {
    case "TRIVIAL":
      lines.push("Make the smallest surgical edit. Reply with a short summary of the diff — no essays, no unrelated refactors.");
      break;
    case "STANDARD":
      if (!hints.length) lines.push("Delegate any broad file search to the `bouncer-scout` subagent (Haiku) to protect this context.");
      lines.push("Deliver a complete, working change; keep explanations concise.");
      break;
    case "COMPLEX":
      lines.push("VIP Velvet Rope: complex task — no brevity or tool-call restrictions. Explore and reason as deeply as needed.");
      if (activeTier !== "deep-reasoning") lines.push("Tip for the user: '/model opus' + '/effort high' is recommended for this task.");
      break;
  }
  return lines.join("\n");
}

function estimateAllowSavings(complexity: TaskComplexity, hasHints: boolean, budget: UsageBudget): number {
  if (complexity === "COMPLEX") return 0;
  let saved = 0;
  if (hasHints) saved += 3_000; // skipped exploratory reads
  if (complexity === "TRIVIAL") saved += 2_000; // surgical output
  if (budget.delegateSearchToHaikuSubagent && !hasHints) saved += 2_000; // search offloaded to Haiku
  return saved;
}
