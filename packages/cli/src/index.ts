// `bouncer` CLI entry: init, config, rescue, stats, mode, hook, reset, uninstall.
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  BouncerEngine,
  BYOKClassifier,
  PRESETS,
  buildIntelligenceProfile,
  isPresetName,
  loadConfig,
  loadSession,
  loadStats,
  paths,
  providerFromPreset,
  resetState,
  saveConfig,
  withDeadline,
  type BouncerConfig,
  type BouncerMode,
  type PresetName,
  type ProviderConfig,
} from "@bouncer/core";
import {
  ClaudeCodeAdapter,
  claudeHome,
  findLatestTranscript,
  installClaudeCode,
  isInstalled,
  uninstallClaudeCode,
  type ClaudeHookPayload,
} from "./adapters/claude-code.js";
import { CODEX_SUPPORTED } from "./adapters/codex-stub.js";
import { c, renderAll, renderBadgeLine, renderFooter, renderStats, renderUpgradeHint, UNLOCK_GOLD_URL } from "./stats-ui.js";

const VERSION = "0.1.0";
const MODES: BouncerMode[] = ["strict", "balanced", "yolo"];

const USAGE = `${c.bold("bouncer")} — the token door-guy for Claude Code

Usage:
  bouncer init [--target claude|codex]      Install hooks, bouncer-scout agent and /bouncer command
  bouncer config --preset <name> [--key K]  One-command AI setup (groq-gold | gemini-gold | cloudflare-gold | ollama-coder)
                 [--account-id ID]          (cloudflare-gold only; or CLOUDFLARE_ACCOUNT_ID)
  bouncer config --url U --model M [--key K] [--name N]   Custom OpenAI-compatible provider
  bouncer config --show | --clear | --timeout <ms> | --footer on|off
  bouncer all                               Status, every command and setup links
  bouncer rescue [--transcript <path>] [--cwd <dir>] [--print]
  bouncer stats [--json]
  bouncer mode [strict|balanced|yolo]
  bouncer reset                             Clear stats and cache (keeps config)
  bouncer uninstall                         Remove Bouncer hooks, agent and command
  bouncer hook <user-prompt-submit|stop>    (internal) Claude Code hook entrypoint
`;

function fail(message: string): never {
  process.stderr.write(`${c.red("✖")} ${message}\n`);
  process.exit(1);
}

function scriptPath(): string {
  const p = process.argv[1] ?? "";
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function maskKey(key?: string): string {
  if (!key) return "(none)";
  return key.length <= 8 ? "****" : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------
function readStdin(timeoutMs = 5000): Promise<string> {
  return new Promise((resolveText) => {
    if (process.stdin.isTTY) return resolveText("");
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => resolveText(Buffer.concat(chunks).toString("utf8")), timeoutMs);
    process.stdin.on("data", (d: Buffer) => chunks.push(d));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolveText(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolveText("");
    });
  });
}

function emitAndExit(out: { exitCode: number; stdout?: string; stderr?: string }): never {
  if (out.stdout) process.stdout.write(out.stdout + "\n");
  if (out.stderr) process.stderr.write(out.stderr);
  // Let the process end on its own: calling process.exit() while an aborted fetch is still closing its
  // socket trips a libuv assertion on Windows (exit 127). The unref'd timer only fires if some handle
  // keeps the loop alive, so a lingering keep-alive socket can never hold up the user's prompt for long.
  process.exitCode = out.exitCode;
  setTimeout(() => process.exit(out.exitCode), 1500).unref();
  throw new Error("unreachable");
}

