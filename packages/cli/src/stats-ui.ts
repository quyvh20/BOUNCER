// ANSI dashboard for `bouncer stats`.
import { CHEAP_SWITCH_CONTEXT, type AbBucket, type AbGroup, type BlockCategory, type ContextBand, type BouncerConfig, type BouncerStats, type IntelligenceProfile, type LastPromptInfo, type SessionStats, type TaskComplexity } from "@bouncer/core";

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
  faq: `${DOCS_URL}/guide/faq`,
  install: `${DOCS_URL}/guide/installation`,
};

/** OSC 8 terminal hyperlink: clickable where supported, plain text elsewhere. */
export function link(text: string, url: string): string {
  return "\u001b]8;;" + url + "\u001b\\" + text + "\u001b]8;;\u001b\\";
}

const CATEGORY_LABEL: Record<BlockCategory, string> = {
  "model-overkill": "🛑 Opus overkill",
  "context-bloat": "🧹 Context bloat",
  "vague-prompt": "🤨 Vague prompt",
  "contraband-secret": "🔑 Secret blocked",
  "contraband-log": "📜 Log dump blocked",
  "broad-scope": "💸 Unscoped repo-wide",
  "oversized-paste": "📦 Oversized paste",
  "eco-clear": "🌱 Eco fresh start",
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
    `  Tokens saved  ${c.green(c.bold(`~${fmt(stats.tokensSavedEstimate)}`))}  ${c.dim("(estimate; measured numbers below)")}`,
  ];

  const cats = Object.entries(stats.blocksByCategory) as [BlockCategory, number][];
  if (cats.length) {
    const max = Math.max(...cats.map(([, n]) => n));
    out.push("", c.bold("  Blocks by category"));
    for (const [cat, n] of cats.sort((a, b) => b[1] - a[1])) {
      out.push(`  ${CATEGORY_LABEL[cat].padEnd(22)} ${bar(n, max)} ${fmt(n)}`);
    }
  }

  out.push("", ...renderEco(stats, config));
  out.push("", ...renderAb(stats, config));

  const hint = renderUpgradeHint(profile);
  if (hint) out.push("", ...hint.split("\n").map((l) => `  ${l}`));
  if (stats.firstSeenAt) out.push("", c.dim(`  Tracking since ${stats.firstSeenAt.slice(0, 10)} · estimates are heuristics, not billing data`));
  out.push("");
  return out.join("\n");
}

const SHORT_LEVEL = { 1: "🥉 L1", 2: "🥈 L2", 3: "🥇 L3" } as const;

/** Turns per A/B group before a difference is worth reading. */
export const AB_MIN_TURNS = 10;

export interface AbResult {
  complexity: TaskComplexity;
  /** Turns compared (only bands where both groups have turns). */
  treatmentTurns: number;
  controlTurns: number;
  /** Average cost per turn in whole-context re-reads (lower = cheaper). */
  treatmentRel: number;
  controlRel: number;
  /** Per-turn averages, for context. */
  treatmentCalls: number;
  controlCalls: number;
  treatmentOutput: number;
  controlOutput: number;
  /** Positive = Bouncer's guidance made turns cheaper. Averaged over context bands, weighted by matched turns. */
  savedPct: number;
  enough: boolean;
}

const BANDS: ContextBand[] = ["small", "medium", "large"];

/**
 * Compare A/B groups per task size. A turn's cost is mostly the session's size (every call re-reads the
 * whole context), so turns are only compared within the same context band, and cost is measured in
 * whole-context re-reads rather than raw tokens.
 */
