import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { contextWindowFor } from "./model-enforcer.js";
import { MIN_CONTEXT_FOR_REL_COST, contextBand, turnCost } from "./transcript.js";
import type { AbBucket, BlockCategory, BouncerConfig, BouncerEvaluationResult, BouncerStats, SessionStats, TurnUsage } from "./types.js";

export const DEFAULT_CONFIG: BouncerConfig = {
  mode: "balanced",
  contextBloatThresholdTokens: 150_000,
  contextBloatThresholdBytes: 130 * 1024,
  aiTimeoutMs: 1500,
  clipboardEnabled: true,
  footerEnabled: true,
};

export const EMPTY_STATS: BouncerStats = {
  promptsEvaluated: 0,
  promptsAllowed: 0,
  promptsBlocked: 0,
  blocksByCategory: {},
  vipPasses: 0,
  aiCalls: 0,
  aiFailOpens: 0,
  tokensSavedEstimate: 0,
  rescuesGenerated: 0,
  aiSkipped: 0,
  sessions: {},
};

/** Sessions kept for per-session savings and overrides; older ones are pruned. */
const MAX_SESSIONS = 30;

/** Root of all Bouncer state. Override with BOUNCER_HOME (used by tests). */
export function getBouncerHome(): string {
  return process.env.BOUNCER_HOME || join(homedir(), ".bouncer");
}

export const paths = {
  config: () => join(getBouncerHome(), "config.json"),
  stats: () => join(getBouncerHome(), "stats.json"),
  cache: () => join(getBouncerHome(), "cache.json"),
  lastRescue: () => join(getBouncerHome(), "last-rescue.md"),
  lastHandover: () => join(getBouncerHome(), "last-handover.md"),
};

function ensureHome(): void {
  mkdirSync(getBouncerHome(), { recursive: true });
}

function readJson<T>(file: string): T | undefined {
  try {
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // Corrupt state must never break the user's prompt flow.
    return undefined;
  }
}