async function cmdHook(event: string | undefined): Promise<void> {
  const adapter = new ClaudeCodeAdapter();
  try {
    const raw = await readStdin();
    const payload = (raw.trim() ? JSON.parse(raw) : {}) as ClaudeHookPayload;
    const input = adapter.parseInput(payload);
    const engine = new BouncerEngine();
    if (event === "stop") {
      if (payload.stop_hook_active) emitAndExit({ exitCode: 0 });
      const outcome = await engine.handleStop({ ...input, hookEvent: "Stop" });
      if (outcome.rescue || !engine.config.footerEnabled) emitAndExit(adapter.renderStop(outcome.rescue));
      // After-answer footer: what Bouncer saved, plus a setup link when no AI is connected.
      const footer = renderFooter(loadStats(), loadSession(input.sessionId), engine.intelligence);
      emitAndExit({ exitCode: 0, stdout: JSON.stringify({ systemMessage: footer }) });
    }
    if (event !== "user-prompt-submit") emitAndExit({ exitCode: 0 });
    const result = await engine.evaluate(input);
    emitAndExit(adapter.render(result));
  } catch (error) {
    if (error instanceof Error && error.message === "unreachable") return;
    // Fail open: a Bouncer bug must never block the user's prompt.
    emitAndExit({ exitCode: 0 });
  }
}

