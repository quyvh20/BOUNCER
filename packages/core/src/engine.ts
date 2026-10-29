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
import { DEFAULT_CONFIG, loadConfig, loadSession, recordEvaluation, type EvaluationStatsDelta } from "./storage.js";
import {
  BROAD_SCOPE_MIN_FILES,
  PASTE_MAX_TOKENS,
  TOKENS_PER_FILE_READ,
  classifyComplexity,
  VAGUE_MAX_TOKENS,
  detectBroadScope,
  estimateTokens,
  extractFileMentions,
  hasConcreteAnchor,
  isScoped,
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
  SavingsItem,
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
const estTokens = estimateTokens;
const MAX_LISTED_FILES = 8;

const MODEL_LABEL = { fast: "Haiku", balanced: "Sonnet", "deep-reasoning": "Opus" } as const;

export class BouncerEngine {
  readonly config: BouncerConfig;
  readonly intelligence: IntelligenceProfile;
  private readonly classifier: Classifier | null;
  private readonly gitFactory: (cwd: string) => GitContext;
  private readonly clipboard: ClipboardWriter;
  private readonly persist: boolean;
  private sessionId?: string;

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
    if (this.persist) recordEvaluation(result, delta, this.sessionId);
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

    this.sessionId = input.sessionId;
    const session = this.persist ? loadSession(input.sessionId) : undefined;
    const overridden = (cat: string) => session?.overrides?.includes(cat as never) ?? false;

    // 1. Leaked secrets are blocked first: not even the ' !' VIP pass may send a key to a model.
    const contraband = scanContraband(prompt);
    if (contraband?.category === "contraband-secret") {
      return this.finish({
        ...base,
        action: "block",
        blockCategory: "contraband-secret",
        complexity: local.complexity,
        usageBudget: buildUsageBudget(local.complexity),
        confidenceScore: 1,
        reason: `🚫 CONTRABAND: ${contraband.detail}. Your prompt was NOT sent. Remove the secret (use an env var reference instead) and rotate the key if it was ever shared.`,
        systemDirective: "",
        tokensSavedEstimate: 0,
      });
    }

    // 2. VIP pass ("... !"): bypass every other check, add nothing.
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

    // Pasted log dumps (before any LLM sees the prompt).
    if (contraband && mode !== "yolo" && !overridden("contraband-log")) {
      return this.finish({
        ...base,
        action: "block",
        blockCategory: contraband.category,
        complexity: local.complexity,
        usageBudget: buildUsageBudget(local.complexity),
        confidenceScore: 1,
        reason: `🚫 CONTRABAND: ${contraband.detail}. Save it to a file and reference only the relevant lines (e.g. the last 30 lines or the first stack trace), or append ' !' to send anyway.`,
        systemDirective: "",
        tokensSavedEstimate: estTokens(prompt),
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

    // Oversized paste: it stays in context and is re-read on every later turn.
    const pasteTokens = estTokens(prompt);
    if (mode !== "yolo" && !overridden("oversized-paste") && pasteTokens > PASTE_MAX_TOKENS[mode]) {
      return this.finish({
        ...base,
        action: "block",
        blockCategory: "oversized-paste",
        complexity: local.complexity,
        usageBudget: buildUsageBudget(local.complexity),
        confidenceScore: 1,
        reason: `📦 BIG PASTE: this prompt is ~${Math.round(pasteTokens / 1000)}k tokens and will be re-read on every later turn of this session. Save it to a file and mention it with @path (Claude reads only what it needs), or append ' !' to send anyway.`,
        systemDirective: "",
        tokensSavedEstimate: pasteTokens,
      });
    }

    // 3. Level 1 git-truth context (zero network).
    const git = this.gitFactory(input.cwd);
    const isRepo = git.isRepo();

    // Unscoped repo-wide ask ("review the whole codebase", "đọc hết code", "整个项目"): Claude would crawl
    // every file. Local patterns cover major languages before any network call; the AI covers the rest below.
    const broadBlock = (phrase: string | undefined, delta: EvaluationStatsDelta = {}): BouncerEvaluationResult | undefined => {
      if (!phrase || mode === "yolo" || overridden("broad-scope") || !isRepo) return undefined;
      const files = git.lsFiles();
      if (files.length < BROAD_SCOPE_MIN_FILES[mode] || isScoped(prompt, files)) return undefined;
      const estimate = files.length * TOKENS_PER_FILE_READ;
      const topDirs = [...new Set(files.filter((f) => f.includes("/")).map((f) => `${f.split("/")[0]}/`))].slice(0, 4);
      return this.finish(
        {
          ...base,
          action: "block",
          blockCategory: "broad-scope",
          complexity: local.complexity,
          usageBudget: buildUsageBudget(local.complexity),
          confidenceScore: 0.9,
          reason: `💸 BROAD SCOPE: "${phrase}" over ${files.length} files could burn ~${Math.round(estimate / 1000)}k tokens. Narrow it to a folder or file${topDirs.length ? ` (e.g. ${topDirs.join(", ")})` : ""}, or ask for a plan first. Append ' !' to send anyway.`,
          systemDirective: "",
          tokensSavedEstimate: Math.min(estimate, TYPICAL_TASK_TOKENS.COMPLEX),
        },
        delta,
      );
    };
    const localBroad = broadBlock(detectBroadScope(prompt));
    if (localBroad) return localBroad;
    const verifiedGitFiles = isRepo ? git.validateFiles(git.modifiedFiles()) : [];
    const exactHints = isRepo ? git.validateFiles(resolveMentions(extractFileMentions(prompt), git.lsFiles())) : [];
    const gitHints = matchModifiedFiles(prompt, verifiedGitFiles);

    let complexity = local.complexity;
    let hints = uniq([...exactHints, ...gitHints]);
    let confidenceScore = exactHints.length ? 1 : gitHints.length ? 0.85 : local.confidence;
    let handledByTier: 1 | 2 | 3 = 1;
    let rewrittenPrompt: string | undefined;
    let aiReason: string | undefined;
    let aiVague = false;
    const delta: EvaluationStatsDelta = {};

    // 4. Optional Level 2/3 AI, hard deadline, fail-open to Level 1.
    // Skipped when Level 1 is already certain (an exact @file plus a strong local signal): the AI could only
    // add latency and spend free quota there.
    const levelOneCertain = exactHints.length > 0 && local.confidence >= 0.85;
    if (levelOneCertain && this.classifier) delta.aiSkipped = true;
    if (this.classifier && this.intelligence.level > 1 && !levelOneCertain) {
      delta.aiCalled = true;
      const classifier = this.classifier;
      const ai = await withDeadline(
        (signal) =>
          classifier.classify(
            { prompt, modifiedFiles: verifiedGitFiles, workspaceFiles: isRepo ? git.workspaceSample(40, prompt) : [] },
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
        aiVague = !!ai.value.vague;
        handledByTier = this.intelligence.level;
        const aiBroad = ai.value.broadScope ? broadBlock(shorten(prompt), delta) : undefined;
        if (aiBroad) return aiBroad;
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
    if (mode !== "yolo" && !overridden("context-bloat") && isContextBloated(activeState, this.config)) {
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

    // 6. Vague prompt. Strict: always. Balanced: only before Claude has answered anything in this session,
    // because mid-conversation "fix it" refers to what was just discussed (quality guard).
    // LAW 3: a rewrite only ever goes to the clipboard.
    const freshSession = !activeState.rawModelName;
    // Any language: local patterns, or the AI's verdict on a short prompt with no concrete anchor.
    const vague = isVaguePrompt(prompt) || (aiVague && estimateTokens(prompt) <= VAGUE_MAX_TOKENS && !hasConcreteAnchor(prompt));
    if ((mode === "strict" || (mode === "balanced" && freshSession)) && !overridden("vague-prompt") && vague) {
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

    // 7. Opus overkill. Quality guard: blocking interrupts real work, so the local classifier AND the final
    // (possibly AI) verdict must both call the task routine. The exact, untouched prompt goes to the clipboard.
    if (
      !overridden("model-overkill") &&
      isOpusOverkill(activeState, complexity, mode) &&
      isOpusOverkill(activeState, local.complexity, mode)
    ) {
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
    const savings = estimateAllowSavings(complexity, hints.length, usageBudget);
    return this.finish(
      {
        ...common,
        action: "allow",
        reason: aiReason ?? local.reason,
        systemDirective: buildSystemDirective(complexity, usageBudget, verifiedGitFiles, hints, activeState.detectedModelTier),
        tokensSavedEstimate: savings.reduce((sum, item) => sum + item.tokens, 0),
        savings,
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
  // Injected on every prompt, so every word costs tokens: keep it terse.
  const tools = budget.maxExplorationToolCalls === "unlimited" ? "no tool-call limit" : `aim for ≤${budget.maxExplorationToolCalls} exploration calls`;
  lines.push(`[Bouncer] ${complexity} · ${MODEL_LABEL[budget.recommendedModel]}/${budget.recommendedEffort} · ${tools} · ${budget.outputStyle}.`);

  if (verifiedGitFiles.length) lines.push(`Modified in git: ${listFiles(verifiedGitFiles)}.`);

  // LAW 4: hints are advisory starting points, never exclusive instructions.
  const fallback = complexity === "STANDARD" ? "else delegate the search to `bouncer-scout`" : "else search for it";
  if (hints.length) lines.push(`Likely files (verified to exist): ${listFiles(hints)}; ${fallback}.`);

  switch (complexity) {
    case "TRIVIAL":
      lines.push("Smallest correct edit; short diff summary, no unrelated refactors.");
      break;
    case "STANDARD":
      if (!hints.length) lines.push("Delegate broad file searches to `bouncer-scout` (Haiku).");
      lines.push("Complete, working change; concise explanation.");
      break;
    case "COMPLEX":
      lines.push("Complex task: no brevity or tool-call limits; explore and reason as deeply as needed.");
      if (activeTier !== "deep-reasoning") lines.push("Tip for the user: '/model opus' + '/effort high' suits this task.");
      break;
  }
  // Quality guard: the budget is a hint, never a reason to ship worse work.
  if (complexity !== "COMPLEX") lines.push("Quality first: if the task is bigger than labelled, ignore these limits and do it properly.");
  return lines.join("\n");
}

/** First ~40 characters of a prompt, for quoting it back in a block message. */
function shorten(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

function estimateAllowSavings(complexity: TaskComplexity, hints: number, budget: UsageBudget): SavingsItem[] {
  if (complexity === "COMPLEX") return [];
  const items: SavingsItem[] = [];
  if (hints) items.push({ label: `${hints} verified file hint${hints > 1 ? "s" : ""}, fewer exploratory reads`, tokens: 3_000 });
  if (complexity === "TRIVIAL") items.push({ label: "surgical diff instead of a long answer", tokens: 2_000 });
  if (budget.delegateSearchToHaikuSubagent && !hints) items.push({ label: "file search offloaded to Haiku scout", tokens: 2_000 });
  return items;
}
