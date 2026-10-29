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
// Vague prompt detection (strict: always; balanced: only before Claude has any context).
// ---------------------------------------------------------------------------
const VAGUE_PATTERNS: RegExp[] = [
  /^(?:fix|debug|check|look at|help|improve|update|clean ?up|make it work|do it|continue|again|try again)(?:\s+(?:it|this|that|them|everything|stuff|things|the (?:bug|error|issue|code|problem)))?[.!?]*$/i,
  /^(?:it|this|that)\s+(?:doesn'?t|does not|isn'?t|is not)\s+work(?:ing)?[.!?]*$/i,
  /^(?:still )?(?:broken|not working|error|bug|wtf|why)[.!?]*$/i,
  // Vietnamese: "sửa đi", "fix lỗi giúp", "nó không chạy", "vẫn lỗi"
  /^(?:sửa|fix|xem|kiểm tra|check|debug|làm|chạy|tiếp|tiếp tục)(?:\s+(?:lại|đi|giúp|giùm|hộ|cho tôi|cho tao|cho mình|nó|cái này|cái đó|lỗi|bug|code|thử))*\s*[.!?]*$/iu,
  /^(?:nó\s+|cái này\s+|code\s+)?(?:vẫn\s+)?(?:không|ko|k|chưa)\s+(?:chạy|được|hoạt động|work)(?:\s+(?:rồi|nữa|gì cả))?\s*[.!?]*$/iu,
  /^(?:vẫn\s+)?(?:lỗi|bug|hỏng|toang)(?:\s+(?:rồi|nữa|tiếp|kìa))?\s*[.!?]*$/iu,
  // Spanish / Portuguese
  /^(?:arr[eé]gla(?:lo)?|corr[ií]ge(?:lo)?|conserta(?:\s+isso)?|corrija(?:\s+isso)?|arruma(?:\s+isso)?|revisa(?:lo)?|ayuda|ajuda)[.!?¡¿]*$/iu,
  /^(?:(?:todav[ií]a|a[uú]n|ainda)\s+)?(?:no funciona|não funciona|n[aã]o roda|deu erro|da error|sigue (?:sin funcionar|fallando))[.!?¡¿]*$/iu,
  // French
  /^(?:corrige(?:[- ]le| ça)?|répare(?:[- ]le| ça)?|aide(?:[- ]moi)?|toujours pas|erreur)[.!?]*$/iu,
  /^(?:ça|ca)\s+(?:ne\s+)?(?:marche|fonctionne)\s+(?:toujours\s+)?pas[.!?]*$/iu,
  // German
  /^(?:fix(?:e|en)?|repariere|korrigiere|hilfe|fehler)(?:\s+(?:das|es|bitte))*[.!?]*$/iu,
  /^(?:es|das)?\s*(?:geht|funktioniert|läuft)\s+(?:immer noch\s+)?nicht[.!?]*$/iu,
  // Russian
  /^(?:исправь|почини|поправь|проверь|сделай|помоги)(?:\s+(?:это|его|ошибку|пожалуйста))*[.!?]*$/iu,
  /^(?:всё ещё\s+|все еще\s+)?(?:не работает|ошибка|сломалось)[.!?]*$/iu,
  // Indonesian / Malay
  /^(?:perbaiki|benerin|betulkan|cek)(?:\s+(?:ini|itu|dong|lagi))*[.!?]*$/iu,
  /^(?:masih\s+)?(?:tidak jalan|nggak jalan|gak jalan|error)[.!?]*$/iu,
  // Chinese
  /^(?:帮我)?(?:修(?:复)?|改|看看|检查)(?:一下)?(?:吧|啊)?[。！？!?.]*$/u,
  /^(?:还是?)?(?:不行|不能用|不工作|报错了?|出错了?|有bug)(?:啊|了)?[。！？!?.]*$/iu,
  // Japanese
  /^(?:直して|修正して|治して|見て|確認して)(?:ください|くれ)?[。！？!?.]*$/u,
  /^(?:まだ)?(?:動かない|エラー(?:が出る|です)?|バグ(?:です)?)[。！？!?.]*$/u,
  // Korean
  /^(?:고쳐|수정해|확인해|봐)(?:줘|주세요)?[.!?]*$/u,
  /^(?:아직도?\s*)?(?:안\s?돼(?:요)?|작동\s?안\s?해(?:요)?|에러|오류|버그)[.!?]*$/u,
  // Turkish / Italian / Polish / Dutch
  /^(?:düzelt|onar|bak)(?:\s+(?:şunu|bunu|şu|bu|lütfen))*[.!?]*$/iu,
  /^(?:hala\s+)?(?:çalışmıyor|hata (?:var|veriyor))[.!?]*$/iu,
  /^(?:sistemalo|correggilo|aiuto|non funziona(?:\s+ancora)?)[.!?]*$/iu,
  /^(?:napraw(?:\s+to)?|popraw(?:\s+to)?|nie działa|dalej nie działa)[.!?]*$/iu,
  /^(?:fix het|repareer(?:\s+het)?|het werkt (?:nog steeds )?niet|werkt niet)[.!?]*$/iu,
  // Arabic
  /^(?:أصلحه|أصلح(?:\s+(?:هذا|ذلك))?|لا يعمل|ما زال لا يعمل|خطأ)[.!?؟]*$/u,
  // Thai / Hindi
  /^(?:แก้(?:ให้)?(?:หน่อย)?|ยังไม่ได้|ไม่ทำงาน)[.!?]*$/u,
  /^(?:ठीक करो|इसे ठीक करो|काम नहीं कर रहा|एरर)[.!?।]*$/u,
];

