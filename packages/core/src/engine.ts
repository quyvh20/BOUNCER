// Safe 3-tier evaluation orchestrator: Level 1 (local) -> optional Level 2/3 AI -> enforcement.
import { copyToClipboard, type ClipboardWriter } from "./clipboard.js";
import { applySafetyLaws, buildIntelligenceProfile, BYOKClassifier, withDeadline } from "./byok-provider.js";
import { GitContext } from "./git-context.js";
import {
  buildUsageBudget,
  detectActiveSession,
  contextWindowFor,
  isContextBloated,
  CHEAP_SWITCH_CONTEXT,
  isOpusOverkill,
  opusClipboardText,
  tierFromModelName,
  OPUS_OVERKILL_MESSAGE,
  OPUS_WARN_MESSAGE,
  TIER_COST_WEIGHT,
  TYPICAL_TASK_TOKENS,
} from "./model-enforcer.js";
import { formatNotice, newSessionStep, pasteStep } from "./messages.js";
import { RescueEngine } from "./rescue.js";
import { DEFAULT_CONFIG, loadConfig, loadSession, recordAbTurn, recordEvaluation, type EvaluationStatsDelta } from "./storage.js";
import { lastTurnUsage } from "./transcript.js";
import {
  BROAD_SCOPE_MIN_FILES,
  PASTE_MAX_TOKENS,
  TOKENS_PER_FILE_READ,
  classifyComplexity,
  detectBroadScope,
  estimateTokens,
  extractFileMentions,
  hasConcreteAnchor,
  hasProblemSignal,
  isScoped,
  isVaguePrompt,
  isVipPass,
  matchModifiedFiles,
  resolveMentions,
  scanContraband,
} from "./tier1-local.js";
import type {
  AgentPlatform,
  BouncerConfig,
  BouncerEvaluationInput,
  BouncerEvaluationResult,
  Classifier,
  EffortLevel,
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
  /** Random source for the A/B split (tests). */
  random?: () => number;
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
  private readonly random: () => number;
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
    this.random = options.random ?? Math.random;
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
      platform: input.platform,
      activeState,
      verifiedGitFiles: [] as string[],
      highConfidenceHints: [] as string[],
      handledByTier: 1 as const,
    };

    this.sessionId = input.sessionId;
    const session = this.persist ? loadSession(input.sessionId) : undefined;
    const overridden = (cat: string) => session?.overrides?.includes(cat as never) ?? false;
    // The host's word on the current model beats the transcript: it is known before the first answer and
    // follows a /model switch at once. Same for the effort sent with the prompt.
    if (session?.hostModel) {
      activeState.hostModelName = session.hostModel;
      const tier = tierFromModelName(session.hostModel);
      if (tier !== "unknown") activeState.detectedModelTier = tier;
    }
    const effort = normalizeEffort(input.effort);
    if (effort) activeState.detectedEffort = effort;

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
        reason: formatNotice({
          title: "🔑 SECRET BLOCKED",
          body: [
            `${contraband.detail}. Your prompt was NOT sent to any model.`,
            "Remove the secret (refer to an environment variable instead), and rotate the key if it was ever shared.",
          ],
          canOverride: false,
        }),
        systemDirective: "",
        tokensSavedEstimate: 0,
      });
    }

    // 2. Bouncer's own handover, pasted into a fresh session: that is the advice being followed, so it goes
    // through untouched (it is long by design). Secrets were already checked above.
    if (isBouncerHandover(prompt)) {
      return this.finish({
        ...base,
        action: "allow",
        complexity: local.complexity,
        usageBudget: buildUsageBudget("COMPLEX"),
        confidenceScore: 1,
        reason: "Bouncer handover pasted: all checks bypassed.",
        systemDirective: "",
        tokensSavedEstimate: 0,
      });
    }

    // VIP pass ("... !"): bypass every other check, add nothing.
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
        reason: formatNotice({
          title: "📜 LOG DUMP",
          body: [
            `${contraband.detail}. Every line would stay in the context and be re-read on each turn.`,
            "Save it to a file and paste only what matters (the first stack trace, or the last 30 lines).",
          ],
        }),
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
        reason: formatNotice({
          title: "📦 PASTE TOO BIG",
          body: [
            `This prompt is ~${Math.round(pasteTokens / 1000)}k tokens, and it would be re-read on every later turn of this session.`,
            "Save it to a file and mention it with @path: the model then reads only the parts it needs.",
          ],
        }),
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
          reason: formatNotice({
            title: "💸 TOO BROAD",
            body: [
              `"${phrase}" over ${files.length} files could burn ~${Math.round(estimate / 1000)}k tokens.`,
              `Name a folder or file${topDirs.length ? ` (e.g. ${topDirs.join(", ")})` : ""}, or ask for a plan first.`,
            ],
          }),
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

    // Earlier prompts of this session, and whether this one only refers back to them.
    const previousPrompts = (activeState.recentPrompts ?? []).filter((p) => p.trim() !== prompt.trim());
    const blindFollowUp = previousPrompts.length > 0 && !hasConcreteAnchor(prompt) && local.confidence < 0.85;

    let complexity = local.complexity;
    let hints = uniq([...exactHints, ...gitHints]);
    let confidenceScore = exactHints.length ? 1 : gitHints.length ? 0.85 : local.confidence;
    let handledByTier: 1 | 2 | 3 = 1;
    let rewrittenPrompt: string | undefined;
    let aiReason: string | undefined;
    // The AI's vague verdict, when it answered: it read the prompt in its session context, so it replaces
    // Level 1's keyword patterns. A "vague" without saying what's missing doesn't count.
    let aiVagueVerdict: { vague: boolean; missing?: string } | undefined;
    let aiSizeConfidence: number | undefined;
    let aiNewTask: boolean | undefined;
    const delta: EvaluationStatsDelta = {};

    // 4. Optional Level 2/3 AI, hard deadline, fail-open to Level 1.
    // Skipped when Level 1 is already certain (an exact @file plus a strong local signal): the AI could only
    // add latency and spend free quota there.
    const levelOneCertain = exactHints.length > 0 && local.confidence >= 0.85;
    if (levelOneCertain && this.classifier) delta.aiSkipped = true;
    // Lean mode: the AI only runs when a decision depends on it, so most prompts pay no latency.
    //  - vagueness, where it can block: first prompt of a session (balanced) or any prompt (strict)
    //  - eco, once the context is over budget: is this a new task?
    const freshSession = !activeState.rawModelName;
    const eco = this.config.ecoContextTokens;
    const ecoActive = !!eco && mode !== "yolo";
    const ecoOverBudget = ecoActive && !overridden("eco-clear") && (activeState.contextTokens ?? 0) > eco!;
    const vagueCanBlock = (mode === "strict" || (mode === "balanced" && freshSession)) && !overridden("vague-prompt");
    // On Opus in a small session, "is this routine?" decides a block, and Level 1 only knows a few phrasings.
    // Warn-only mode never blocks, so a wrong guess costs nothing and the AI isn't worth its latency there.
    const opusWarnOnly = this.config.opusGuard === "warn";
    const opusGuarded =
      activeState.detectedModelTier === "deep-reasoning" &&
      mode !== "yolo" &&
      !overridden("model-overkill") &&
      (activeState.contextTokens ?? 0) < CHEAP_SWITCH_CONTEXT;
    const opusCanBlock = opusGuarded && !opusWarnOnly;
    const aiNeeded = !!this.config.aiEveryPrompt || vagueCanBlock || ecoOverBudget || opusCanBlock;
    if (this.classifier && this.intelligence.level > 1 && !levelOneCertain && !aiNeeded) delta.aiIdle = true;
    if (this.classifier && this.intelligence.level > 1 && !levelOneCertain && aiNeeded) {
      delta.aiCalled = true;
      const classifier = this.classifier;
      const ai = await withDeadline(
        (signal) =>
          classifier.classify(
            {
              prompt,
              modifiedFiles: verifiedGitFiles,
              workspaceFiles: isRepo ? git.workspaceSample(40, prompt) : [],
              previousPrompts,
            },
            signal,
          ),
        this.config.aiTimeoutMs,
      );
      if (ai.value) {
        const safe = applySafetyLaws(ai.value, git, this.intelligence, prompt);
        complexity = ai.value.complexity;
        hints = uniq([...exactHints, ...safe.hints, ...gitHints]);
        confidenceScore = ai.value.confidence;
        rewrittenPrompt = ai.value.rewrittenPrompt;
        aiReason = ai.value.reason;
        aiVagueVerdict = { vague: !!ai.value.vague && !!ai.value.missing, missing: ai.value.missing };
        aiSizeConfidence = ai.value.sizeConfidence;
        aiNewTask = ai.value.newTask;
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

    // 5. Crowd control. Strict blocks with a /clear handover. Balanced only warns, once per session:
    // clearing mid-task drops detail Claude needs (quality guard), so the user picks the moment.
    let notice: Pick<BouncerEvaluationResult, "userNotice" | "noticeCategory"> = {};
    const bloated = mode !== "yolo" && !overridden("context-bloat") && isContextBloated(activeState, this.config);
    if (bloated && mode === "balanced") {
      if (!session?.noticed?.includes("context-bloat")) {
        const used = activeState.contextTokens !== undefined ? `~${Math.round(activeState.contextTokens / 1000)}k of ${Math.round(contextWindowFor(activeState) / 1000)}k context tokens` : `a ${Math.round(activeState.transcriptSizeBytes / 1024)}KB transcript`;
        notice = {
          userNotice: `🧹 Bouncer: this session uses ${used}, and every turn re-reads it. When this task is done, run 'bouncer rescue' for a handover, then '${clearCommand(input.platform)}'.`,
          noticeCategory: "context-bloat",
        };
      }
    } else if (bloated) {
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
          reason: formatNotice({
            title: "🧹 CONTEXT FULL",
            body: [
              `This session's ${size}, and every turn re-reads all of it.`,
              handoverLine(pkg),
            ],
            steps: pkg.clipboardCopied ? [newSessionStep(clearCommand(input.platform)), pasteStep()] : [newSessionStep(clearCommand(input.platform)), "paste the handover file"],
            overrideAsk: "Want to stay in this session?",
          }),
          suggestedCommand: clearCommand(input.platform),
          handoverPrompt: pkg.markdown,
          clipboardCopied: pkg.clipboardCopied,
          systemDirective: "",
          // One re-read of the history avoided; taken back if the user overrides with ' !'.
          tokensSavedEstimate: activeState.contextTokens ?? Math.round(activeState.transcriptSizeBytes / 4),
        },
        delta,
      );
    }

    // 6. Vague prompt. Strict: always. Balanced: only before Claude has answered anything in this session,
    // because mid-conversation "fix it" refers to what was just discussed (quality guard).
    // LAW 3: a rewrite only ever goes to the clipboard.
    // With an AI: its judgement of meaning in context, in any language. Without one: Level 1 patterns.
    const vague = aiVagueVerdict ? aiVagueVerdict.vague : isVaguePrompt(prompt);
    const missing = aiVagueVerdict?.missing;
    if (vagueCanBlock && vague) {
      const clipboardCopied = rewrittenPrompt ? await this.copy(rewrittenPrompt) : false;
      return this.finish(
        {
          ...common,
          action: "block",
          blockCategory: "vague-prompt",
          reason: formatNotice({
            title: "🤨 PROMPT TOO VAGUE",
            body: [
              missing ? `Missing: ${missing}.` : "It names no file, function or error.",
              "Without it, the model burns tokens hunting for what you mean.",
              ...(clipboardCopied ? ["✔ A sharper version of your prompt is on your clipboard."] : []),
            ],
            steps: clipboardCopied ? [pasteStep(), "check it", "send"] : undefined,
          }),
          rewrittenPrompt,
          clipboardCopied,
          systemDirective: "",
          tokensSavedEstimate: TYPICAL_TASK_TOKENS.STANDARD / 2,
        },
        delta,
      );
    }

    // 6b. Eco mode: re-reading a big context is most of the bill (measured on real sessions: ~77% of cost),
    // so a NEW task above the budget starts fresh with a handover. Quality guard: never for follow-ups,
    // corrections or anything continuing the current work, where the context is what makes Claude right.
    if (ecoOverBudget) {
      // The AI judges meaning in context. Without it: a prompt that describes a task on its own (3+ content
      // words) and shares no word with the session's recent prompts.
      const newTask = aiNewTask ?? (contentWords(prompt).size >= 3 && previousPrompts.length > 0 && !previousPrompts.some((p) => sharesWords(prompt, p)));
      if (newTask) {
        const pkg = await new RescueEngine({
          git,
          clipboard: this.clipboard,
          clipboardEnabled: this.config.clipboardEnabled,
          persist: this.persist,
        }).build({ cwd: input.cwd, transcriptPath: input.transcriptPath, reason: "context-bloat", pendingPrompt: prompt });
        const ctx = activeState.contextTokens!;
        const handover = estTokens(pkg.markdown);
        const cheaper = Math.max(0, Math.round((1 - (handover + 20_000) / ctx) * 100)); // ~20k: system prompt + tools
        const clear = clearCommand(input.platform);
        return this.finish(
          {
            ...common,
            action: "block",
            blockCategory: "eco-clear",
            ecoActive,
            reason: formatNotice({
              title: "🌱 NEW TASK? START FRESH",
              body: [
                `This session re-reads ~${Math.round(ctx / 1000)}k tokens on every call; in a new session each call gets ~${cheaper}% cheaper.`,
                "This looks like a new task, so it doesn't need the old context.",
                handoverLine(pkg),
              ],
              steps: pkg.clipboardCopied ? [newSessionStep(clear), pasteStep()] : [newSessionStep(clear), "paste the handover file"],
              overrideAsk: "Want to stay in this session?",
            }),
            suggestedCommand: clear,
            handoverPrompt: pkg.markdown,
            clipboardCopied: pkg.clipboardCopied,
            systemDirective: "",
            // One re-read of the old context avoided; taken back if the user overrides with ' !'.
            tokensSavedEstimate: Math.max(0, ctx - handover),
          },
          delta,
        );
      }
    }

    // 7. Opus overkill, only while switching is cheap (small context). Quality guard: blocking interrupts real
    // work, so Level 1 must agree the task is routine, or the AI must be sure of it AND the prompt must not
    // describe something broken (a "crash" is never routine). The exact, untouched prompt goes to the clipboard.
    const aiSureRoutine =
      handledByTier > 1 && confidenceScore >= 0.9 && (aiSizeConfidence ?? 0) >= 0.8 && local.complexity !== "COMPLEX" && !hasProblemSignal(prompt);
    const opusOverkill =
      opusGuarded &&
      isOpusOverkill(activeState, complexity, mode) &&
      (isOpusOverkill(activeState, local.complexity, mode) || aiSureRoutine);
    if (opusOverkill && opusWarnOnly) {
      // Warn mode: the prompt goes through on Opus right away; the user only gets a reminder.
      notice = {
        userNotice: [notice.userNotice, OPUS_WARN_MESSAGE].filter(Boolean).join("\n"),
        noticeCategory: notice.noticeCategory ?? "model-overkill",
      };
    } else if (opusOverkill) {
      const clipboardCopied = await this.copy(opusClipboardText(prompt));
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
    // Quality guard: limits are only sent when Bouncer is sure of the task size (the AI answered, or a strong
    // local signal). A guessed STANDARD label must never squeeze a big task.
    // A follow-up with no file, symbol or number ("cả hai", "sửa luôn", "do it") points at earlier work whose
    // size neither the AI nor Level 1 can see, so it never gets limits. Nor does an AI unsure of the size.
    const aiSureOfSize = handledByTier > 1 && (aiSizeConfidence ?? 1) >= 0.6;
    const budgetApplied = !blindFollowUp && (aiSureOfSize || local.confidence >= 0.85);
    let savings = estimateAllowSavings(complexity, hints.length, usageBudget, budgetApplied, input.platform);
    let systemDirective = buildSystemDirective(complexity, usageBudget, verifiedGitFiles, hints, activeState.detectedModelTier, budgetApplied, input.platform);
    // A/B measurement: on a random half of the prompts Bouncer would guide, send nothing, then compare the
    // real usage of both groups (Stop hook). Control prompts claim no savings.
    let abGroup: "treatment" | "control" | undefined;
    if (this.config.measure && systemDirective) {
      abGroup = this.random() < 0.5 ? "control" : "treatment";
      if (abGroup === "control") {
        systemDirective = "";
        savings = [];
      }
    }
    return this.finish(
      {
        ...common,
        ...notice,
        action: "allow",
        reason: aiReason ?? local.reason,
        systemDirective,
        tokensSavedEstimate: savings.reduce((sum, item) => sum + item.tokens, 0),
        savings,
        budgetApplied,
        abGroup,
        ecoActive,
      },
      delta,
    );
  }

  /** Stop hook: if the session ended on a rate-limit, build the rescue package. */
  async handleStop(input: BouncerEvaluationInput): Promise<StopOutcome> {
    if (this.persist && this.config.measure) recordAbTurn(input.sessionId, lastTurnUsage(input.transcriptPath));
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
  limits = true,
  platform: AgentPlatform = "claude-code",
): string {
  const lines: string[] = [];
  // Claude Code has a built-in Explore subagent and named model tiers; other hosts get neutral wording.
  const claude = platform === "claude-code";
  if (!limits) {
    // Unsure of the task size: pass on only verified facts, no labels or limits.
    if (verifiedGitFiles.length) lines.push(`Modified in git: ${listFiles(verifiedGitFiles)}.`);
    if (hints.length) lines.push(`Likely files (verified to exist): ${listFiles(hints)}; else search for it.`);
    return lines.length ? `[Bouncer] ${lines.join("\n")}` : "";
  }
  // Injected on every prompt, so every word costs tokens: keep it terse.
  const tools = budget.maxExplorationToolCalls === "unlimited" ? "no tool-call limit" : `aim for ≤${budget.maxExplorationToolCalls} exploration calls`;
  const route = claude ? `${MODEL_LABEL[budget.recommendedModel]}/${budget.recommendedEffort}` : `${budget.recommendedEffort} reasoning effort`;
  lines.push(`[Bouncer] ${complexity} · ${route} · ${tools} · ${budget.outputStyle}.`);

  if (verifiedGitFiles.length) lines.push(`Modified in git: ${listFiles(verifiedGitFiles)}.`);

  // LAW 4: hints are advisory starting points, never exclusive instructions.
  const fallback = complexity === "STANDARD" && claude ? "else delegate the search to the Explore subagent" : "else search for it";
  if (hints.length) lines.push(`Likely files (verified to exist): ${listFiles(hints)}; ${fallback}.`);

  switch (complexity) {
    case "TRIVIAL":
      lines.push("Smallest correct edit; short diff summary, no unrelated refactors.");
      break;
    case "STANDARD":
      if (!hints.length && claude) lines.push("Delegate broad file searches to the Explore subagent.");
      lines.push("Complete, working change; concise explanation.");
      break;
    case "COMPLEX":
      lines.push("Complex task: no brevity or tool-call limits; explore and reason as deeply as needed.");
      if (claude && activeTier !== "deep-reasoning") lines.push("Tip for the user: '/model opus' + '/effort high' suits this task.");
      if (!claude) lines.push("Tip for the user: a high reasoning effort suits this task.");
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

/** What happened to the handover: on the clipboard (with the prompt), or saved to a file. */
function handoverLine(pkg: RescuePackage): string {
  if (pkg.clipboardCopied) return "✔ Your handover (goal, recent prompts, git state and this prompt) is on your clipboard.";
  return pkg.savedTo ? `✔ Your handover (goal, recent prompts, git state and this prompt) is saved at ${pkg.savedTo}.` : "Run 'bouncer rescue' for a handover.";
}

/** True when the two texts share a meaningful word (4+ letters, any script). */
function contentWords(t: string): Set<string> {
  return new Set(t.toLowerCase().match(/[\p{L}\p{N}_]{4,}/gu) ?? []);
}

function sharesWords(a: string, b: string): boolean {
  const wb = contentWords(b);
  return [...contentWords(a)].some((w) => wb.has(w));
}

/** The host's "start fresh" command. */
function clearCommand(platform: AgentPlatform): string {
  return platform === "codex" ? "/new" : "/clear";
}

function estimateAllowSavings(complexity: TaskComplexity, hints: number, budget: UsageBudget, limits: boolean, platform: AgentPlatform = "claude-code"): SavingsItem[] {
  const items: SavingsItem[] = [];
  if (hints) items.push({ label: `${hints} verified file hint${hints > 1 ? "s" : ""}, fewer exploratory reads`, tokens: 3_000 });
  if (complexity === "COMPLEX" || !limits) return items;
  if (complexity === "TRIVIAL") items.push({ label: "surgical diff instead of a long answer", tokens: 2_000 });
  return items;
}

/** Host effort names ("xhigh", "max", …) mapped onto Bouncer's three levels. */
function normalizeEffort(effort: string | undefined): EffortLevel | undefined {
  const e = effort?.toLowerCase();
  if (!e) return undefined;
  if (e === "low" || e === "minimal") return "low";
  if (e === "medium") return "medium";
  if (e === "high" || e === "xhigh" || e === "max") return "high";
  return undefined;
}

/** A handover or rescue that Bouncer generated (its markdown title), pasted back in. */
export function isBouncerHandover(prompt: string): boolean {
  return /^\s*#\s*(?:🧹|🚨)\s*BOUNCER (?:HANDOVER|RESCUE)\b/u.test(prompt);
}