export function abResults(stats: BouncerStats): AbResult[] {
  const out: AbResult[] = [];
  for (const complexity of ["TRIVIAL", "STANDARD", "COMPLEX"] as TaskComplexity[]) {
    const bands = stats.abFair?.[complexity];
    if (!bands) continue;
    let weight = 0, weightedPct = 0;
    const t = { turns: 0, rel: 0, calls: 0, output: 0 };
    const k = { turns: 0, rel: 0, calls: 0, output: 0 };
    for (const band of BANDS) {
      const tr = bands[band]?.treatment;
      const co = bands[band]?.control;
      if (!tr?.turns || !co?.turns) continue;
      const tRel = tr.relCost / tr.turns;
      const cRel = co.relCost / co.turns;
      const w = Math.min(tr.turns, co.turns);
      if (cRel > 0) {
        weight += w;
        weightedPct += w * ((cRel - tRel) / cRel) * 100;
      }
      for (const [acc, b] of [[t, tr], [k, co]] as const) {
        acc.turns += b.turns;
        acc.rel += b.relCost;
        acc.calls += b.calls ?? 0;
        acc.output += b.output;
      }
    }
    if (!t.turns || !k.turns) continue;
    out.push({
      complexity,
      treatmentTurns: t.turns,
      controlTurns: k.turns,
      treatmentRel: t.rel / t.turns,
      controlRel: k.rel / k.turns,
      treatmentCalls: t.calls / t.turns,
      controlCalls: k.calls / k.turns,
      treatmentOutput: t.output / t.turns,
      controlOutput: k.output / k.turns,
      savedPct: weight ? weightedPct / weight : 0,
      enough: t.turns >= AB_MIN_TURNS && k.turns >= AB_MIN_TURNS,
    });
  }
  return out;
}

/** Measured effect of eco mode: average context size at prompt time, eco off vs on. */
function renderEco(stats: BouncerStats, config: BouncerConfig): string[] {
  const on = config.ecoContextTokens;
  const out = [c.bold(`  Eco mode ${on ? c.green(`· on, fresh start for new tasks above ${compactTokens(on)} context`) : c.dim("· off — run `bouncer eco on`")}`)];
  const avg = (k: "off" | "on") => {
    const b = stats.contextAtPrompt?.[k];
    return b && b.n ? b.sum / b.n : undefined;
  };
  const off = avg("off");
  const eco = avg("on");
  if (off === undefined && eco === undefined) {
    out.push(c.dim("  No context measured yet."));
    return out;
  }
  const n = (k: "off" | "on") => stats.contextAtPrompt?.[k]?.n ?? 0;
  out.push(`  Avg context per prompt  ${off !== undefined ? `${compactTokens(Math.round(off))} eco off (${n("off")})` : "—"}  ·  ${eco !== undefined ? `${compactTokens(Math.round(eco))} eco on (${n("on")})` : "—"}`);
  if (off !== undefined && eco !== undefined && n("on") >= 10) {
    const pct = ((off - eco) / off) * 100;
    out.push(`  ${pct >= 0 ? c.green(`−${pct.toFixed(0)}% context re-read per call`) : c.red(`+${Math.abs(pct).toFixed(0)}% context`)} ${c.dim("(re-reading context is most of the bill)")}`);
  } else if (eco !== undefined) {
    out.push(c.dim("  Compare after 10+ prompts with eco on."));
  }
  return out;
}

function renderAb(stats: BouncerStats, config: BouncerConfig): string[] {
  const out = [c.bold(`  Measured savings (A/B) ${config.measure ? c.green("· on") : c.dim("· off — run `bouncer measure on`")}`)];
  const sizes = Object.entries(stats.abFair ?? {}) as [TaskComplexity, Partial<Record<ContextBand, Partial<Record<AbGroup, AbBucket>>>>][];
  if (!sizes.length) {
    out.push(c.dim("  No measured turns yet. Half the prompts get no guidance; both halves are compared at the same context size."));
    return out;
  }
  const results = abResults(stats);
  for (const [size, bands] of sizes) {
    const r = results.find((x) => x.complexity === size);
    if (!r) {
      const count = (g: AbGroup) => BANDS.reduce((n, b) => n + (bands[b]?.[g]?.turns ?? 0), 0);
      out.push(`  ${size.padEnd(9)} ${c.dim(`${count("treatment")} guided / ${count("control")} control turns · waiting for both groups at the same context size`)}`);
      continue;
    }
    const pct = `${r.savedPct >= 0 ? "−" : "+"}${Math.abs(r.savedPct).toFixed(0)}% cost per turn`;
    const verdict = r.enough ? (r.savedPct >= 0 ? c.green(pct) : c.red(pct)) : c.dim(`${pct} (need ${AB_MIN_TURNS}+ per group)`);
    const detail = [
      `${r.treatmentRel.toFixed(1)} vs ${r.controlRel.toFixed(1)} context re-reads`,
      `${r.treatmentCalls.toFixed(1)} vs ${r.controlCalls.toFixed(1)} calls`,
      `${compactTokens(Math.round(r.treatmentOutput))} vs ${compactTokens(Math.round(r.controlOutput))} output`,
      `${r.treatmentTurns} guided / ${r.controlTurns} control turns`,
    ];
    out.push(`  ${size.padEnd(9)} ${verdict} ${c.dim(`· ${detail.join(" · ")}`)}`);
  }
  out.push(c.dim("  Guided vs control, compared only at the same context size (<100k · 100–300k · 300k+)."));
  out.push(c.dim("  Cost = tokens at Anthropic price ratios ÷ context size, so a big session doesn't skew it."));
  return out;
}

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
  idle: "local checks (AI not needed)",
  off: "local rules",
  vip: "VIP ' !' pass",
};

