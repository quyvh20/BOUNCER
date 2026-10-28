// ANSI dashboard for `bouncer stats`.
import type { BlockCategory, BouncerConfig, BouncerStats, IntelligenceProfile } from "@bouncer/core";

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

/** Blended USD per 1M tokens used for ROI. Sonnet input pricing ($3/M) keeps the estimate conservative. */
export const USD_PER_MTOK = 3;

const CATEGORY_LABEL: Record<BlockCategory, string> = {
  "model-overkill": "🛑 Opus overkill",
  "context-bloat": "🧹 Context bloat",
  "vague-prompt": "🤨 Vague prompt",
  "contraband-secret": "🔑 Secret blocked",
  "contraband-log": "📜 Log dump blocked",
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
