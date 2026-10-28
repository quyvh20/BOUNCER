// VIP Evacuation: git-truth session handover when the rate-limit wall (or context bloat) hits.
import { copyToClipboard, type ClipboardWriter } from "./clipboard.js";
import { withDeadline } from "./byok-provider.js";
import { GitContext, normalizeRepoPath } from "./git-context.js";
import { paths, recordRescue, saveMarkdown } from "./storage.js";
import { readTranscript, type TranscriptRead } from "./transcript.js";
import type { Classifier, RescuePackage } from "./types.js";

export interface RescueEngineOptions {
  git?: GitContext;
  /** Only used when its profile is LEVEL 3 (Gold). */
  classifier?: Classifier | null;
  clipboard?: ClipboardWriter;
  clipboardEnabled?: boolean;
  /** Write ~/.bouncer/last-rescue.md and bump stats. Default true. */
  persist?: boolean;
  summaryTimeoutMs?: number;
}

export interface RescueRequest {
  cwd: string;
  transcriptPath?: string;
  reason?: "manual" | "rate-limit" | "context-bloat";
  /** Prompt that was being submitted when the handover was triggered (context-bloat). */
  pendingPrompt?: string;
}

/** Max total characters of verbatim prompt history before middle prompts are elided. */
const PROMPT_HISTORY_BUDGET = 20_000;

/** Fence a verbatim block with a fence longer than any backtick run inside it. */
export function fence(text: string, lang = "text"): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

function promptHistory(prompts: string[]): string {
  const total = prompts.reduce((n, p) => n + p.length, 0);
  let shown = prompts.map((p, i) => ({ i, p }));
  let elided = 0;
  if (total > PROMPT_HISTORY_BUDGET && prompts.length > 11) {
    elided = prompts.length - 11;
    shown = [shown[0]!, ...shown.slice(-10)];
  }
  const parts = shown.map(({ i, p }) => `**#${i + 1}**\n${fence(p)}`);
  if (elided) parts.splice(1, 0, `_…${elided} earlier prompts omitted for length…_`);
  return parts.join("\n\n");
}

export class RescueEngine {
  private readonly clipboard: ClipboardWriter;

  constructor(private readonly options: RescueEngineOptions = {}) {
    this.clipboard = options.clipboard ?? copyToClipboard;
  }

  /** Detect a rate-limit at the end of a transcript (used by the Stop hook). */
  static detectRateLimit(transcriptPath?: string): boolean {
    return readTranscript(transcriptPath, { tailBytes: 64 * 1024 }).digest.rateLimitHit;
  }

  async build(request: RescueRequest): Promise<RescuePackage> {
    const git = this.options.git ?? new GitContext(request.cwd);
    const transcript = readTranscript(request.transcriptPath);
    const { digest } = transcript;

    const prompts = [...digest.userPrompts];
    if (request.pendingPrompt && prompts[prompts.length - 1] !== request.pendingPrompt) prompts.push(request.pendingPrompt);

    const root = git.root() ?? request.cwd;
    const sessionModifiedFiles = [...new Set(digest.modifiedFiles.map((f) => normalizeRepoPath(f, root)))];
    const isRepo = git.isRepo();
    const pkg: RescuePackage = {
      markdown: "",
      initialGoal: prompts[0],
      interruptedTask: prompts[prompts.length - 1],
      sessionModifiedFiles,
      gitStatusShort: isRepo ? git.statusShort() : "",
      gitDiffStat: isRepo ? git.diffStat() : "",
      branch: isRepo ? git.branch() : undefined,
      rateLimitDetected: digest.rateLimitHit,
      clipboardCopied: false,
    };

    pkg.executiveSummary = await this.goldSummary(transcript, request.reason);
    pkg.markdown = this.render(pkg, request, prompts);

    if (this.options.clipboardEnabled !== false) pkg.clipboardCopied = await this.clipboard(pkg.markdown);
    if (this.options.persist !== false) {
      pkg.savedTo = saveMarkdown(request.reason === "context-bloat" ? paths.lastHandover() : paths.lastRescue(), pkg.markdown);
      if (request.reason !== "context-bloat") recordRescue();
    }
    return pkg;
  }

  /** LEVEL 3 only: 3-bullet AI synthesis. Any failure simply omits the section. */
  private async goldSummary(transcript: TranscriptRead, reason: RescueRequest["reason"]): Promise<string[] | undefined> {
    const c = this.options.classifier;
    if (!c || c.profile.level !== 3 || !c.summarizeProgress || reason === "context-bloat") return undefined;
    if (transcript.turns.length === 0) return undefined;
    const r = await withDeadline((signal) => c.summarizeProgress!(transcript.turns, signal), this.options.summaryTimeoutMs ?? 8000);
    return r.value && r.value.length > 0 ? r.value : undefined;
  }

  private render(pkg: RescuePackage, request: RescueRequest, prompts: string[]): string {
    const title =
      request.reason === "context-bloat" ? "🧹 BOUNCER HANDOVER — Fresh-Context Restart" : "🚨 BOUNCER RESCUE — Session Handover";
    const why =
      request.reason === "rate-limit" || pkg.rateLimitDetected
        ? "rate limit hit"
        : request.reason === "context-bloat"
          ? "context bloat (run /clear, then paste this)"
          : "manual rescue";
    const out: string[] = [
      `# ${title}`,
      "",
      `> Generated ${new Date().toISOString()} · Reason: ${why}`,
      "> Paste this into a fresh session (new account, `/clear`ed session, Codex, Cursor…) to continue exactly where you left off.",
      "",
      "## 📍 Workspace",
      `- **cwd:** \`${request.cwd}\``,
      `- **branch:** \`${pkg.branch ?? "(not a git repo)"}\``,
      "",
      "## 🎯 Initial Goal (verbatim)",
      pkg.initialGoal ? fence(pkg.initialGoal) : "_No user prompt found in the transcript._",
      "",
      "## ⏸️ Interrupted Task (verbatim)",
      pkg.interruptedTask ? fence(pkg.interruptedTask) : "_No user prompt found in the transcript._",
      "",
      "## 📝 Files Modified This Session",
      pkg.sessionModifiedFiles.length ? pkg.sessionModifiedFiles.map((f) => `- \`${f}\``).join("\n") : "_None recorded._",
      "",
      "## 🧾 `git status --short`",
      fence(pkg.gitStatusShort || "(clean)"),
      "",
      "## 📊 `git diff --stat`",
      fence(pkg.gitDiffStat || "(no diff)"),
    ];

    if (prompts.length > 2) {
      out.push("", "## 💬 Full Prompt History (verbatim)", promptHistory(prompts));
    }

    if (pkg.executiveSummary) {
      out.push(
        "",
        "## 🧠 Executive Progress Summary (🥇 LEVEL 3 AI synthesis)",
        "> AI-generated. The verbatim sections and git output above are the source of truth.",
        ...pkg.executiveSummary.map((b) => `- ${b}`),
      );
    }

    out.push(
      "",
      "## ▶️ Instructions for the Next Agent",
      "1. Run `git status` and `git diff` to inspect the real current state before changing anything.",
      "2. Do NOT redo work that the diff shows is already done.",
      "3. Continue the **Interrupted Task** above, keeping the **Initial Goal** in mind.",
      "",
    );
    return out.join("\n");
  }
}
