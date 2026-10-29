// ANSI dashboard for `bouncer stats`.
import type { BlockCategory, BouncerConfig, BouncerStats, IntelligenceProfile, LastPromptInfo, SessionStats } from "@bouncer/core";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
  magenta: paint("35"),
};

export const DOCS_URL = process.env.BOUNCER_DOCS_URL || "https://quyvh20.github.io/BOUNCER";
export const UNLOCK_GOLD_URL = `${DOCS_URL}/unlock-gold/`;
export const CLOUDFLARE_URL = `${DOCS_URL}/unlock-gold/cloudflare-workers-ai`;
export const MODELS_URL = `${DOCS_URL}/unlock-gold/recommended-models`;
export const GETTING_STARTED_URL = `${DOCS_URL}/guide/getting-started`;

/** Pages `bouncer docs <page>` opens. */
export const DOC_PAGES: Record<string, string> = {
  home: `${DOCS_URL}/`,
  start: GETTING_STARTED_URL,
  gold: UNLOCK_GOLD_URL,
  cloudflare: CLOUDFLARE_URL,
  models: MODELS_URL,
  safety: `${DOCS_URL}/guide/safety-architecture`,
};

/** OSC 8 terminal hyperlink: clickable where supported, plain text elsewhere. */
export function link(text: string, url: string): string {
  return "\u001b]8;;" + url + "\u001b\\" + text + "\u001b]8;;\u001b\\";
}

/** Blended USD per 1M tokens used for ROI. Sonnet input pricing ($3/M) keeps the estimate conservative. */
export const USD_PER_MTOK = 3;

const CATEGORY_LABEL: Record<BlockCategory, string> = {
  "model-overkill": "🛑 Opus overkill",
  "context-bloat": "🧹 Context bloat",
  "vague-prompt": "🤨 Vague prompt",
  "contraband-secret": "🔑 Secret blocked",
  "contraband-log": "📜 Log dump blocked",
  "broad-scope": "💸 Unscoped repo-wide",
  "oversized-paste": "📦 Oversized paste",
};

const fmt = (n: number) => n.toLocaleString("en-US");

function bar(value: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return c.cyan("█".repeat(filled)) + c.dim("░".repeat(width - filled));
}

export function renderBadgeLine(profile: IntelligenceProfile): string {
  const color = profile.level === 3 ? c.yellow : profile.level === 2 ? c.cyan : c.magenta;
  return `${color(c.bold(profile.badge))} ${c.dim(`· ${profile.providerName} · ${profile.modelName}`)}`;
}

export function renderUpgradeHint(profile: IntelligenceProfile): string | undefined {
  if (profile.level === 3) return undefined;
  return `${c.dim("Unlock")} ${c.yellow("🥇 LEVEL 3")} ${c.dim("for free in 30s:")} bouncer config --preset groq-gold --key <GROQ_KEY>\n${c.dim(`Guide: ${UNLOCK_GOLD_URL}`)}`;
}

export function renderStats(stats: BouncerStats, config: BouncerConfig, profile: IntelligenceProfile, installed: boolean): string {
  const usd = (stats.tokensSavedEstimate / 1_000_000) * USD_PER_MTOK;
  const out: string[] = [
    "",
    c.bold("  🕶️  BOUNCER — The Token Door-Guy"),
    c.dim("  ──────────────────────────────────────────────"),
    `  Intelligence  ${renderBadgeLine(profile)}`,
    `  Mode          ${c.bold(config.mode)}${installed ? "" : c.red("   (hooks not installed — run `bouncer init`)")}`,
    "",
    `  Prompts       ${fmt(stats.promptsEvaluated)} evaluated · ${c.green(fmt(stats.promptsAllowed))} allowed · ${c.red(fmt(stats.promptsBlocked))} blocked · ${fmt(stats.vipPasses)} VIP '!'`,
    `  AI router     ${fmt(stats.aiCalls)} calls · ${fmt(stats.aiFailOpens)} fail-opens to LEVEL 1`,
    `  Rescues       ${fmt(stats.rescuesGenerated)} handovers generated`,
    "",
    `  Tokens saved  ${c.green(c.bold(`~${fmt(stats.tokensSavedEstimate)}`))}  ${c.dim(`≈ $${usd.toFixed(2)} at $${USD_PER_MTOK}/M tokens`)}`,
  ];

  const cats = Object.entries(stats.blocksByCategory) as [BlockCategory, number][];
  if (cats.length) {
    const max = Math.max(...cats.map(([, n]) => n));
    out.push("", c.bold("  Blocks by category"));
    for (const [cat, n] of cats.sort((a, b) => b[1] - a[1])) {
      out.push(`  ${CATEGORY_LABEL[cat].padEnd(22)} ${bar(n, max)} ${fmt(n)}`);
    }
  }

  const hint = renderUpgradeHint(profile);
  if (hint) out.push("", ...hint.split("\n").map((l) => `  ${l}`));
  if (stats.firstSeenAt) out.push("", c.dim(`  Tracking since ${stats.firstSeenAt.slice(0, 10)} · estimates are heuristics, not billing data`));
  out.push("");
  return out.join("\n");
}

