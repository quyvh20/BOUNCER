// Bring-Your-Own-Key AI client (OpenAI-compatible) + Model Capability Grader.
import { relevanceScore, type GitContext } from "./git-context.js";
import type {
  Classifier,
  ClassifierRequest,
  ClassifierResponse,
  IntelligenceLevel,
  IntelligenceProfile,
  PresetName,
  ProviderConfig,
  TaskComplexity,
} from "./types.js";

// ---------------------------------------------------------------------------
// One-command presets (`bouncer config --preset <name> --key <KEY>`)
// ---------------------------------------------------------------------------
export interface PresetDefinition {
  providerName: string;
  baseUrl: string;
  model: string;
  requiresKey: boolean;
  /** baseUrl contains `{account_id}` that must be filled in (Cloudflare). */
  requiresAccountId?: boolean;
  /** Smallest AI time budget this provider needs in practice; `config --preset` raises the budget to it. */
  minTimeoutMs?: number;
  blurb: string;
}

export const PRESETS: Record<PresetName, PresetDefinition> = {
  "groq-gold": {
    providerName: "Groq Cloud",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    requiresKey: true,
    blurb: "Free tier, ~150ms latency, top-tier semantic file matching.",
  },
  "gemini-gold": {
    providerName: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    requiresKey: true,
    blurb: "Free tier on Google AI Studio, massive context understanding.",
  },
  "ollama-coder": {
    providerName: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1/chat/completions",
    model: "qwen2.5-coder:7b",
    requiresKey: false,
    blurb: "100% offline. qwen2.5-coder:7b = Silver, qwen2.5-coder:14b+ = Gold.",
  },
  "cloudflare-gold": {
    providerName: "Cloudflare Workers AI",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions",
    // Benchmarked (2 sequential rounds, 10 labelled prompts): Mistral Small 3.1 answered 20/20 within 3s with
    // perfect task-size and vagueness calls and no misleading hints. Scout was as accurate but timed out
    // more (p90 up to 8s). Reasoning models (gpt-oss, Qwen 3.8, GLM, DeepSeek v4) were slower or unstable.
    model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    requiresKey: true,
    requiresAccountId: true,
    minTimeoutMs: 3000,
    blurb: "Free daily allocation on any Cloudflare account, edge latency.",
  },
};

export function isPresetName(name: string): name is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESETS, name);
}

export interface PresetOptions {
  apiKey?: string;
  model?: string;
  accountId?: string;
}

export function providerFromPreset(name: PresetName, options: PresetOptions = {}): ProviderConfig {
  const p = PRESETS[name];
  if (p.requiresAccountId && !/^[0-9a-f]{32}$/i.test(options.accountId ?? "")) {
    throw new Error(`Preset '${name}' needs a 32-character hex account ID.`);
  }
  return {
    providerName: p.providerName,
    baseUrl: p.baseUrl.replace("{account_id}", options.accountId ?? ""),
    model: options.model ?? p.model,
    apiKey: options.apiKey,
    preset: name,
  };
}

// ---------------------------------------------------------------------------
// Capability grader
// ---------------------------------------------------------------------------
const BADGES = {
  1: "🥉 LEVEL 1 (Local Git-Truth)",
  2: "🥈 LEVEL 2 (Silver 8B AI)",
  3: "🥇 LEVEL 3 (Gold 70B/Flash)",
} as const;

const THRESHOLDS: Record<IntelligenceLevel, number> = { 1: 1, 2: 0.9, 3: 0.8 };

/** Smallest open-weights size (billions of params) that grades as Gold. */
export const GOLD_MIN_PARAMS_B = 14;