function routeLine(last: LastPromptInfo, profile: IntelligenceProfile): string {
  const claude = !last.platform || last.platform === "claude-code";
  if (last.abGroup === "control") return `A/B control: no guidance sent on this prompt (measuring) · ${SHORT_LEVEL[profile.level]} ${AI_LABEL[last.ai]}`;
  const parts = [
    last.budgetApplied === false
      ? "size unsure → no limits sent (quality first)"
      : claude
        ? `${last.complexity} → ${MODEL_LABEL[last.recommendedModel]}/${last.recommendedEffort}`
        : `${last.complexity} → ${last.recommendedEffort} effort`,
  ];
  if (last.detectedModel && last.detectedModel !== "unknown") parts.push(`you're on ${MODEL_LABEL[last.detectedModel]}`);
  parts.push(`${SHORT_LEVEL[profile.level]} ${AI_LABEL[last.ai]}`);
  if (last.gitFiles) parts.push(`${last.gitFiles} modified file${last.gitFiles > 1 ? "s" : ""} pointed out`);
  return parts.join(" · ");
}

/**
 * Notice after every Claude answer (Stop hook `systemMessage`, so no ANSI colours): what this prompt
 * saved and why, how it was routed, session and all-time totals, plus links.
 */
/** "▓▓▓░░░░░░░" bar for one-line, colour-free messages. */
function textBar(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

/**
 * The few actions that matter right now, most useful first: fresh start when the context is big, fixes
 * for a slow or missing AI, eco when it's off. Commands are /bouncer in Claude Code, bouncer elsewhere.
 */
const TIER_RANK = { fast: 0, balanced: 1, "deep-reasoning": 2 } as const;
const EFFORT_RANK = { low: 0, medium: 1, high: 2 } as const;
const MODEL_CMD = { fast: "/model haiku", balanced: "/model sonnet", "deep-reasoning": "/model opus" } as const;

/**
 * Which model and effort fit the task Bouncer just saw, compared with what the session runs on.
 * Hooks can't switch models, so this is advice. Going up for a complex task is always suggested
 * (quality first); going down only when it pays: the prompt cache is per model, so switching in a
 * big session re-writes the whole context once and can cost more than it saves.
 */
export function modelAdvice(last: LastPromptInfo | undefined): string | undefined {
  if (!last || last.action !== "allow" || last.abGroup === "control" || last.budgetApplied === false) return undefined;
  const want = last.recommendedModel;
  const wantEffort = last.recommendedEffort;
  if (last.platform === "codex") {
    if (!last.detectedEffort || last.detectedEffort === wantEffort) return undefined;
    const up = EFFORT_RANK[wantEffort] > EFFORT_RANK[last.detectedEffort];
    return `${last.complexity.toLowerCase()} task → ${wantEffort} reasoning effort fits (you're on ${last.detectedEffort}): /model to change it${up ? "" : " for tasks like this"}`;
  }
  const on = last.detectedModel && last.detectedModel !== "unknown" ? last.detectedModel : undefined;
  const fits = `${MODEL_LABEL[want]} · effort ${wantEffort}`;
  const cmds = `${MODEL_CMD[want]} · /effort ${wantEffort}`;
  if (on && TIER_RANK[want] > TIER_RANK[on]) return `complex task → ${fits} gives better results (you're on ${MODEL_LABEL[on]}): ${cmds}`;
  const effortHigher = last.detectedEffort && EFFORT_RANK[last.detectedEffort] > EFFORT_RANK[wantEffort];
  if ((on && TIER_RANK[want] < TIER_RANK[on]) || effortHigher) {
    const now = [on ? MODEL_LABEL[on] : undefined, last.detectedEffort ? `effort ${last.detectedEffort}` : undefined].filter(Boolean).join(" · ");
    const head = `${last.complexity.toLowerCase()} task → ${fits} is enough${now ? ` (you're on ${now})` : ""}`;
    return (last.contextTokens ?? 0) < CHEAP_SWITCH_CONTEXT
      ? `${head}: ${cmds}`
      : `${head}: start tasks like this in a new session with ${cmds} (switching here re-caches the big context)`;
  }
  return undefined;
}

function nextActions(last: LastPromptInfo | undefined, profile: IntelligenceProfile, config: BouncerConfig | undefined, cmd: string): string[] {
  const actions: string[] = [];
  const advice = modelAdvice(last);
  if (advice) actions.push(advice);
  const clear = last?.platform === "codex" ? "/new" : "/clear";
  const ctx = last?.contextTokens ?? 0;
  const bigAt = config?.ecoContextTokens ?? (last?.contextWindow ?? 200_000) / 2;
  if (ctx > bigAt) actions.push(`context is big: when this task is done, ${cmd} rescue → ${clear} → paste (new task, small context)`);
  if (last?.ai === "fail-open") actions.push(`AI too slow this time → ${cmd} config --timeout 4000, or pick a faster model (${cmd} docs models)`);
  if (profile.level === 1) actions.push(`free 🥇 AI routing in any language → ${cmd} docs gold (${UNLOCK_GOLD_URL})`);
  if (!config?.ecoContextTokens) actions.push(`biggest saving → ${cmd} eco on`);
  return actions.slice(0, 3);
}

export function renderFooter(stats: BouncerStats, session: SessionStats | undefined, profile: IntelligenceProfile, config?: BouncerConfig): string {
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
  if (last?.contextTokens) {
    const win = last.contextWindow ?? 200_000;
    const eco = config?.ecoContextTokens ? ` · eco: new tasks start fresh above ${compactTokens(config.ecoContextTokens)}` : "";
    rows.push(["context", `${compactTokens(last.contextTokens)} / ${compactTokens(win)} ${textBar(last.contextTokens / win)} ${Math.round((last.contextTokens / win) * 100)}%${eco}`]);
  }
  if (session) rows.push(["session", `−${compactTokens(session.tokensSaved)} over ${session.prompts} prompt${session.prompts === 1 ? "" : "s"}${session.blocks ? ` · ${session.blocks} blocked` : ""}`]);
  rows.push(["total", `−${compactTokens(stats.tokensSavedEstimate)} (estimate)`]);
  if (config) {
    const flags = [`mode ${config.mode}`, `eco ${config.ecoContextTokens ? "on" : "off"}`, `A/B ${config.measure ? "on" : "off"}`, `${SHORT_LEVEL[profile.level]} ${profile.level > 1 ? profile.providerName : "offline"}`];
    rows.push(["status", flags.join(" · ")]);
  }
  // Only Claude Code has the /bouncer slash command; elsewhere point at the terminal CLI.
  const cmd = !last?.platform || last.platform === "claude-code" ? "/bouncer" : "bouncer";
  for (const action of nextActions(last, profile, config, cmd)) rows.push(["next", action]);
  rows.push(["tips", `end a prompt with " !" to skip checks · ${cmd} mode strict|balanced|yolo · ${cmd} config --footer off hides this`]);
  rows.push(["more", `${cmd} stats · ${cmd} all · ${cmd} docs (${DOCS_URL}/)`]);
  return [head, ...rows.map(([k, v], i) => `  ${i === rows.length - 1 ? "└" : "├"} ${k.padEnd(7)} ${v}`)].join("\n");
}

/**
 * Claude Code status line: always visible under the prompt box, never collapsed.
 */
export function renderStatusLine(stats: BouncerStats, session: SessionStats | undefined, profile: IntelligenceProfile): string {
  const sep = c.dim("  ·  ");
  const parts = [`🕶️ Bouncer ${SHORT_LEVEL[profile.level]}${profile.level > 1 ? ` ${profile.providerName}` : " offline"}`];
  const last = session?.last;
  if (last) {
    const what =
      last.action === "block" ? "blocked" : last.budgetApplied === false ? "no limits" : `${last.complexity} → ${MODEL_LABEL[last.recommendedModel]}`;
    parts.push(`last ${what}${session.lastTokensSaved ? ` −${compactTokens(session.lastTokensSaved)}` : ""}`);
  }
  if (session) parts.push(`session −${compactTokens(session.tokensSaved)} / ${session.prompts} prompt${session.prompts === 1 ? "" : "s"}`);
  parts.push(`total −${compactTokens(stats.tokensSavedEstimate)}`);
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
      { cmd: "bouncer init", what: "install hooks, the status line and /bouncer" },
      { cmd: "bouncer init --target codex", what: "install the hooks in OpenAI Codex (~/.codex/hooks.json)" },
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
      { cmd: "bouncer docs [start|install|faq|gold|cloudflare|models|safety]", what: "open a docs page in your browser" },
      { cmd: "bouncer stats [--json]", what: "savings dashboard" },
      { cmd: "bouncer mode strict|balanced|yolo", what: "how hard the bouncer blocks" },
      { cmd: "bouncer opus block|warn", what: "Opus on a small task: stop it, or send it with a reminder" },
      { cmd: "bouncer rescue [--print]", what: "handover for a new session/tool (also automatic on rate limit)" },
    ],
  ],
  [
    "Maintenance",
    [
      { cmd: "bouncer eco on|off [--at 200000]", what: "start new tasks in a fresh session once context is big (biggest saving)" },
      { cmd: "bouncer measure on|off", what: "A/B-test Bouncer on your own usage (real numbers, not estimates)" },
      { cmd: "bouncer reset", what: "clear stats (keeps config)" },
      { cmd: "bouncer uninstall", what: "remove hooks, agent and /bouncer" },
    ],
  ],
];