const SHORT_LEVEL = { 1: "🥉 L1", 2: "🥈 L2", 3: "🥇 L3" } as const;

/** "12.3k" style token counts for one-line messages. */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const MODEL_LABEL = { fast: "Haiku", balanced: "Sonnet", "deep-reasoning": "Opus" } as const;
const AI_LABEL: Record<LastPromptInfo["ai"], string> = {
  ok: "AI ✓",
  "fail-open": "AI too slow → local rules",
  skipped: "AI skipped (already certain)",
  off: "local rules",
  vip: "VIP ' !' pass",
};

function routeLine(last: LastPromptInfo, profile: IntelligenceProfile): string {
  const parts = [
    last.budgetApplied === false
      ? "size unsure → no limits sent (quality first)"
      : `${last.complexity} → ${MODEL_LABEL[last.recommendedModel]}/${last.recommendedEffort}`,
  ];
  if (last.detectedModel && last.detectedModel !== "unknown") parts.push(`you're on ${MODEL_LABEL[last.detectedModel]}`);
  parts.push(`${SHORT_LEVEL[profile.level]} ${AI_LABEL[last.ai]}`);
  if (last.gitFiles) parts.push(`${last.gitFiles} modified file${last.gitFiles > 1 ? "s" : ""} pointed out`);
  if (last.contextTokens) parts.push(`context ${compactTokens(last.contextTokens)}`);
  return parts.join(" · ");
}

/**
 * Notice after every Claude answer (Stop hook `systemMessage`, so no ANSI colours): what this prompt
 * saved and why, how it was routed, session and all-time totals, plus links.
 */
export function renderFooter(stats: BouncerStats, session: SessionStats | undefined, profile: IntelligenceProfile): string {
  const usd = (stats.tokensSavedEstimate / 1_000_000) * USD_PER_MTOK;
  const last = session?.last;
  const saved = session?.lastTokensSaved ?? 0;
  const head = saved > 0
    ? `🕶️ Bouncer saved ~${compactTokens(saved)} tokens on this prompt`
    : last?.complexity === "COMPLEX"
      ? "🕶️ Bouncer: complex task, no limits applied (quality first)"
      : "🕶️ Bouncer: nothing to trim on this prompt";
  const rows: [string, string][] = [];
  if (last?.savings.length) rows.push(["why", last.savings.map((i) => `${i.label} (−${compactTokens(i.tokens)})`).join(" · ")]);
  if (last) rows.push(["route", routeLine(last, profile)]);
  if (session) rows.push(["session", `−${compactTokens(session.tokensSaved)} over ${session.prompts} prompt${session.prompts === 1 ? "" : "s"}${session.blocks ? ` · ${session.blocks} blocked` : ""}`]);
  rows.push(["total", `−${compactTokens(stats.tokensSavedEstimate)} ≈ $${usd.toFixed(2)} (estimate)`]);
  rows.push(
    profile.level === 1
      ? ["unlock", `free 🥇 AI routing → run /bouncer docs gold (opens ${UNLOCK_GOLD_URL})`]
      : ["more", `/bouncer docs opens ${DOCS_URL}/ · /bouncer all · /bouncer stats`],
  );
  return [head, ...rows.map(([k, v], i) => `  ${i === rows.length - 1 ? "└" : "├"} ${k.padEnd(7)} ${v}`)].join("\n");
}

/**
 * Claude Code status line: always visible under the prompt box, never collapsed.
 */
export function renderStatusLine(stats: BouncerStats, session: SessionStats | undefined, profile: IntelligenceProfile): string {
  const usd = (stats.tokensSavedEstimate / 1_000_000) * USD_PER_MTOK;
  const sep = c.dim("  ·  ");
  const parts = [`🕶️ Bouncer ${SHORT_LEVEL[profile.level]}${profile.level > 1 ? ` ${profile.providerName}` : " offline"}`];
  const last = session?.last;
  if (last) {
    const what =
      last.action === "block" ? "blocked" : last.budgetApplied === false ? "no limits" : `${last.complexity} → ${MODEL_LABEL[last.recommendedModel]}`;
    parts.push(`last ${what}${session.lastTokensSaved ? ` −${compactTokens(session.lastTokensSaved)}` : ""}`);
  }
  if (session) parts.push(`session −${compactTokens(session.tokensSaved)} / ${session.prompts} prompt${session.prompts === 1 ? "" : "s"}`);
  parts.push(`total −${compactTokens(stats.tokensSavedEstimate)} ≈ $${usd.toFixed(2)}`);
  if (last?.contextTokens) parts.push(`ctx ${compactTokens(last.contextTokens)}`);
  parts.push(profile.level === 1 ? link("🥇 unlock free AI ↗", UNLOCK_GOLD_URL) : link("📖 docs ↗", `${DOCS_URL}/`));
  return parts.join(sep);
}

