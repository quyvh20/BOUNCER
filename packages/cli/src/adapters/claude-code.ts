// Claude Code adapter: UserPromptSubmit + Stop hooks, status line and /bouncer installer.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentPlatform,
  BouncerEvaluationInput,
  BouncerEvaluationResult,
  HostAdapter,
  HostRenderOutput,
  RescuePackage,
} from "@bouncer/core";

/** Payload Claude Code writes to a hook's stdin. */
export interface ClaudeHookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  stop_hook_active?: boolean;
}

export class ClaudeCodeAdapter implements HostAdapter<ClaudeHookPayload> {
  readonly platform: AgentPlatform = "claude-code";

  parseInput(raw: ClaudeHookPayload): BouncerEvaluationInput {
    let transcriptSizeBytes: number | undefined;
    if (raw.transcript_path) {
      try {
        transcriptSizeBytes = statSync(raw.transcript_path).size;
      } catch {
        /* transcript not written yet */
      }
    }
    return {
      platform: this.platform,
      hookEvent: raw.hook_event_name === "Stop" ? "Stop" : "UserPromptSubmit",
      prompt: raw.prompt,
      cwd: raw.cwd || process.cwd(),
      sessionId: raw.session_id,
      transcriptPath: raw.transcript_path,
      transcriptSizeBytes,
    };
  }

  /**
   * allow -> exit 0, directive injected as additionalContext (the prompt itself is untouched, Law 3).
   * block -> exit 2, reason on stderr (Claude Code erases the prompt and shows stderr to the user).
   */
  render(result: BouncerEvaluationResult): HostRenderOutput {
    if (result.action === "block") {
      const lines = [result.reason ?? "Blocked by Bouncer."];
      if (result.suggestedCommand && !lines[0]!.includes(result.suggestedCommand)) lines.push(`👉 ${result.suggestedCommand}`);
      return { exitCode: 2, stderr: lines.join("\n") + "\n" };
    }
    if (!result.systemDirective && !result.userNotice) return { exitCode: 0 };
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        ...(result.userNotice ? { systemMessage: result.userNotice } : {}),
        ...(result.systemDirective
          ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: result.systemDirective } }
          : {}),
      }),
    };
  }

  /** Stop hook never blocks; it only surfaces a message when a rescue was generated. */
  renderStop(rescue: RescuePackage | undefined): HostRenderOutput {
    if (!rescue) return { exitCode: 0 };
    const where = rescue.clipboardCopied ? "copied to your clipboard" : `saved to ${rescue.savedTo ?? "~/.bouncer/last-rescue.md"}`;
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        systemMessage: `🚨 BOUNCER RESCUE: rate limit hit. A full handover (goal, interrupted task, git state) was ${where}. Paste it into a fresh session or another tool to keep going.`,
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

/** Every hook command we write carries this flag so re-installs and uninstalls find their own entries. */
export const MANAGED_FLAG = "--bouncer-managed";

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}
type HooksSection = Record<string, HookMatcher[]>;

const HOOK_EVENTS = { UserPromptSubmit: "user-prompt-submit", Stop: "stop" } as const;

/** Build the shell command Claude Code runs for a hook (absolute node + script path, forward slashes). */
export function hookCommand(event: keyof typeof HOOK_EVENTS, nodePath: string, scriptPath: string): string {
  const q = (p: string) => `"${p.replace(/\\/g, "/")}"`;
  return `${q(nodePath)} ${q(scriptPath)} hook ${HOOK_EVENTS[event]} ${MANAGED_FLAG}`;
}

export function statusLineCommand(nodePath: string, scriptPath: string): string {
  const q = (p: string) => `"${p.replace(/\\/g, "/")}"`;
  return `${q(nodePath)} ${q(scriptPath)} statusline ${MANAGED_FLAG}`;
}

function isManagedStatusLine(value: unknown): boolean {
  const cmd = (value as { command?: unknown } | undefined)?.command;
  return typeof cmd === "string" && cmd.includes(MANAGED_FLAG);
}

function isManaged(m: HookMatcher): boolean {
  return Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === "string" && h.command.includes(MANAGED_FLAG));
}

function readSettings(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new Error(`${file} is not valid JSON — fix it first; Bouncer will not overwrite it.`);
}

export interface InstallResult {
  settingsPath: string;
  backupPath?: string;
  /** An old bouncer-scout subagent file was found and removed. */
  removedLegacyScout: boolean;
  commandPath: string;
  /** False when the user already has their own status line, which is left alone. */
  statusLineInstalled: boolean;
}