export function renderAll(stats: BouncerStats, config: BouncerConfig, profile: IntelligenceProfile, installed: boolean, codexInstalled = false): string {
  const ok = (s: string) => `${c.green("✔")} ${s}`;
  const warn = (s: string) => `${c.yellow("⚠")} ${s}`;
  const out: string[] = ["", c.bold("  🕶️  BOUNCER — all commands"), c.dim("  ──────────────────────────────────────────────")];

  out.push(`  ${installed ? ok("Hooks installed in Claude Code") : warn(`Hooks not installed → ${c.bold("bouncer init")}`)}`);
  out.push(`  ${codexInstalled ? ok("Hooks installed in OpenAI Codex (trust them once with /hooks)") : c.dim(`· OpenAI Codex: not installed → bouncer init --target codex`)}`);
  out.push(`  ${profile.level > 1 ? ok(`AI connected: ${renderBadgeLine(profile)}`) : warn(`No AI connected (${renderBadgeLine(profile)})`)}`);
  if (profile.level === 1) out.push(`     ${c.dim("Unlock 🥇 LEVEL 3 for free:")} ${UNLOCK_GOLD_URL}`, `     ${c.dim("Cloudflare guide:")} ${CLOUDFLARE_URL}`);
  out.push(`  ${ok(`Mode ${c.bold(config.mode)} · AI budget ${config.aiTimeoutMs}ms · footer ${config.footerEnabled ? "on" : "off"}`)}`);
  out.push(`  ${config.ecoContextTokens ? ok(`Eco on: new tasks above ${compactTokens(config.ecoContextTokens)} context start fresh`) : c.dim("· Eco off → bouncer eco on (biggest saving: keeps context small)")}`);
  out.push(`  ${ok(`Saved so far: ${c.green(`~${compactTokens(stats.tokensSavedEstimate)} tokens`)} ${c.dim("(estimate)")}`)}`);

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
