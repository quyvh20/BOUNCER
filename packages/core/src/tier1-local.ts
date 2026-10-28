// LEVEL 1 (Bronze): deterministic, offline, zero-network checks.
import { basename } from "node:path";
import { normalizeRepoPath } from "./git-context.js";
import type { BlockCategory, TaskComplexity } from "./types.js";

// ---------------------------------------------------------------------------
// VIP pass: a trailing standalone "!" forces the prompt through every check.
// "fix bug !" -> pass. "Fix it!" (exclamation glued to a word) is NOT a pass.
// ---------------------------------------------------------------------------
const VIP_PASS = /(?:^|\s)!\s*$/;

export function isVipPass(prompt: string): boolean {
  return VIP_PASS.test(prompt);
}

// ---------------------------------------------------------------------------
// Contraband: secrets and giant pasted logs.
// ---------------------------------------------------------------------------
interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{4,}/ },
  { name: "OpenAI API key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { name: "Groq API key", re: /\bgsk_[A-Za-z0-9]{20,}/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: "Stripe secret key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: "Private key block", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: "Credentialed connection string",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:[^\s@/]{3,}@/i,
  },
];

const LOG_LINE =
  /^\s*(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\[?\d{2}:\d{2}:\d{2}|\[?(?:INFO|WARN(?:ING)?|ERROR|DEBUG|TRACE|FATAL)\b|at\s+[\w$.<>]+\s*\(|at\s+\S+:\d+:\d+|\s*File ".*", line \d+|npm (?:ERR|WARN)!|Traceback)/i;

export const LOG_MIN_LINES = 60;
export const LOG_MIN_CHARS = 6000;

export interface ContrabandHit {
  category: Extract<BlockCategory, "contraband-secret" | "contraband-log">;
  detail: string;
}

/** Redact a matched secret for display (keep a short prefix only). */
function redact(s: string): string {
  return s.length <= 8 ? "****" : `${s.slice(0, 6)}…(${s.length} chars)`;
}

export function scanContraband(prompt: string): ContrabandHit | null {
  for (const { name, re } of SECRET_PATTERNS) {
    const m = prompt.match(re);
    if (m) return { category: "contraband-secret", detail: `${name} detected (${redact(m[0])})` };
  }
  const lines = prompt.split(/\r?\n/);
  if (lines.length >= LOG_MIN_LINES && prompt.length >= LOG_MIN_CHARS) {
    const logLines = lines.filter((l) => LOG_LINE.test(l)).length;
    if (logLines / lines.length >= 0.4) {
      return {
        category: "contraband-log",
        detail: `Pasted log detected (${lines.length} lines, ~${Math.round(prompt.length / 4)} tokens)`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Complexity classification (regex heuristics).
// ---------------------------------------------------------------------------
const COMPLEX_PATTERNS: RegExp[] = [
  /\b(?:design|architect(?:ure)?|re-?architect)\b.*\b(?:system|service|architecture|platform|pipeline|schema|api|distributed|scalab\w*)\b/i,
  /\bdistributed\b/i,
  /\bsystem design\b/i,
  /\b(?:from scratch|greenfield)\b/i,
  /\b(?:migrate|migration|port)\b.*\b(?:to|from)\b/i,
  /\brefactor\b.*\b(?:entire|whole|all|across|codebase|architecture|module(?:s)?)\b/i,
  /\b(?:race condition|deadlock|memory leak|concurren(?:cy|t)|thread[- ]safe)\b/i,
  /\b(?:security audit|threat model|zero[- ]downtime|sharding|consensus|rate[- ]limit(?:ing|er))\b/i,
  /\b(?:performance|optimi[sz]e)\b.*\b(?:across|entire|whole|system|bottleneck)\b/i,
];

const TRIVIAL_PATTERNS: RegExp[] = [
  /\b(?:typo|typos|spelling|misspell\w*|grammar)\b/i,
  /\brename\b/i,
  /\b(?:add|remove|update|fix)\s+(?:a\s+|the\s+)?(?:comment|docstring|log(?:ging)? line|import|semicolon|trailing\s+\w+)\b/i,
  /\b(?:format|prettier|lint|indent(?:ation)?|whitespace)\b/i,
  /\bbump\b.*\bversion\b/i,
  /\b(?:change|update|set)\b.*\b(?:color|colour|label|text|string|copy|title|wording|constant|port)\b/i,
  /\bremove\b.*\b(?:unused|console\.log|print statement|dead code)\b/i,
];

export interface LocalClassification {
  complexity: TaskComplexity;
  confidence: number;
  reason: string;
}

export function classifyComplexity(prompt: string): LocalClassification {
  const text = prompt.trim();
  const words = text.split(/\s+/).filter(Boolean).length;

  const complex = COMPLEX_PATTERNS.find((re) => re.test(text));
  if (complex) return { complexity: "COMPLEX", confidence: 0.85, reason: `complex signal: ${complex.source}` };

  const trivial = TRIVIAL_PATTERNS.find((re) => re.test(text));
  if (trivial && words <= 40) {
    return { complexity: "TRIVIAL", confidence: 0.85, reason: `trivial signal: ${trivial.source}` };
  }

  if (words > 150) return { complexity: "COMPLEX", confidence: 0.6, reason: "long, detailed request" };
  return { complexity: "STANDARD", confidence: 0.7, reason: "no strong local signal" };
}

// ---------------------------------------------------------------------------
// Vague prompt detection (only enforced in strict mode).
// ---------------------------------------------------------------------------
const VAGUE_PATTERNS: RegExp[] = [
  /^(?:fix|debug|check|look at|help|improve|update|clean ?up|make it work|do it|continue|again|try again)(?:\s+(?:it|this|that|them|everything|stuff|things|the (?:bug|error|issue|code|problem)))?[.!?]*$/i,
  /^(?:it|this|that)\s+(?:doesn'?t|does not|isn'?t|is not)\s+work(?:ing)?[.!?]*$/i,
  /^(?:still )?(?:broken|not working|error|bug|wtf|why)[.!?]*$/i,
];

/** True when the prompt gives Claude nothing concrete to anchor on (no file, symbol, or error). */
export function isVaguePrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return true;
  if (extractFileMentions(text).length > 0) return false;
  if (/[`(){}[\]<>=]|\w+\.\w+|\w+_\w+|[a-z][A-Z]/.test(text)) return false; // code-ish tokens
  return VAGUE_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Exact file matching.
// ---------------------------------------------------------------------------
const AT_MENTION = /(?:^|\s)@([^\s,;:'"`()]+)/g;
const BARE_PATH = /(?:^|[\s"'`(])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s"'`),:;!?])/g;

/** Explicit `@file` mentions plus bare path-like tokens (`src/foo.ts`, `README.md`). */
export function extractFileMentions(prompt: string): string[] {
  const found = new Set<string>();
  for (const m of prompt.matchAll(AT_MENTION)) if (m[1]) found.add(normalizeRepoPath(m[1].replace(/[.!?]+$/, "")));
  for (const m of prompt.matchAll(BARE_PATH)) {
    const p = m[1];
    if (!p || /^\d+(?:\.\d+)+$/.test(p) || /^(?:e\.g|i\.e|etc)\./i.test(p)) continue; // versions, abbreviations
    found.add(normalizeRepoPath(p));
  }
  return [...found];
}

/**
 * Resolve mentions to real workspace paths: exact path first, then a unique basename match.
 * The result still has to go through GitContext.validateFiles (Safety Law 1).
 */
export function resolveMentions(mentions: string[], workspaceFiles: string[]): string[] {
  const set = new Set(workspaceFiles);
  const byBase = new Map<string, string[]>();
  for (const f of workspaceFiles) {
    const b = basename(f).toLowerCase();
    const list = byBase.get(b);
    if (list) list.push(f);
    else byBase.set(b, [f]);
  }
  const out: string[] = [];
  for (const m of mentions) {
    if (set.has(m)) {
      out.push(m);
      continue;
    }
    const suffix = workspaceFiles.filter((f) => f.endsWith(`/${m}`));
    if (suffix.length === 1) {
      out.push(suffix[0]!);
      continue;
    }
    const sameBase = byBase.get(basename(m).toLowerCase());
    if (sameBase?.length === 1) out.push(sameBase[0]!);
  }
  return [...new Set(out)];
}

const STOPWORDS = new Set(
  "the a an and or to of in on for with fix add update make change bug error issue file code this that it is be please can you".split(" "),
);

function keywords(prompt: string): string[] {
  return [
    ...new Set(
      prompt
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    ),
  ];
}

/**
 * Git-truth relevance: modified files whose path segments share a keyword with the prompt.
 * e.g. "the payment webhook fails" + modified src/payment/stripe.ts -> src/payment/stripe.ts
 */
export function matchModifiedFiles(prompt: string, modifiedFiles: string[]): string[] {
  const kws = keywords(prompt);
  if (kws.length === 0) return [];
  return modifiedFiles.filter((f) => {
    const segments = f.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return kws.some((k) => segments.some((s) => s === k || (s.length >= 4 && (s.startsWith(k) || k.startsWith(s)))));
  });
}
