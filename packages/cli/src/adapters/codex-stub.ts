// Ready-to-extend adapter skeleton for the OpenAI Codex CLI.
// Codex does not expose a prompt-submit hook equivalent to Claude Code's yet; this adapter maps a
// generic JSON payload so a wrapper script (or a future Codex hook) can drive the same core engine.
import type { BouncerEvaluationInput, BouncerEvaluationResult, HostAdapter, HostRenderOutput } from "@bouncer/core";

export interface CodexPayload {
  prompt?: string;
  cwd?: string;
  session_id?: string;
  /** Codex rollout file (JSONL). Model detection is Claude-specific today, so this is informational only. */
  rollout_path?: string;
}

export class CodexAdapter implements HostAdapter<CodexPayload> {
  readonly platform = "codex" as const;

  parseInput(raw: CodexPayload): BouncerEvaluationInput {
    return {
      platform: this.platform,
      hookEvent: "UserPromptSubmit",
      prompt: raw.prompt,
      cwd: raw.cwd || process.cwd(),
      sessionId: raw.session_id,
    };
  }

  render(result: BouncerEvaluationResult): HostRenderOutput {
    if (result.action === "block") return { exitCode: 2, stderr: `${result.reason ?? "Blocked by Bouncer."}\n` };
    // No context-injection channel yet: print the directive so a wrapper can prepend it.
    return { exitCode: 0, stdout: result.systemDirective || undefined };
  }
}

export const CODEX_SUPPORTED = false;
