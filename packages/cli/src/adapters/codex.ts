// OpenAI Codex adapter: UserPromptSubmit + Stop hooks in ~/.codex/hooks.json.
// Codex's hook contract mirrors Claude Code's (stdin JSON with session_id, transcript_path, cwd, prompt;
// exit 2 + stderr blocks; hookSpecificOutput.additionalContext adds context; systemMessage warns the user),
// so rendering is shared. Differences: Stop must print JSON on exit 0, hooks live in their own file, and
// Codex asks the user to trust new hooks (/hooks) before running them.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentPlatform, BouncerEvaluationInput, HostRenderOutput, RescuePackage } from "@bouncer/core";
import { ClaudeCodeAdapter, MANAGED_FLAG, type ClaudeHookPayload } from "./claude-code.js";

/** Payload Codex writes to a hook's stdin (common fields plus the ones Bouncer reads). */
export interface CodexHookPayload extends ClaudeHookPayload {
  turn_id?: string;
  model?: string;
  last_assistant_message?: string | null;
}

export class CodexAdapter extends ClaudeCodeAdapter {
  override readonly platform: AgentPlatform = "codex";

  override parseInput(raw: CodexHookPayload): BouncerEvaluationInput {
    return { ...super.parseInput(raw), platform: "codex" };
  }

  /** Codex treats plain or empty stdout on a Stop exit 0 as invalid, so always answer with JSON. */
  override renderStop(rescue: RescuePackage | undefined): HostRenderOutput {
    const out = super.renderStop(rescue);
    return out.stdout ? out : { exitCode: 0, stdout: "{}" };
  }
}

export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

const CODEX_EVENTS = { UserPromptSubmit: "user-prompt-submit", Stop: "stop" } as const;

interface CodexHandler {
  type: string;
  command?: string;
  timeout?: number;
  statusMessage?: string;
}
interface CodexMatcher {
  matcher?: string;
  hooks?: CodexHandler[];
}
type CodexHooksFile = { hooks?: Record<string, CodexMatcher[]> } & Record<string, unknown>;

export function codexHookCommand(event: keyof typeof CODEX_EVENTS, nodePath: string, scriptPath: string): string {
  const q = (p: string) => `"${p.replace(/\\/g, "/")}"`;
  return `${q(nodePath)} ${q(scriptPath)} hook ${CODEX_EVENTS[event]} --host codex ${MANAGED_FLAG}`;
}

function isManaged(m: CodexMatcher): boolean {
  return Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === "string" && h.command.includes(MANAGED_FLAG));
}

function readHooksFile(file: string): CodexHooksFile {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as CodexHooksFile;
  } catch {
    /* fall through */
  }
  throw new Error(`${file} is not valid JSON — fix it first; Bouncer will not overwrite it.`);
}

export interface CodexInstallResult {
  hooksPath: string;
  backupPath?: string;
  /** config.toml also defines [hooks]: Codex docs advise one representation per layer. */
  inlineHooksInConfig: boolean;
}

export function installCodex(nodePath: string, scriptPath: string): CodexInstallResult {
  const home = codexHome();
  mkdirSync(home, { recursive: true });
  const hooksPath = join(home, "hooks.json");
  const file = readHooksFile(hooksPath);

  let backupPath: string | undefined;
  const alreadyManaged = Object.values(file.hooks ?? {}).some((ms) => Array.isArray(ms) && ms.some(isManaged));
  if (existsSync(hooksPath) && !alreadyManaged) {
    backupPath = existsSync(`${hooksPath}.bak`) ? `${hooksPath}.${Date.now()}.bak` : `${hooksPath}.bak`;
    copyFileSync(hooksPath, backupPath);
  }

  const hooks = (file.hooks && typeof file.hooks === "object" ? file.hooks : {}) as Record<string, CodexMatcher[]>;
  for (const event of Object.keys(CODEX_EVENTS) as (keyof typeof CODEX_EVENTS)[]) {
    const kept = Array.isArray(hooks[event]) ? hooks[event]!.filter((m) => !isManaged(m)) : [];
    kept.push({
      hooks: [
        {
          type: "command",
          command: codexHookCommand(event, nodePath, scriptPath),
          timeout: 15,
          ...(event === "UserPromptSubmit" ? { statusMessage: "🕶️ Bouncer checking prompt" } : {}),
        },
      ],
    });
    hooks[event] = kept;
  }
  file.hooks = hooks;
  writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n", "utf8");

  const configPath = join(home, "config.toml");
  const inlineHooksInConfig = existsSync(configPath) && /^\s*\[\[?hooks[.\]]/m.test(readFileSync(configPath, "utf8"));
  return { hooksPath, backupPath, inlineHooksInConfig };
}

/** Remove only Bouncer-managed entries from ~/.codex/hooks.json. */
export function uninstallCodex(): { hooksPath: string; removed: number } {
  const hooksPath = join(codexHome(), "hooks.json");
  if (!existsSync(hooksPath)) return { hooksPath, removed: 0 };
  const file = readHooksFile(hooksPath);
  let removed = 0;
  for (const [event, matchers] of Object.entries(file.hooks ?? {})) {
    if (!Array.isArray(matchers)) continue;
    const kept = matchers.filter((m) => !isManaged(m));
    removed += matchers.length - kept.length;
    if (kept.length) file.hooks![event] = kept;
    else delete file.hooks![event];
  }
  if (removed) {
    if (file.hooks && Object.keys(file.hooks).length === 0) delete file.hooks;
    copyFileSync(hooksPath, `${hooksPath}.pre-uninstall.bak`);
    writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n", "utf8");
  }
  return { hooksPath, removed };
}

export function isCodexInstalled(): boolean {
  try {
    const file = readHooksFile(join(codexHome(), "hooks.json"));
    return Object.values(file.hooks ?? {}).some((ms) => Array.isArray(ms) && ms.some(isManaged));
  } catch {
    return false;
  }
}