interface CommandHelp {
  cmd: string;
  what: string;
}

const COMMAND_GROUPS: [string, CommandHelp[]][] = [
  [
    "Setup",
    [
      { cmd: "bouncer init", what: "install hooks, the bouncer-scout (Haiku) agent and /bouncer" },
      { cmd: "bouncer config --preset cloudflare-gold --account-id <ID>", what: "connect Cloudflare Workers AI (token from CLOUDFLARE_API_TOKEN)" },
      { cmd: "bouncer config --preset groq-gold --key <KEY>", what: "connect Groq (Llama 3.3 70B)" },
      { cmd: "bouncer config --preset gemini-gold --key <KEY>", what: "connect Google AI Studio (Gemini 2.5 Flash)" },
      { cmd: "bouncer config --preset ollama-coder [--model M]", what: "local Ollama, 100% offline" },
      { cmd: "bouncer config --show | --clear", what: "show settings / disconnect the AI" },
      { cmd: "bouncer config --model <M> --timeout <ms>", what: "change model or AI time budget" },
      { cmd: "bouncer config --footer on|off", what: "the savings report after each answer" },
    ],
  ],
  [
    "Daily",
    [
      { cmd: "bouncer all", what: "this overview" },
      { cmd: "bouncer docs [start|gold|cloudflare|models|safety]", what: "open a docs page in your browser" },
      { cmd: "bouncer stats [--json]", what: "savings dashboard" },
      { cmd: "bouncer mode strict|balanced|yolo", what: "how hard the bouncer blocks" },
      { cmd: "bouncer rescue [--print]", what: "handover for a new session/tool (also automatic on rate limit)" },
    ],
  ],
  [
    "Maintenance",
    [
      { cmd: "bouncer reset", what: "clear stats (keeps config)" },
      { cmd: "bouncer uninstall", what: "remove hooks, agent and /bouncer" },
    ],
  ],
];

export function renderAll(stats: BouncerStats, config: BouncerConfig, profile: IntelligenceProfile, installed: boolean): string {
  const ok = (s: string) => `${c.green("✔")} ${s}`;
  const warn = (s: string) => `${c.yellow("⚠")} ${s}`;
  const usd = (stats.tokensSavedEstimate / 1_000_000) * USD_PER_MTOK;
  const out: string[] = ["", c.bold("  🕶️  BOUNCER — all commands"), c.dim("  ──────────────────────────────────────────────")];

  out.push(`  ${installed ? ok("Hooks installed in Claude Code") : warn(`Hooks not installed → ${c.bold("bouncer init")}`)}`);
  out.push(`  ${profile.level > 1 ? ok(`AI connected: ${renderBadgeLine(profile)}`) : warn(`No AI connected (${renderBadgeLine(profile)})`)}`);
  if (profile.level === 1) out.push(`     ${c.dim("Unlock 🥇 LEVEL 3 for free:")} ${UNLOCK_GOLD_URL}`, `     ${c.dim("Cloudflare guide:")} ${CLOUDFLARE_URL}`);
  out.push(`  ${ok(`Mode ${c.bold(config.mode)} · AI budget ${config.aiTimeoutMs}ms · footer ${config.footerEnabled ? "on" : "off"}`)}`);
  out.push(`  ${ok(`Saved so far: ${c.green(`~${compactTokens(stats.tokensSavedEstimate)} tokens`)} ${c.dim(`(≈$${usd.toFixed(2)}, estimate)`)}`)}`);

  const width = Math.max(...COMMAND_GROUPS.flatMap(([, cmds]) => cmds.map((x) => x.cmd.length)));
  for (const [group, cmds] of COMMAND_GROUPS) {
    out.push("", c.bold(`  ${group}`));
    for (const { cmd, what } of cmds) out.push(`    ${c.cyan(cmd.padEnd(width))}  ${c.dim(what)}`);
  }

  out.push(
    "",
    c.bold("  Tips"),
    `    ${c.dim("End a prompt with")} ' !' ${c.dim("to skip every check except the secret filter.")}`,
    `    ${c.dim("Inside Claude Code:")} /bouncer all ${c.dim("·")} /bouncer stats ${c.dim("·")} /bouncer mode strict`,
    "",
    c.bold("  Links"),
    `    ${c.dim("Docs            ")} ${DOCS_URL}/`,
    `    ${c.dim("Getting started ")} ${GETTING_STARTED_URL}`,
    `    ${c.dim("Pick an AI model")} ${MODELS_URL}`,
    `    ${c.dim("Cloudflare setup")} ${CLOUDFLARE_URL}`,
    "",
  );
  return out.join("\n");
}