/** Extract a parameter count in billions from names like `llama-3.3-70b`, `qwen2.5-coder:14b`, `mixtral-8x7b`. */
export function parseParamsB(model: string): number | undefined {
  const m = model.toLowerCase();
  const moe = m.match(/(?:^|[^a-z0-9.])(\d+)x(\d+(?:\.\d+)?)b(?![a-z])/);
  if (moe) return Number(moe[1]) * Number(moe[2]);
  const dense = m.match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/);
  return dense ? Number(dense[1]) : undefined;
}

const FRONTIER_GOLD = [
  /gemini-[\d.]+-(?:flash|pro)(?!-lite)/,
  /\bgpt-(?:4o|4\.1|5)(?!-?(?:mini|nano))/,
  /\bo[134](?:-|$)(?!.*mini)/,
  /\bclaude-/,
  /\bdeepseek-(?:v3|r1|chat|reasoner)/,
  /\bmistral-large/,
  /\bgrok-/,
];

export function gradeLevel(model: string | undefined): IntelligenceLevel {
  if (!model || !model.trim()) return 1;
  const m = model.toLowerCase();
  const params = parseParamsB(m);
  if (params !== undefined) return params >= GOLD_MIN_PARAMS_B ? 3 : 2;
  if (/(?:^|[-_:.\s])(?:mini|nano|lite|small|tiny)\b/.test(m)) return 2; // not the "mini" in "gemini"
  if (FRONTIER_GOLD.some((re) => re.test(m))) return 3;
  return 2; // unknown models get the stricter Silver threshold
}

export function buildIntelligenceProfile(provider?: ProviderConfig): IntelligenceProfile {
  const level = provider ? gradeLevel(provider.model) : 1;
  return {
    level,
    badge: BADGES[level],
    providerName: level === 1 ? "Local (offline)" : provider!.providerName,
    modelName: level === 1 ? "git-truth + regex" : provider!.model,
    minConfidenceThreshold: THRESHOLDS[level],
  };
}

// ---------------------------------------------------------------------------
// Untrusted output validation + Safety Laws 1 & 2
// ---------------------------------------------------------------------------
const COMPLEXITIES: TaskComplexity[] = ["TRIVIAL", "STANDARD", "COMPLEX"];

/** Strip ``` fences / leading prose and parse the first JSON object. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

/** Shape-check raw model output. Returns null when it doesn't honour the contract. */
export function parseClassifierResponse(raw: unknown): ClassifierResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  let complexity = typeof r.complexity === "string" ? r.complexity.toUpperCase() : "";
  let confidence = Number(r.confidence);
  if (!COMPLEXITIES.includes(complexity as TaskComplexity)) {
    // Small models sometimes answer "complexity":"VAGUE". Keep the vague/broadScope verdicts, but trust
    // nothing else: STANDARD routing and zero confidence, so no file hints pass Law 2.
    if (typeof r.vague !== "boolean" && typeof r.broadScope !== "boolean") return null;
    complexity = "STANDARD";
    confidence = 0;
  }
  if (!Number.isFinite(confidence)) return null;
  return {
    complexity: complexity as TaskComplexity,
    matchedFiles: Array.isArray(r.matchedFiles) ? r.matchedFiles.filter((f): f is string => typeof f === "string") : [],
    keywords: Array.isArray(r.keywords) ? r.keywords.filter((k): k is string => typeof k === "string").slice(0, 8) : undefined,
    confidence: Math.min(1, Math.max(0, confidence)),
    rewrittenPrompt: typeof r.rewrittenPrompt === "string" && r.rewrittenPrompt.trim() ? r.rewrittenPrompt : undefined,
    reason: typeof r.reason === "string" ? r.reason : undefined,
    sizeConfidence: Number.isFinite(Number(r.sizeConfidence)) ? Math.min(1, Math.max(0, Number(r.sizeConfidence))) : undefined,
    vague: r.vague === true,
    missing: typeof r.missing === "string" && r.missing.trim() ? r.missing.trim().slice(0, 160) : undefined,
    broadScope: r.broadScope === true,
  };
}