/** Rough token count: CJK, kana, hangul and Thai are ~1 token per character, other scripts ~4 chars per token. */
export function estimateTokens(text: string): number {
  const dense = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/gu)?.length ?? 0;
  return Math.ceil(dense + (text.length - dense) / 4);
}

/** True when the prompt names something concrete: a file, a code token, a number, or a quoted string. */
export function hasConcreteAnchor(prompt: string): boolean {
  if (extractFileMentions(prompt).length > 0) return true;
  return /[`"'“”«»「」(){}[\]<>=#]|\d|\w+\.\w+|\w+_\w+|[a-z][A-Z]/.test(prompt); // code-ish tokens
}

/** Short enough that, without an anchor, it can't describe a task (works for any script). */
export const VAGUE_MAX_TOKENS = 16;

/** True when the prompt gives Claude nothing concrete to anchor on (no file, symbol, or error). */
export function isVaguePrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return true;
  if (hasConcreteAnchor(text)) return false;
  return VAGUE_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Token-burn prediction: unscoped repo-wide asks and oversized pastes.
// ---------------------------------------------------------------------------
const BROAD_SCOPE_PATTERNS: RegExp[] = [
  /\b(?:entire|whole|full)\s+(?:code ?base|repo(?:sitory)?|project|app|source(?: code)?)\b/i,
  /\b(?:all|every)\s+(?:the\s+)?(?:files?|modules?|components?|source files?|packages?)\b/i,
  /\b(?:review|audit|refactor|read|scan|analy[sz]e|go through|document|summari[sz]e|clean ?up|rewrite|optimi[sz]e)\s+(?:the\s+|this\s+|my\s+)?(?:code ?base|repo(?:sitory)?|project)\b/i,
  /(?:toàn bộ|tất cả|hết|cả)\s+(?:các\s+)?(?:file|code|dự án|project|repo|codebase|source|mã nguồn|module)/iu,
  /(?:đọc|quét|review|refactor|rà soát|kiểm tra|tối ưu|viết lại)\s+(?:hết|toàn bộ|cả)(?=\s|$)/iu,
  /(?:todo el|toda la|todo o|toda a)\s+(?:c[oó]digo|proyecto|projeto|repositorio|reposit[oó]rio)|todos (?:los archivos|os arquivos)/iu,
  /(?:tout le|l'ensemble du)\s+(?:code|projet|dépôt|repo)|tous les fichiers/iu,
  /(?:die ganze|das ganze|gesamte[nrs]?|alle)\s+(?:codebasis|code|projekt|repo(?:sitory)?|dateien)/iu,
  /(?:весь|всю|все|всё)\s+(?:код|проект|репозиторий|файлы)/iu,
  /(?:seluruh|semua)\s+(?:kode|file|proyek|project|repo)/iu,
  /(?:整个|全部|所有)(?:的)?(?:代码|项目|仓库|文件|代码库)/u,
  /(?:全体の|全部の|すべての|全ての)(?:コード|ファイル|プロジェクト|リポジトリ)|(?:コード|プロジェクト|リポジトリ)全体/u,
  /(?:전체|모든)\s*(?:코드|파일|프로젝트|저장소)/u,
  /(?:โค้ดทั้งหมด|ทุกไฟล์|ทั้งโปรเจกต์)/u,
  /(?:पूरा|सारा|सभी)\s+(?:कोड|प्रोजेक्ट|फ़ाइलें|फाइलें)/u,
];

/** Tracked-file count from which an unscoped repo-wide ask is worth stopping. */
export const BROAD_SCOPE_MIN_FILES = { strict: 50, balanced: 150 } as const;
/** Rough tokens Claude spends per file when it walks a repo (read + reasoning). */
export const TOKENS_PER_FILE_READ = 800;

/** Returns the matched phrase when the prompt asks for repo-wide work, else undefined. */
export function detectBroadScope(prompt: string): string | undefined {
  for (const re of BROAD_SCOPE_PATTERNS) {
    const m = prompt.match(re);
    if (m) return m[0].trim();
  }
  return undefined;
}

/** True when the prompt narrows itself to a file or a folder that exists in the repo. */
export function isScoped(prompt: string, workspaceFiles: string[]): boolean {
  if (extractFileMentions(prompt).length) return true;
  const dirs = new Set<string>();
  for (const f of workspaceFiles) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/").toLowerCase());
  }
  const tokens = prompt.toLowerCase().match(/@?[\w.-]+(?:\/[\w.-]+)*\/?/g) ?? [];
  return tokens.some((t) => {
    const p = t.replace(/^@/, "").replace(/\/$/, "");
    return (p.includes("/") || t.endsWith("/") || t.startsWith("@")) && dirs.has(p);
  });
}

/** Pasted text (tokens) above which the paste is re-read so often it should live in a file. */
export const PASTE_MAX_TOKENS = { strict: 3_000, balanced: 8_000 } as const;

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