export function installClaudeCode(nodePath: string, scriptPath: string): InstallResult {
  const home = claudeHome();
  mkdirSync(home, { recursive: true });
  const settingsPath = join(home, "settings.json");
  const settings = readSettings(settingsPath);

  // Back up the pristine settings once; a re-install must not overwrite it with an already-hooked copy.
  let backupPath: string | undefined;
  if (existsSync(settingsPath)) {
    backupPath = `${settingsPath}.bak`;
    if (existsSync(backupPath) && isManagedSettings(settings)) {
      backupPath = undefined;
    } else {
      if (existsSync(backupPath)) backupPath = `${settingsPath}.${Date.now()}.bak`;
      copyFileSync(settingsPath, backupPath);
    }
  }

  const hooks = (settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}) as HooksSection;
  for (const event of Object.keys(HOOK_EVENTS) as (keyof typeof HOOK_EVENTS)[]) {
    const existing = Array.isArray(hooks[event]) ? hooks[event]!.filter((m) => !isManaged(m)) : [];
    existing.push({ hooks: [{ type: "command", command: hookCommand(event, nodePath, scriptPath), timeout: 10 }] });
    hooks[event] = existing;
  }
  settings.hooks = hooks;
  // Always-visible savings line under the prompt box. Never replace a status line the user set up.
  const statusLineInstalled = !settings.statusLine || isManagedStatusLine(settings.statusLine);
  if (statusLineInstalled) settings.statusLine = { type: "command", command: statusLineCommand(nodePath, scriptPath), padding: 0 };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");

  // Older versions installed a Haiku "bouncer-scout" subagent; Claude Code's built-in Explore subagent
  // does that job now, so remove ours.
  const legacyScout = join(home, "agents", "bouncer-scout.md");
  const removedLegacyScout = existsSync(legacyScout);
  if (removedLegacyScout) rmSync(legacyScout, { force: true });

  const commandPath = join(home, "commands", "bouncer.md");
  mkdirSync(join(home, "commands"), { recursive: true });
  writeFileSync(commandPath, slashCommand(nodePath, scriptPath), "utf8");

  return { settingsPath, backupPath, commandPath, statusLineInstalled, removedLegacyScout };
}

/** Remove only Bouncer-managed hook entries; agent/command files are left for the caller to delete. */
export function uninstallClaudeCode(): { settingsPath: string; removed: number } {
  const settingsPath = join(claudeHome(), "settings.json");
  const settings = readSettings(settingsPath);
  const hooks = settings.hooks as HooksSection | undefined;
  let removed = 0;
  if (hooks && typeof hooks === "object") {
    for (const [event, matchers] of Object.entries(hooks)) {
      if (!Array.isArray(matchers)) continue;
      const kept = matchers.filter((m) => !isManaged(m));
      removed += matchers.length - kept.length;
      if (kept.length) hooks[event] = kept;
      else delete hooks[event];
    }
    if (Object.keys(hooks).length === 0) delete settings.hooks;
  }
  if (isManagedStatusLine(settings.statusLine)) {
    delete settings.statusLine;
    removed += 1;
  }
  if (removed) {
    copyFileSync(settingsPath, `${settingsPath}.pre-uninstall.bak`);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }
  return { settingsPath, removed };
}

function isManagedSettings(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks as HooksSection | undefined;
  return !!hooks && typeof hooks === "object" && Object.values(hooks).some((ms) => Array.isArray(ms) && ms.some(isManaged));
}

export function isInstalled(): boolean {
  try {
    return isManagedSettings(readSettings(join(claudeHome(), "settings.json")));
  } catch {
    return false;
  }
}

/**
 * Most recent transcript for a working directory.
 * Claude Code stores sessions in ~/.claude/projects/<cwd with non-alphanumerics replaced by '-'>/<id>.jsonl.
 */
export function findLatestTranscript(cwd: string): string | undefined {
  const dir = join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  if (!existsSync(dir)) return undefined;
  let best: { path: string; mtime: number } | undefined;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    const mtime = statSync(path).mtimeMs;
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best?.path;
}

function slashCommand(nodePath: string, scriptPath: string): string {
  const cmd = `"${nodePath.replace(/\\/g, "/")}" "${scriptPath.replace(/\\/g, "/")}"`;
  return `---
description: Bouncer — all commands, stats, mode (strict|balanced|yolo), rescue, config
argument-hint: "[all | docs [gold|models|cloudflare] | stats | mode <strict|balanced|yolo> | rescue | config --show]"
allowed-tools: Bash(${cmd}:*)
---

Run this command and show its output to the user verbatim, without commentary:

!\`${cmd} $ARGUMENTS\`
`;
}