export interface SafeHints {
  /** Files that survived Law 1 (exist) and Law 2 (confidence gate). */
  hints: string[];
  /** Files that exist but were withheld because confidence was below threshold. */
  withheldLowConfidence: string[];
  /** Hallucinated / non-existent paths that were stripped. */
  stripped: string[];
  /** Real files withheld because nothing in the prompt or the AI's keywords relates to their path. */
  irrelevant?: string[];
}

/**
 * LAW 1: intersect AI-suggested files with `git ls-files` + disk.
 * LAW 2: only release them when confidence >= the profile's threshold.
 */
export function applySafetyLaws(response: ClassifierResponse, git: GitContext, profile: IntelligenceProfile, prompt = ""): SafeHints {
  const verified = git.validateFiles(response.matchedFiles);
  const stripped = response.matchedFiles.filter((f) => git.validateFiles([f]).length === 0);
  const confidence = effectiveConfidence(response);
  if (confidence < profile.minConfidenceThreshold) {
    return { hints: [], withheldLowConfidence: verified, stripped };
  }
  // Relevance check: a hint's path must share a word with the prompt or the AI's own keywords (which
  // cover non-English prompts). Small models otherwise attach confident but unrelated files.
  const text = `${prompt} ${(response.keywords ?? []).join(" ")}`;
  const relevant = verified.filter((f) => confidence >= UNRELATED_HINT_CONFIDENCE || relevanceScore(f, text) > 0);
  return {
    hints: relevant.slice(0, MAX_AI_HINTS),
    withheldLowConfidence: [],
    stripped,
    irrelevant: verified.filter((f) => !relevant.includes(f)),
  };
}

/** A hint whose path relates to nothing in the prompt is only passed on at this confidence. */
export const UNRELATED_HINT_CONFIDENCE = 0.95;

/** At most this many AI-suggested files reach Claude. */
export const MAX_AI_HINTS = 3;

/**
 * Small models report ~0.8 confidence no matter what (measured on Workers AI), even while listing 4–5
 * files, which is a guess. Each file beyond MAX_AI_HINTS discounts the confidence by 15%, so a scattershot
 * answer falls under the Law 2 gate instead of sending Claude to the wrong files.
 */
export function effectiveConfidence(response: ClassifierResponse): number {
  const extra = Math.max(0, response.matchedFiles.length - MAX_AI_HINTS);
  return response.confidence * Math.pow(0.85, extra);
}

// ---------------------------------------------------------------------------
// OpenAI-compatible client
// ---------------------------------------------------------------------------
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const CLASSIFIER_SYSTEM_PROMPT = `You are Bouncer, a routing classifier for a coding agent. You NEVER write code.
Given a developer's prompt, the files currently modified in git, and a sample of workspace file paths, return ONLY a JSON object:
{"complexity":"TRIVIAL"|"STANDARD"|"COMPLEX","matchedFiles":["path"],"confidence":0.0-1.0,"rewrittenPrompt":"string","reason":"string","sizeConfidence":0.0-1.0,"vague":boolean,"missing":"string","broadScope":boolean,"keywords":["word"]}
The prompt may be in ANY language: judge its meaning, never its keywords or language.
Rules:
- TRIVIAL: typo, rename, one-line/config/copy change. STANDARD: normal feature/bugfix in a few files. COMPLEX: architecture, cross-cutting refactor, concurrency, design.
- sizeConfidence: how sure you are of the complexity. A short follow-up that only refers to earlier work ("do it", "both", "fix that too", "làm luôn", "đánh giá coi") hides the real size: use 0.3 or less there, never guess TRIVIAL from a short message.
- matchedFiles: ONLY paths copied verbatim from the provided lists that the task most likely touches. Never invent paths. Empty array if unsure or if no listed file fits.
- keywords: 2-5 lowercase English code words the task is about (e.g. "logout", "header", "auth"), translated if the prompt is not in English.
- confidence: your probability that matchedFiles contains the right starting point.
- rewrittenPrompt: ONLY when vague is true, a sharper version of the prompt (same intent, no new requirements) in the SAME language as the prompt; otherwise "".
- vague: read the prompt together with previousPrompts (earlier prompts of the same session; [] = first prompt). true only if a competent developer with that context could not tell what to change or answer. Judge meaning, not length: a long prompt can be vague, a short one clear. A follow-up like "fix it" or "làm tiếp" is NOT vague when previousPrompts make the target clear.
- missing: when vague is true, what the developer must add (e.g. "which file and which error"), at most 10 words, in the SAME language as the prompt; otherwise "".
- broadScope: true only if it asks to read, review, refactor or rewrite the whole project/repo/codebase or all files, without naming a folder or file.
- reason: at most 8 words.
Be brief: every output token delays the developer.`;