/** Atomic write: write to a temp file, then rename over the target. */
function writeJson(file: string, data: unknown): void {
  ensureHome();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

export function loadConfig(): BouncerConfig {
  const stored = readJson<Partial<BouncerConfig>>(paths.config()) ?? {};
  return { ...DEFAULT_CONFIG, ...stored };
}

export function saveConfig(config: BouncerConfig): void {
  writeJson(paths.config(), config);
}

export function updateConfig(patch: Partial<BouncerConfig>): BouncerConfig {
  const next = { ...loadConfig(), ...patch };
  saveConfig(next);
  return next;
}

export function loadStats(): BouncerStats {
  const stored = readJson<Partial<BouncerStats>>(paths.stats()) ?? {};
  return { ...EMPTY_STATS, ...stored, blocksByCategory: { ...stored.blocksByCategory }, sessions: { ...stored.sessions } };
}

export function saveStats(stats: BouncerStats): void {
  writeJson(paths.stats(), stats);
}

export interface EvaluationStatsDelta {
  vipPass?: boolean;
  aiCalled?: boolean;
  aiFailedOpen?: boolean;
  aiSkipped?: boolean;
  /** An AI is configured, but no decision on this prompt needed it (lean mode). */
  aiIdle?: boolean;
}

/**
 * The host told us the session's current model (SessionStart, PostModelSwitch, status line). Lets the
 * Opus guard work on the very first prompt, and notice a switch before the next answer. Never throws.
 */
export function recordHostModel(sessionId: string | undefined, model: string | undefined): void {
  try {
    if (!sessionId || !model) return;
    const stats = loadStats();
    const session = (stats.sessions[sessionId] ??= emptySession(new Date().toISOString()));
    if (session.hostModel === model) return;
    session.hostModel = model;
    saveStats(stats);
  } catch {
    /* stats are best-effort */
  }
}

/** Stop hook: fold the real usage of a finished A/B turn into its group. Never throws. */
export function recordAbTurn(sessionId: string | undefined, usage: TurnUsage | undefined): void {
  try {
    if (!sessionId) return;
    const stats = loadStats();
    const session = stats.sessions[sessionId];
    const pending = session?.pendingAb;
    if (!session || !pending) return;
    session.pendingAb = undefined;
    // Without the context size the turn can't be compared fairly, so it isn't recorded.
    if (usage && pending.context !== undefined) {
      stats.abFair ??= {};
      const bySize = (stats.abFair[pending.complexity] ??= {});
      const byBand = (bySize[contextBand(pending.context)] ??= {});
      const b: AbBucket = (byBand[pending.group] ??= { turns: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0, toolCalls: 0, calls: 0, relCost: 0 });
      b.turns += 1;
      b.relCost += turnCost(usage) / Math.max(pending.context, MIN_CONTEXT_FOR_REL_COST);
      b.calls = (b.calls ?? 0) + (usage.calls ?? 0);
      b.input += usage.input;
      b.cacheCreation += usage.cacheCreation;
      b.cacheRead += usage.cacheRead;
      b.output += usage.output;
      b.toolCalls += usage.toolCalls;
    }
    saveStats(stats);
  } catch {
    /* stats are best-effort */
  }
}

export function loadSession(sessionId: string | undefined): SessionStats | undefined {
  if (!sessionId) return undefined;
  return loadStats().sessions[sessionId];
}

const BLOCK_SAVING_LABEL: Record<BlockCategory, string> = {
  "model-overkill": "Opus avoided on a routine task",
  "context-bloat": "history not re-read (/clear handover)",
  "vague-prompt": "guesswork on a vague prompt avoided",
  "contraband-secret": "secret kept out of the context",
  "contraband-log": "log dump kept out of the context",
  "broad-scope": "unscoped repo-wide crawl avoided",
  "oversized-paste": "big paste not re-read every turn",
  "eco-clear": "new task started in a fresh, small context",
};

function emptySession(now: string): SessionStats {
  return { prompts: 0, blocks: 0, tokensSaved: 0, lastTokensSaved: 0, overrides: [], lastSeenAt: now };
}

function pruneSessions(sessions: Record<string, SessionStats>): void {
  const ids = Object.keys(sessions);
  if (ids.length <= MAX_SESSIONS) return;
  ids.sort((a, b) => sessions[b]!.lastSeenAt.localeCompare(sessions[a]!.lastSeenAt));
  for (const id of ids.slice(MAX_SESSIONS)) delete sessions[id];
}

/** Fold one evaluation into the persisted stats. Never throws. */
export function recordEvaluation(result: BouncerEvaluationResult, delta: EvaluationStatsDelta = {}, sessionId?: string): void {
  try {
    const stats = loadStats();
    const now = new Date().toISOString();
    stats.promptsEvaluated += 1;
    if (result.action === "allow") stats.promptsAllowed += 1;
    else stats.promptsBlocked += 1;
    if (result.blockCategory) {
      const cat: BlockCategory = result.blockCategory;
      stats.blocksByCategory[cat] = (stats.blocksByCategory[cat] ?? 0) + 1;
    }
    if (delta.vipPass) stats.vipPasses += 1;
    if (delta.aiCalled) stats.aiCalls += 1;
    if (delta.aiFailedOpen) stats.aiFailOpens += 1;
    if (delta.aiSkipped) stats.aiSkipped += 1;
    if (result.activeState.contextTokens !== undefined) {
      stats.contextAtPrompt ??= {};
      const bucket = (stats.contextAtPrompt[result.ecoActive ? "on" : "off"] ??= { n: 0, sum: 0 });
      bucket.n += 1;
      bucket.sum += result.activeState.contextTokens;
    }
    const saved = Math.max(0, Math.round(result.tokensSavedEstimate));
    stats.tokensSavedEstimate += saved;
    const retract = (session: SessionStats) => {
      // The user overrode the last block with ' !': its savings never happened.
      const back = Math.min(session.lastBlockSaved ?? 0, stats.tokensSavedEstimate);
      stats.tokensSavedEstimate -= back;
      session.tokensSaved = Math.max(0, session.tokensSaved - back);
      session.lastBlockSaved = 0;
    };
    if (sessionId) {
      const session = (stats.sessions[sessionId] ??= emptySession(now));
      session.overrides ??= [];
      session.prompts += 1;
      session.tokensSaved += saved;
      session.lastTokensSaved = saved;
      session.lastSeenAt = now;
      session.last = {
        action: result.action,
        blockCategory: result.blockCategory,
        complexity: result.complexity,
        recommendedModel: result.usageBudget.recommendedModel,
        recommendedEffort: result.usageBudget.recommendedEffort,
        detectedModel: result.activeState.detectedModelTier,
        detectedEffort: result.activeState.detectedEffort,
        hints: result.highConfidenceHints.length,
        gitFiles: result.verifiedGitFiles.length,
        contextTokens: result.activeState.contextTokens,
        contextWindow: contextWindowFor(result.activeState),
        budgetApplied: result.budgetApplied,
        platform: result.platform,
        abGroup: result.abGroup,
        ai: delta.vipPass ? "vip" : delta.aiFailedOpen ? "fail-open" : delta.aiCalled ? "ok" : delta.aiSkipped ? "skipped" : delta.aiIdle ? "idle" : "off",
        savings: result.savings ?? (saved > 0 && result.blockCategory ? [{ label: BLOCK_SAVING_LABEL[result.blockCategory], tokens: saved }] : []),
      };
      const followedSwitch = session.lastBlockCategory === "model-overkill" && result.activeState.detectedModelTier !== "deep-reasoning";
      if (delta.vipPass && followedSwitch) {
        // Pasted back after switching away from Opus: the advice was followed, not overridden.
        session.lastBlockCategory = undefined;
        session.lastBlockSaved = 0;
      } else if (delta.vipPass && session.lastBlockCategory) {
        // The user re-sent a blocked prompt with ' !': respect that choice for the rest of the session.
        if (!session.overrides.includes(session.lastBlockCategory)) session.overrides.push(session.lastBlockCategory);
        session.lastBlockCategory = undefined;
        retract(session);
      } else if (result.blockCategory) {
        session.blocks += 1;
        session.lastBlockCategory = result.blockCategory;
        session.lastBlockSaved = saved;
      } else {
        session.lastBlockCategory = undefined;
        session.lastBlockSaved = 0;
      }
      session.pendingAb = result.abGroup
        ? { group: result.abGroup, complexity: result.complexity, context: result.activeState.contextTokens }
        : undefined;
      if (result.noticeCategory) {
        session.noticed ??= [];
        if (!session.noticed.includes(result.noticeCategory)) session.noticed.push(result.noticeCategory);
      }
      pruneSessions(stats.sessions);
    }
    stats.firstSeenAt ??= now;
    stats.lastEvaluatedAt = now;
    saveStats(stats);
  } catch {
    /* stats are best-effort */
  }
}

export function recordRescue(): void {
  try {
    const stats = loadStats();
    stats.rescuesGenerated += 1;
    saveStats(stats);
  } catch {
    /* best-effort */
  }
}

export function resetState(): void {
  writeJson(paths.stats(), EMPTY_STATS);
  writeJson(paths.cache(), {});
}

/** Persist a markdown document (rescue/handover) and return its path. */
export function saveMarkdown(file: string, markdown: string): string | undefined {
  try {
    ensureHome();
    writeFileSync(file, markdown, "utf8");
    return file;
  } catch {
    return undefined;
  }
}

// Small keyed cache (e.g. classifier results) with TTL.
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export function cacheGet<T>(key: string): T | undefined {
  const cache = readJson<Record<string, CacheEntry<T>>>(paths.cache()) ?? {};
  const entry = cache[key];
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  try {
    const cache = readJson<Record<string, CacheEntry<unknown>>>(paths.cache()) ?? {};
    const now = Date.now();
    for (const [k, v] of Object.entries(cache)) if (v.expiresAt < now) delete cache[k];
    cache[key] = { value, expiresAt: now + ttlMs };
    writeJson(paths.cache(), cache);
  } catch {
    /* best-effort */
  }
}
