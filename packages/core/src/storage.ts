import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BlockCategory, BouncerConfig, BouncerEvaluationResult, BouncerStats, SessionStats } from "./types.js";

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
}

export function loadSession(sessionId: string | undefined): SessionStats | undefined {
  if (!sessionId) return undefined;
  return loadStats().sessions[sessionId];
}

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
    const saved = Math.max(0, Math.round(result.tokensSavedEstimate));
    stats.tokensSavedEstimate += saved;
    if (sessionId) {
      const session = (stats.sessions[sessionId] ??= emptySession(now));
      session.overrides ??= [];
      session.prompts += 1;
      session.tokensSaved += saved;
      session.lastTokensSaved = saved;
      session.lastSeenAt = now;
      if (delta.vipPass && session.lastBlockCategory) {
        // The user re-sent a blocked prompt with ' !': respect that choice for the rest of the session.
        if (!session.overrides.includes(session.lastBlockCategory)) session.overrides.push(session.lastBlockCategory);
        session.lastBlockCategory = undefined;
      } else if (result.blockCategory) {
        session.blocks += 1;
        session.lastBlockCategory = result.blockCategory;
      } else {
        session.lastBlockCategory = undefined;
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