const SUMMARY_SYSTEM_PROMPT = `Summarise the progress of this coding session for a developer resuming it in a new session.
Return ONLY JSON: {"bullets":["...","...","..."]} with exactly 3 concise bullets: what was accomplished, current state, the immediate next step.
Do not invent file names, commands or results that are not in the transcript.`;

export class BYOKClassifier implements Classifier {
  readonly profile: IntelligenceProfile;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly provider: ProviderConfig,
    fetchImpl?: FetchLike,
  ) {
    this.profile = buildIntelligenceProfile(provider);
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async chat(system: string, user: string, signal: AbortSignal, maxTokens: number): Promise<string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.provider.apiKey) headers.authorization = `Bearer ${this.provider.apiKey}`;
    const res = await this.fetchImpl(this.provider.baseUrl, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: this.provider.model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${this.provider.providerName} HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("empty completion");
    return content;
  }

  async classify(request: ClassifierRequest, signal: AbortSignal): Promise<ClassifierResponse> {
    const user = JSON.stringify({
      prompt: request.prompt.slice(0, 4000),
      modifiedFiles: request.modifiedFiles.slice(0, 40),
      workspaceFiles: request.workspaceFiles.slice(0, 40),
      previousPrompts: request.previousPrompts ?? [],
    });
    // The JSON is ~60 tokens once rewrittenPrompt is skipped; a tight cap keeps a rambling model fast.
    const content = await this.chat(CLASSIFIER_SYSTEM_PROMPT, user, signal, 250);
    const parsed = parseClassifierResponse(extractJson(content));
    if (!parsed) throw new Error("classifier output violated the JSON contract");
    return parsed;
  }

  async summarizeProgress(turns: string[], signal: AbortSignal): Promise<string[]> {
    // Keep the most recent ~24k chars of conversation.
    let budget = 24_000;
    const recent: string[] = [];
    for (let i = turns.length - 1; i >= 0 && budget > 0; i--) {
      const t = turns[i]!.slice(0, budget);
      recent.unshift(t);
      budget -= t.length;
    }
    const content = await this.chat(SUMMARY_SYSTEM_PROMPT, recent.join("\n\n"), signal, 500);
    const raw = extractJson(content) as { bullets?: unknown };
    if (!Array.isArray(raw.bullets)) throw new Error("summary output violated the JSON contract");
    return raw.bullets.filter((b): b is string => typeof b === "string" && b.trim() !== "").slice(0, 3);
  }
}

/**
 * Run an AI call with a hard deadline. Resolves undefined on timeout or any error (fail-open),
 * even if the underlying implementation ignores the abort signal.
 */
export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<{ value?: T; error?: unknown; timedOut: boolean }> {
  const controller = new AbortController();
  const TIMEOUT = Symbol("timeout");
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT);
    }, timeoutMs);
  });
  try {
    const outcome = await Promise.race([run(controller.signal), timeout]);
    if (outcome === TIMEOUT) return { timedOut: true };
    return { value: outcome as T, timedOut: false };
  } catch (error) {
    return { error, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}