// ---------------------------------------------------------------------------
// init / uninstall
// ---------------------------------------------------------------------------
function cmdInit(target: string): void {
  if (target === "codex") {
    if (!CODEX_SUPPORTED) {
      console.log(`${c.yellow("⚠")} Codex CLI support is a skeleton (packages/cli/src/adapters/codex-stub.ts). Nothing was installed.`);
      return;
    }
  }
  if (target !== "claude") fail(`Unknown --target '${target}'. Use claude or codex.`);

  let result;
  try {
    result = installClaudeCode(process.execPath, scriptPath());
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const config = loadConfig();
  if (!existsSync(paths.config())) saveConfig(config);
  const profile = buildIntelligenceProfile(config.provider);

  console.log(`
${c.green("✔")} Bouncer is on the door.
  ${c.dim("hooks     ")} UserPromptSubmit + Stop → ${result.settingsPath}${result.backupPath ? c.dim(`  (backup: ${result.backupPath})`) : ""}
  ${c.dim("agent     ")} bouncer-scout (Haiku) → ${result.agentPath}
  ${c.dim("command   ")} /bouncer → ${result.commandPath}
  ${c.dim("mode      ")} ${config.mode}

  Intelligence: ${renderBadgeLine(profile)}
${renderUpgradeHint(profile)?.split("\n").map((l) => `  ${l}`).join("\n") ?? ""}

  Restart Claude Code (or open a new session) to activate the hooks.
`);
}

function cmdUninstall(): void {
  let removed = 0;
  try {
    removed = uninstallClaudeCode().removed;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  for (const p of [join(claudeHome(), "agents", "bouncer-scout.md"), join(claudeHome(), "commands", "bouncer.md")]) {
    rmSync(p, { force: true });
  }
  console.log(`${c.green("✔")} Removed ${removed} Bouncer hook entr${removed === 1 ? "y" : "ies"}, the bouncer-scout agent and /bouncer. ~/.bouncer state was kept.`);
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
const PRESET_KEY_ENV: Record<PresetName, string[]> = {
  "groq-gold": ["GROQ_API_KEY"],
  "gemini-gold": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  "ollama-coder": [],
  "cloudflare-gold": ["CLOUDFLARE_API_TOKEN"],
};

async function testProvider(provider: ProviderConfig, budgetMs: number): Promise<void> {
  process.stdout.write(c.dim(`  Testing ${provider.providerName} (${provider.model})… `));
  const started = Date.now();
  const r = await withDeadline(
    (signal) =>
      new BYOKClassifier(provider).classify(
        { prompt: "Fix the typo in README.md", modifiedFiles: [], workspaceFiles: ["README.md", "src/index.ts"] },
        signal,
      ),
    10_000,
  );
  const ms = Date.now() - started;
  if (r.value) {
    console.log(`${c.green("ok")} ${c.dim(`(${ms}ms → ${r.value.complexity}, confidence ${r.value.confidence})`)}`);
    if (ms > budgetMs) console.log(`  ${c.yellow("⚠")} Slower than the ${budgetMs}ms hot-path budget: prompts will often fall back to LEVEL 1 (raise it with --timeout).`);
  } else {
    const why = r.timedOut ? "timed out" : r.error instanceof Error ? r.error.message : String(r.error);
    console.log(`${c.red("failed")} ${c.dim(`(${why})`)}`);
    console.log(`  ${c.dim("Config was saved anyway. Bouncer fails open to LEVEL 1 until the provider responds.")}`);
  }
}

async function cmdConfig(values: Record<string, string | boolean | undefined>): Promise<void> {
  const config: BouncerConfig = loadConfig();

  if (values.clear) {
    delete config.provider;
    saveConfig(config);
    console.log(`${c.green("✔")} AI provider removed. Now ${renderBadgeLine(buildIntelligenceProfile())}`);
    return;
  }

  let changed = false;
  if (typeof values.timeout === "string") {
    const ms = Number(values.timeout);
    if (!Number.isInteger(ms) || ms < 200 || ms > 10_000) fail("--timeout must be an integer between 200 and 10000 (ms).");
    config.aiTimeoutMs = ms;
    changed = true;
  }

  if (typeof values.footer === "string") {
    if (values.footer !== "on" && values.footer !== "off") fail("--footer must be 'on' or 'off'.");
    config.footerEnabled = values.footer === "on";
    changed = true;
  }

  const key = typeof values.key === "string" ? values.key : undefined;
  const model = typeof values.model === "string" ? values.model : undefined;

  if (typeof values.preset === "string") {
    const preset = values.preset;
    if (!isPresetName(preset)) fail(`Unknown preset '${preset}'. Choose: ${Object.keys(PRESETS).join(", ")}.`);
    const envKey = PRESET_KEY_ENV[preset].map((k) => process.env[k]).find(Boolean);
    const apiKey = key ?? envKey;
    if (PRESETS[preset].requiresKey && !apiKey) {
      fail(`Preset '${preset}' needs an API key: --key <KEY> or set ${PRESET_KEY_ENV[preset].join(" / ")}.\n  Guide: ${UNLOCK_GOLD_URL}`);
    }
    const accountId = typeof values["account-id"] === "string" ? values["account-id"] : process.env.CLOUDFLARE_ACCOUNT_ID;
    if (PRESETS[preset].requiresAccountId && !accountId) {
      fail(`Preset '${preset}' needs your account ID: --account-id <ID> or set CLOUDFLARE_ACCOUNT_ID.\n  Guide: ${UNLOCK_GOLD_URL}`);
    }
    try {
      config.provider = providerFromPreset(preset, { apiKey, model, accountId });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    changed = true;
  } else if (typeof values.url === "string") {
    if (!model) fail("--url requires --model.");
    config.provider = {
      providerName: typeof values.name === "string" ? values.name : "Custom",
      baseUrl: values.url,
      model,
      apiKey: key,
    };
    changed = true;
  } else if (config.provider && (key || model)) {
    if (key) config.provider.apiKey = key;
    if (model) config.provider.model = model;
    changed = true;
  }

  if (changed) saveConfig(config);
  const profile = buildIntelligenceProfile(config.provider);

  console.log(`
  Intelligence  ${renderBadgeLine(profile)}
  Mode          ${config.mode}
  Provider      ${config.provider ? `${config.provider.providerName} · ${config.provider.baseUrl}` : c.dim("(none — offline LEVEL 1)")}
  API key       ${maskKey(config.provider?.apiKey)}
  AI timeout    ${config.aiTimeoutMs}ms
  Footer        ${config.footerEnabled ? "on" : "off"} ${c.dim("(tokens-saved line after each answer)")}
  Bloat limit   ${Math.round(config.contextBloatThresholdTokens / 1000)}k context tokens ${c.dim(`(fallback ${Math.round(config.contextBloatThresholdBytes / 1024)}KB transcript)`)}`);

  if (changed && profile.level === 3) console.log(`\n  ${c.yellow("🥇 LEVEL 3 unlocked!")} Semantic file resolution + AI rescue summaries are on.`);
  if (changed && config.provider && !values["skip-test"]) {
    console.log("");
    await testProvider(config.provider, config.aiTimeoutMs);
  }
  if (!config.provider) console.log(`\n${renderUpgradeHint(profile)?.split("\n").map((l) => `  ${l}`).join("\n")}`);
  console.log("");
}

// ---------------------------------------------------------------------------
// rescue / stats / mode / reset
// ---------------------------------------------------------------------------
async function cmdRescue(values: Record<string, string | boolean | undefined>): Promise<void> {
  const cwd = resolve(typeof values.cwd === "string" ? values.cwd : process.cwd());
  const transcriptPath = typeof values.transcript === "string" ? resolve(values.transcript) : findLatestTranscript(cwd);
  if (!transcriptPath) {
    console.log(`${c.yellow("⚠")} No Claude Code transcript found for ${cwd}; building from git state only. Use --transcript <path> to include prompts.`);
  }
  const pkg = await new BouncerEngine().rescue(cwd, transcriptPath, "manual");
  if (values.print) process.stdout.write(pkg.markdown + "\n");
  console.log(`
${c.green("✔")} Rescue package ready${pkg.executiveSummary ? " (with 🥇 LEVEL 3 summary)" : ""}.
  ${pkg.clipboardCopied ? "📋 Copied to clipboard — paste it into a fresh session or another tool." : c.yellow("Clipboard unavailable.")}
  ${pkg.savedTo ? `💾 Saved to ${pkg.savedTo}` : ""}
  ${c.dim(`${pkg.sessionModifiedFiles.length} files modified this session · branch ${pkg.branch ?? "n/a"}`)}
`);
}

function cmdStats(json: boolean): void {
  const config = loadConfig();
  const stats = loadStats();
  if (json) {
    console.log(JSON.stringify({ config: { ...config, provider: config.provider && { ...config.provider, apiKey: maskKey(config.provider.apiKey) } }, stats }, null, 2));
    return;
  }
  console.log(renderStats(stats, config, buildIntelligenceProfile(config.provider), isInstalled()));
}

function cmdAll(): void {
  const config = loadConfig();
  console.log(renderAll(loadStats(), config, buildIntelligenceProfile(config.provider), isInstalled()));
}

function cmdMode(mode: string | undefined): void {
  const config = loadConfig();
  if (!mode) {
    console.log(`Current mode: ${c.bold(config.mode)}  ${c.dim(`(options: ${MODES.join(" | ")})`)}`);
    return;
  }
  if (!MODES.includes(mode as BouncerMode)) fail(`Unknown mode '${mode}'. Use ${MODES.join(" | ")}.`);
  config.mode = mode as BouncerMode;
  saveConfig(config);
  const blurb: Record<BouncerMode, string> = {
    strict: "blocks vague prompts and Opus on any non-complex task",
    balanced: "blocks Opus only on trivial tasks; vague prompts pass",
    yolo: "advisory only — blocks nothing except leaked secrets",
  };
  console.log(`${c.green("✔")} Mode set to ${c.bold(mode)} — ${blurb[mode as BouncerMode]}.`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        target: { type: "string", default: "claude" },
        preset: { type: "string" },
        key: { type: "string" },
        "account-id": { type: "string" },
        model: { type: "string" },
        url: { type: "string" },
        name: { type: "string" },
        timeout: { type: "string" },
        show: { type: "boolean" },
        clear: { type: "boolean" },
        "skip-test": { type: "boolean" },
        footer: { type: "string" },
        transcript: { type: "string" },
        cwd: { type: "string" },
        print: { type: "boolean" },
        json: { type: "boolean" },
        "bouncer-managed": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    // Hooks must never fail on argument parsing.
    if (argv[0] === "hook") return cmdHook(argv[1]);
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }

  const { values, positionals } = parsed;
  const [command, arg] = positionals;
  if (values.version) return void console.log(VERSION);
  if (values.help) return void console.log(USAGE);
  if (!command) return cmdAll();

  switch (command) {
    case "hook":
      return cmdHook(arg);
    case "init":
      return cmdInit(String(values.target));
    case "uninstall":
      return cmdUninstall();
    case "config":
      return cmdConfig(values);
    case "rescue":
      return cmdRescue(values);
    case "all":
      return cmdAll();
    case "stats":
      return cmdStats(!!values.json);
    case "mode":
      return cmdMode(arg);
    case "reset":
      resetState();
      return void console.log(`${c.green("✔")} Stats and cache cleared. Config kept.`);
    case "help":
      return void console.log(USAGE);
    default:
      fail(`Unknown command '${command}'.\n\n${USAGE}`);
  }
}

void main(process.argv.slice(2));
