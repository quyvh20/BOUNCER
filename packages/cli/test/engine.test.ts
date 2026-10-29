// Automated safety & verification suite (SPEC §7, Phase 5: TC-01 … TC-10).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BouncerEngine,
  applySafetyLaws,
  GitContext,
  RescueEngine,
  buildIntelligenceProfile,
  exitCodeFor,
  detectBroadScope,
  estimateTokens,
  isVaguePrompt,
  detectActiveSession,
  lastTurnUsage,
  loadSession,
  loadStats,
  parseClassifierResponse,
  providerFromPreset,
  type BouncerEngineOptions,
  type Classifier,
  type ClassifierResponse,
  type GitRunner,
  type ProviderConfig,
} from "@bouncer/core";
import { ClaudeCodeAdapter, installClaudeCode, uninstallClaudeCode } from "../src/adapters/claude-code.js";
import { CodexAdapter, installCodex, isCodexInstalled, uninstallCodex } from "../src/adapters/codex.js";
import { DOC_PAGES, abResults, link, renderFooter, renderStatusLine } from "../src/stats-ui.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const REPO = "/repo";
const WORKSPACE_FILES = ["README.md", "src/real.ts", "src/payment/stripe.ts", "src/app.ts"];
const DIFF_STAT = " src/payment/stripe.ts | 12 ++++++------\n 1 file changed, 6 insertions(+), 6 deletions(-)";

let tmp: string;
let gitStatus = "";
let gitCalls: string[] = [];
let clipboard: string[] = [];

const gitRunner: GitRunner = (args) => {
  const cmd = args.join(" ");
  gitCalls.push(cmd);
  if (cmd.startsWith("rev-parse --show-toplevel")) return `${REPO}\n`;
  if (cmd.startsWith("rev-parse --abbrev-ref")) return "main\n";
  if (cmd.startsWith("status")) return gitStatus;
  if (cmd.startsWith("ls-files")) return WORKSPACE_FILES.join("\n");
  if (cmd.startsWith("diff HEAD --stat")) return DIFF_STAT;
  return "";
};
const mockGit = (cwd: string) => new GitContext(cwd, { runner: gitRunner, fileExists: (p) => WORKSPACE_FILES.includes(p) });

function engine(options: BouncerEngineOptions = {}): BouncerEngine {
  return new BouncerEngine({
    ignoreStoredConfig: true,
    classifier: null,
    gitFactory: mockGit,
    clipboard: async (text) => {
      clipboard.push(text);
      return true;
    },
    ...options,
  });
}

const provider = (model: string): ProviderConfig => ({ providerName: "mock", baseUrl: "http://mock.invalid", model });

function mockClassifier(response: ClassifierResponse, delayMs = 0, model = "llama-3.3-70b-versatile") {
  const classify = vi.fn(
    (_req: unknown, _signal: AbortSignal) => new Promise<ClassifierResponse>((resolve) => setTimeout(() => resolve(response), delayMs)),
  );
  const classifier: Classifier = { profile: buildIntelligenceProfile(provider(model)), classify };
  return { classifier, classify };
}

function transcript(name: string, events: unknown[]): string {
  const path = join(tmp, name);
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
}
const userMsg = (text: string) => ({ type: "user", message: { role: "user", content: text } });
const assistantMsg = (model: string, content: unknown[] = [{ type: "text", text: "ok" }], usage?: object) => ({
  type: "assistant",
  message: { role: "assistant", model, content, ...(usage ? { usage } : {}) },
});

const prompt = (text: string, extra: Partial<{ transcriptPath: string }> = {}) => ({
  platform: "claude-code" as const,
  hookEvent: "UserPromptSubmit" as const,
  prompt: text,
  cwd: REPO,
  ...extra,
});

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bouncer-test-"));
  process.env.BOUNCER_HOME = join(tmp, "home");
  process.env.BOUNCER_NO_CLIPBOARD = "1";
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  gitStatus = "";
  gitCalls = [];
  clipboard = [];
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// TC-01 … TC-10
// ---------------------------------------------------------------------------
describe("TC-01 Intelligence Level Grading", () => {
  it("grades an unconfigured install as LEVEL 1 (Bronze)", () => {
    const p = buildIntelligenceProfile();
    expect(p.level).toBe(1);
    expect(p.badge).toBe("🥉 LEVEL 1 (Local Git-Truth)");
    expect(engine().intelligence.level).toBe(1);
  });

  it("grades llama-3.1-8b as LEVEL 2 (Silver) with a 0.90 gate", () => {
    const p = buildIntelligenceProfile(provider("llama-3.1-8b-instant"));
    expect(p.level).toBe(2);
    expect(p.minConfidenceThreshold).toBe(0.9);
  });

  it("fills the Cloudflare account ID into the preset URL and rejects a malformed one", () => {
    const p = providerFromPreset("cloudflare-gold", { apiKey: "t", accountId: "2d565dd4fbeedd42f9f1cc6f6209e30f" });
    expect(p.baseUrl).toBe("https://api.cloudflare.com/client/v4/accounts/2d565dd4fbeedd42f9f1cc6f6209e30f/ai/v1/chat/completions");
    expect(buildIntelligenceProfile(p).level).toBe(3);
    expect(() => providerFromPreset("cloudflare-gold", { apiKey: "t", accountId: "../evil" })).toThrow(/account ID/);
  });

  it.each(["llama-3.3-70b-versatile", "gemini-2.5-flash", "qwen2.5-coder:14b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"])("grades %s as LEVEL 3 (Gold) with a 0.80 gate", (model) => {
    const p = buildIntelligenceProfile(provider(model));
    expect(p.level).toBe(3);
    expect(p.badge).toBe("🥇 LEVEL 3 (Gold 70B/Flash)");
    expect(p.minConfidenceThreshold).toBe(0.8);
  });
});

describe("TC-02 Hallucinated File Stripping (Safety Law 1)", () => {
  it("strips files that are not in git ls-files / on disk before building the directive", async () => {
    const { classifier } = mockClassifier({
      complexity: "STANDARD",
      matchedFiles: ["src/real.ts", "src/hallucinated-fake.ts"],
      confidence: 0.95,
    });
    const r = await engine({ classifier }).evaluate(prompt("the login form crashes on submit"));

    expect(r.action).toBe("allow");
    expect(r.handledByTier).toBe(3);
    expect(r.highConfidenceHints).toEqual(["src/real.ts"]);
    expect(r.systemDirective).toContain("@src/real.ts");
    expect(r.systemDirective).not.toContain("hallucinated-fake");
  });
});

describe("TC-03 Low-Confidence Rejection (Safety Law 2)", () => {
  it("empties highConfidenceHints when confidence is below the threshold", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: ["src/real.ts"], confidence: 0.45 });
    const r = await engine({ classifier }).evaluate(prompt("the login form crashes on submit"));

    expect(r.confidenceScore).toBe(0.45);
    expect(r.highConfidenceHints).toEqual([]);
    expect(r.systemDirective).not.toContain("src/real.ts");
  });

  it("applies the stricter 0.90 gate on Silver", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: ["src/real.ts"], confidence: 0.85 }, 0, "llama-3.1-8b-instant");
    const r = await engine({ classifier }).evaluate(prompt("the login form crashes on submit"));
    expect(r.highConfidenceHints).toEqual([]);
  });
});

describe("TC-04 Git-Truth Priority", () => {
  it("prioritises the git-modified file at LEVEL 1 with zero network calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    gitStatus = " M src/payment/stripe.ts\n";

    const r = await engine().evaluate(prompt("the payment webhook returns 500"));

    expect(r.intelligence.level).toBe(1);
    expect(r.handledByTier).toBe(1);
    expect(r.verifiedGitFiles).toEqual(["src/payment/stripe.ts"]);
    expect(r.highConfidenceHints[0]).toBe("src/payment/stripe.ts");
    expect(r.systemDirective).toContain("Modified in git: @src/payment/stripe.ts");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("TC-05 VIP Velvet Rope on Complex Tasks", () => {
  it("classifies architecture work as COMPLEX and lifts all restrictions", async () => {
    const r = await engine().evaluate(prompt("Design a distributed rate-limiting architecture"));

    expect(r.action).toBe("allow");
    expect(r.complexity).toBe("COMPLEX");
    expect(r.usageBudget).toMatchObject({
      recommendedModel: "deep-reasoning",
      recommendedEffort: "high",
      maxExplorationToolCalls: "unlimited",
      delegateSearchToHaikuSubagent: false,
      outputStyle: "deep-unrestricted",
    });
    expect(r.systemDirective).toContain("no brevity or tool-call limits");
    expect(r.systemDirective).not.toMatch(/≤\d+ exploration/);
  });
});

describe("TC-06 Opus Overkill Interception", () => {
  it("blocks a trivial prompt on Opus, copies the untouched prompt and advises /model sonnet", async () => {
    const t = transcript("opus.jsonl", [userMsg("hello"), assistantMsg("claude-opus-4-6")]);
    const text = "Fix typo in @README.md";

    const r = await engine().evaluate(prompt(text, { transcriptPath: t }));

    expect(r.activeState.detectedModelTier).toBe("deep-reasoning");
    expect(r.action).toBe("block");
    expect(r.blockCategory).toBe("model-overkill");
    expect(exitCodeFor(r)).toBe(2);
    expect(clipboard).toEqual([text]);
    expect(r.clipboardCopied).toBe(true);
    expect(r.suggestedCommand).toBe("/model sonnet");
    expect(r.reason).toContain("/model sonnet");

    const out = new ClaudeCodeAdapter().render(r);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("OPUS OVERKILL");
  });

  it("lets the same prompt through on Sonnet", async () => {
    const t = transcript("sonnet.jsonl", [userMsg("hello"), assistantMsg("claude-sonnet-4-5")]);
    const r = await engine().evaluate(prompt("Fix typo in @README.md", { transcriptPath: t }));
    expect(r.action).toBe("allow");
    expect(clipboard).toEqual([]);
  });
});

describe("TC-07 Contraband Secret Interception", () => {
  it("blocks a leaked Anthropic key before the LLM is ever called", async () => {
    const { classifier, classify } = mockClassifier({ complexity: "TRIVIAL", matchedFiles: [], confidence: 1 });

    const r = await engine({ classifier }).evaluate(prompt("My key sk-ant-api03-xxxx is failing"));

    expect(r.action).toBe("block");
    expect(r.blockCategory).toBe("contraband-secret");
    expect(classify).not.toHaveBeenCalled();
    expect(r.reason).not.toContain("api03-xxxx");
    expect(clipboard).toEqual([]); // a secret must never be copied anywhere
  });

  it("blocks secrets even in yolo mode", async () => {
    const r = await engine({ config: { mode: "yolo" } }).evaluate(prompt("use AKIAABCDEFGHIJKLMNOP for s3"));
    expect(r.blockCategory).toBe("contraband-secret");
  });
});

describe("TC-08 Crowd Control Context Bloat Handover", () => {
  const strict = () => engine({ config: { mode: "strict" } });

  it("strict: generates a /clear handover for a >130KB transcript and copies it to the clipboard", async () => {
    const t = transcript("big.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", [{ type: "text", text: "x".repeat(140 * 1024) }]),
    ]);

    const r = await strict().evaluate(prompt("now add tests for the cart", { transcriptPath: t }));

    expect(r.action).toBe("block");
    expect(r.blockCategory).toBe("context-bloat");
    expect(r.suggestedCommand).toBe("/clear");
    expect(r.handoverPrompt).toContain("Build the checkout page");
    expect(r.handoverPrompt).toContain("now add tests for the cart");
    expect(clipboard).toEqual([r.handoverPrompt]);
  });

  it("prefers real context tokens from usage over transcript bytes", async () => {
    const bigFileSmallContext = transcript("compacted.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", [{ type: "text", text: "x".repeat(140 * 1024) }], { input_tokens: 5, cache_read_input_tokens: 40_000 }),
    ]);
    expect((await strict().evaluate(prompt("now add tests", { transcriptPath: bigFileSmallContext }))).action).toBe("allow");

    const smallFileBigContext = transcript("heavy.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 170_000, cache_creation_input_tokens: 1_000 }),
    ]);
    const r = await strict().evaluate(prompt("now add tests", { transcriptPath: smallFileBigContext }));
    expect(r.blockCategory).toBe("context-bloat");
    expect(r.reason).toContain("~171k tokens");
  });

  it("balanced: warns once without blocking, so a long task keeps its context", async () => {
    const heavy = transcript("heavy-bal.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 171_000 }),
    ]);
    const r = await engine({ persist: true }).evaluate({ ...prompt("now add tests", { transcriptPath: heavy }), sessionId: "bloat-warn" });
    expect(r.action).toBe("allow");
    expect(r.userNotice).toContain("~171k of 200k");
    expect(new ClaudeCodeAdapter().render(r).stdout).toContain("systemMessage");
    const again = await engine({ persist: true }).evaluate({ ...prompt("and the cart", { transcriptPath: heavy }), sessionId: "bloat-warn" });
    expect(again.userNotice).toBeUndefined();
  });

  it("scales the threshold to a 1M context window", async () => {
    const big = transcript("1m.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 384_000 }),
    ]);
    expect((await strict().evaluate(prompt("now add tests", { transcriptPath: big }))).action).toBe("allow");
    const huge = transcript("1m-full.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 800_000 }),
    ]);
    expect((await strict().evaluate(prompt("now add tests", { transcriptPath: huge }))).blockCategory).toBe("context-bloat");
  });
});

describe("Honest budgets and savings", () => {
  it("sends no limits when the task size is a guess", async () => {
    const r = await engine().evaluate(prompt("hỗ trợ mọi ngôn ngữ trên thế giới"));
    expect(r.budgetApplied).toBe(false);
    expect(r.systemDirective).not.toMatch(/aim for|concise|STANDARD/);
    expect(r.tokensSavedEstimate).toBe(0);
  });

  it("keeps limits when a strong local signal or the AI is sure", async () => {
    expect((await engine().evaluate(prompt("fix the typo in README.md"))).systemDirective).toContain("TRIVIAL");
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.9 });
    expect((await engine({ classifier }).evaluate(prompt("add a retry to the payment call"))).budgetApplied).toBe(true);
  });

  it("takes savings back when the user overrides a block with ' !'", async () => {
    const heavy = transcript("heavy-retract.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 171_000 }),
    ]);
    const e = () => engine({ persist: true, config: { mode: "strict" } });
    const before = loadStats().tokensSavedEstimate;
    await e().evaluate({ ...prompt("now add tests", { transcriptPath: heavy }), sessionId: "retract" });
    expect(loadStats().tokensSavedEstimate - before).toBe(171_002);
    await e().evaluate({ ...prompt("now add tests !", { transcriptPath: heavy }), sessionId: "retract" });
    expect(loadStats().tokensSavedEstimate).toBe(before);
    expect(loadSession("retract")?.tokensSaved).toBe(0);
  });
});

describe("TC-09 Deterministic Rate-Limit Rescue", () => {
  it("outputs exact verbatim prompts and the real git diff stat", async () => {
    gitStatus = " M src/payment/stripe.ts\n";
    const first = "Implement Stripe refunds\nwith `idempotency` keys";
    const last = "also handle partial refunds";
    const t = transcript("rl.jsonl", [
      userMsg(first),
      assistantMsg("claude-sonnet-4-5", [{ type: "tool_use", name: "Edit", input: { file_path: `${REPO}/src/payment/stripe.ts` } }]),
      userMsg(last),
      {
        type: "assistant",
        isApiErrorMessage: true,
        message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: 'API Error: {"type":"error","error":{"type":"rate_limit_error"}}' }] },
      },
    ]);

    expect(RescueEngine.detectRateLimit(t)).toBe(true);
    const pkg = await new RescueEngine({ git: mockGit(REPO), clipboard: async () => true, persist: false }).build({
      cwd: REPO,
      transcriptPath: t,
      reason: "rate-limit",
    });

    expect(pkg.rateLimitDetected).toBe(true);
    expect(pkg.initialGoal).toBe(first);
    expect(pkg.interruptedTask).toBe(last);
    expect(pkg.markdown).toContain(first);
    expect(pkg.markdown).toContain(last);
    expect(pkg.gitDiffStat).toBe(DIFF_STAT);
    expect(pkg.markdown).toContain(DIFF_STAT);
    expect(pkg.gitStatusShort).toBe(" M src/payment/stripe.ts");
    expect(pkg.sessionModifiedFiles).toEqual(["src/payment/stripe.ts"]);
    expect(pkg.executiveSummary).toBeUndefined(); // Level 1: no AI synthesis
    expect(pkg.clipboardCopied).toBe(true);
  });

  it("runs automatically from the Stop hook", async () => {
    const t = transcript("rl-stop.jsonl", [userMsg("ship it"), { type: "assistant", message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "Claude AI usage limit reached" }] } }]);
    const outcome = await engine({ persist: false }).handleStop({ platform: "claude-code", hookEvent: "Stop", cwd: REPO, transcriptPath: t });
    expect(outcome.rateLimitDetected).toBe(true);
    expect(outcome.rescue?.interruptedTask).toBe("ship it");
  });
});

describe("TC-10 Trailing '!' VIP Pass & 1500ms Fail-Open", () => {
  it("lets 'fix bug !' bypass every check, even Opus overkill", async () => {
    const t = transcript("opus-vip.jsonl", [userMsg("hello"), assistantMsg("claude-opus-4-6")]);
    const r = await engine({ config: { mode: "strict" } }).evaluate(prompt("fix bug !", { transcriptPath: t }));

    expect(r.action).toBe("allow");
    expect(r.systemDirective).toBe("");
    expect(exitCodeFor(r)).toBe(0);
    expect(gitCalls).toEqual([]); // nothing was even inspected
  });

  it("aborts a 2000ms AI call at 1500ms and falls back to a clean LEVEL 1 decision", async () => {
    const { classifier, classify } = mockClassifier({ complexity: "COMPLEX", matchedFiles: ["src/real.ts"], confidence: 1 }, 2000);

    const started = Date.now();
    const r = await engine({ classifier }).evaluate(prompt("the login form crashes on submit"));
    const elapsed = Date.now() - started;

    expect(classify).toHaveBeenCalledOnce();
    expect(classify.mock.calls[0]![1].aborted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(1450);
    expect(elapsed).toBeLessThan(1950);
    expect(r.action).toBe("allow");
    expect(exitCodeFor(r)).toBe(0);
    expect(r.handledByTier).toBe(1);
    expect(r.complexity).toBe("STANDARD"); // the local decision, not the late AI answer
    expect(r.highConfidenceHints).toEqual([]);
    expect(r.reason).toContain("timed out after 1500ms");
  });
});

// ---------------------------------------------------------------------------
// Quality guards (beyond the spec's TC list)
// ---------------------------------------------------------------------------
describe("Quality guards", () => {
  const opus = () => transcript(`opus-${Math.random()}.jsonl`, [userMsg("hello"), assistantMsg("claude-opus-4-6")]);

  it("never lets the ' !' VIP pass send a leaked secret", async () => {
    const r = await engine().evaluate(prompt("deploy with sk-ant-api03-abcdefghij !"));
    expect(r.blockCategory).toBe("contraband-secret");
  });

  it("stops blocking a category for the rest of the session once the user overrides it with ' !'", async () => {
    const t = opus();
    const e = engine();
    const s = { sessionId: "sess-override", transcriptPath: t };
    expect((await e.evaluate({ ...prompt("Fix typo in @README.md"), ...s })).blockCategory).toBe("model-overkill");
    expect((await e.evaluate({ ...prompt("Fix typo in @README.md !"), ...s })).action).toBe("allow");
    expect((await e.evaluate({ ...prompt("rename the title in @README.md"), ...s })).action).toBe("allow");
    // Other sessions are still protected.
    expect((await e.evaluate({ ...prompt("Fix typo in @README.md"), sessionId: "other", transcriptPath: t })).blockCategory).toBe("model-overkill");
  });

  it("only blocks Opus when the local classifier agrees the task is routine (two-signal rule)", async () => {
    const { classifier } = mockClassifier({ complexity: "TRIVIAL", matchedFiles: [], confidence: 0.95 });
    const r = await engine({ classifier }).evaluate(prompt("the login form crashes on submit", { transcriptPath: opus() }));
    expect(r.complexity).toBe("TRIVIAL");
    expect(r.action).toBe("allow");
  });

  it("discounts a scattershot AI answer below the confidence gate and caps hints at 3", async () => {
    const many = mockClassifier({ complexity: "STANDARD", matchedFiles: WORKSPACE_FILES, confidence: 0.9 });
    expect((await engine({ classifier: many.classifier }).evaluate(prompt("the login form crashes on submit"))).highConfidenceHints).toEqual([]);

    const three = mockClassifier({ complexity: "STANDARD", matchedFiles: WORKSPACE_FILES.slice(0, 3), confidence: 0.9, keywords: ["readme", "real", "stripe"] });
    expect((await engine({ classifier: three.classifier }).evaluate(prompt("the login form crashes on submit"))).highConfidenceHints).toHaveLength(3);
  });

  it("skips the AI call when Level 1 is already certain", async () => {
    const { classifier, classify } = mockClassifier({ complexity: "COMPLEX", matchedFiles: [], confidence: 1 });
    const r = await engine({ classifier }).evaluate(prompt("Fix typo in @README.md"));
    expect(classify).not.toHaveBeenCalled();
    expect(r.highConfidenceHints).toEqual(["README.md"]);
    expect(r.complexity).toBe("TRIVIAL");
  });

  it("tells Claude that quality beats the budget", async () => {
    const r = await engine().evaluate(prompt("Fix typo in @README.md"));
    expect(r.systemDirective).toContain("Quality first");
  });

  it("ranks the workspace sample by the prompt so the right file reaches the classifier in big repos", () => {
    const files = Array.from({ length: 200 }, (_, i) => `src/module${i}/index.ts`).concat("src/billing/invoice-renderer.ts");
    const runner: GitRunner = (args) => (args[0] === "ls-files" ? files.join("\n") : args[0] === "rev-parse" ? REPO : "");
    const git = new GitContext(REPO, { runner, fileExists: () => true });
    expect(git.workspaceSample(40, "the invoice renderer drops VAT lines")[0]).toBe("src/billing/invoice-renderer.ts");
  });
});

describe("After-answer footer & status line", () => {
  const stats = { tokensSavedEstimate: 4000 } as Parameters<typeof renderFooter>[0];
  const session = (last: number) => ({ prompts: 2, blocks: 0, tokensSaved: 4000, lastTokensSaved: last, overrides: [], lastSeenAt: "" });
  const gold = buildIntelligenceProfile(providerFromPreset("groq-gold", { apiKey: "k" }));
  const bronze = buildIntelligenceProfile(undefined);

  const withLast = (last: number) => ({
    ...session(last),
    last: {
      action: "allow" as const, complexity: "STANDARD" as const, recommendedModel: "balanced" as const, recommendedEffort: "medium" as const,
      detectedModel: "deep-reasoning" as const, hints: 1, gitFiles: 2, contextTokens: 42_000, ai: "ok" as const,
      savings: last ? [{ label: "1 verified file hint, fewer exploratory reads", tokens: last }] : [],
    },
  });

  it("explains why, how it routed, session and total", () => {
    const text = renderFooter(stats, withLast(3000), gold);
    expect(text.split("\n")[0]).toContain("saved ~3.0k tokens on this prompt");
    expect(text).toMatch(/why\s+1 verified file hint.*−3\.0k/);
    expect(text).toMatch(/route\s+STANDARD → Sonnet\/medium · you're on Opus · 🥇 L3 AI ✓ · 2 modified files pointed out\n/);
    expect(text).toMatch(/context +42\.0k \/ 200\.0k ▓▓░░░░░░░░ 21%/);
    expect(text).toMatch(/session\s+−4\.0k over 2 prompts/);
    expect(text).toMatch(/└ more/);
    expect(text).toContain("/bouncer docs");
    expect(text).not.toContain("`");
  });

  it("still reports when nothing was saved, and links Gold setup on Level 1", () => {
    expect(renderFooter(stats, withLast(0), gold)).toContain("nothing to trim");
    expect(renderFooter(stats, undefined, bronze)).toContain("/unlock-gold/");
  });

  it("status line shows level, last route, session and total", () => {
    const line = renderStatusLine(stats, withLast(2000), gold);
    expect(line).toMatch(/L3.*last STANDARD → Sonnet −2\.0k.*session −4\.0k \/ 2 prompts.*total −4\.0k.*ctx 42\.0k/);
  });

  it("status line ends with a clickable (OSC 8) docs link", () => {
    expect(link("docs", DOC_PAGES.home!)).toBe("\u001b]8;;" + DOC_PAGES.home + "\u001b\\docs\u001b]8;;\u001b\\");
    expect(renderStatusLine(stats, undefined, bronze)).toContain(DOC_PAGES.gold);
  });

  it("installs a managed status line, keeps a user's own, and uninstall removes only ours", () => {
    const home = mkdtempSync(join(tmpdir(), "bouncer-claude-"));
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      const settingsFile = join(home, "settings.json");
      expect(installClaudeCode("node", "/b/index.js").statusLineInstalled).toBe(true);
      expect(JSON.parse(readFileSync(settingsFile, "utf8")).statusLine.command).toContain("statusline --bouncer-managed");
      uninstallClaudeCode();
      expect(JSON.parse(readFileSync(settingsFile, "utf8")).statusLine).toBeUndefined();

      writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: "command", command: "my-line" } }));
      expect(installClaudeCode("node", "/b/index.js").statusLineInstalled).toBe(false);
      uninstallClaudeCode();
      expect(JSON.parse(readFileSync(settingsFile, "utf8")).statusLine.command).toBe("my-line");
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Prompt QC: vague, broad scope, big paste", () => {
  const bigRepo = Array.from({ length: 200 }, (_, i) => `src/mod${i % 10}/file${i}.ts`);
  const bigGit = (cwd: string) =>
    new GitContext(cwd, {
      runner: (args) => (args[0] === "ls-files" ? bigRepo.join("\n") : args[0] === "rev-parse" ? REPO : ""),
      fileExists: () => true,
    });
  const midSession = () => transcript(`mid-${Math.random()}.jsonl`, [userMsg("look at the login bug"), assistantMsg("claude-sonnet-4-5")]);

  it("recognises Vietnamese vague prompts but not concrete ones", () => {
    for (const p of ["sửa đi", "fix lỗi giúp", "nó không chạy", "vẫn lỗi rồi", "kiểm tra lại đi"]) expect(isVaguePrompt(p), p).toBe(true);
    for (const p of ["sửa lỗi null trong src/app.ts", "fix the off-by-one in paginate()", "Làm Phase 3"]) expect(isVaguePrompt(p), p).toBe(false);
  });

  it("balanced blocks a vague prompt only before Claude has any context", async () => {
    expect((await engine().evaluate(prompt("fix it"))).blockCategory).toBe("vague-prompt");
    const mid = await engine().evaluate(prompt("fix it", { transcriptPath: midSession() }));
    expect(mid.action).toBe("allow");
  });

  it("blocks an unscoped repo-wide ask in a big repo, with a cost estimate", async () => {
    const r = await engine({ gitFactory: bigGit }).evaluate(prompt("review the whole codebase for bugs"));
    expect(r.blockCategory).toBe("broad-scope");
    expect(r.reason).toMatch(/200 files.*~160k tokens.*src\//);
    const vi = await engine({ gitFactory: bigGit }).evaluate(prompt("đọc hết code rồi tối ưu"));
    expect(vi.blockCategory).toBe("broad-scope");
  });

  it("lets a scoped or small-repo broad ask through", async () => {
    expect((await engine({ gitFactory: bigGit }).evaluate(prompt("review all files in src/mod3/ for bugs"))).action).toBe("allow");
    expect((await engine().evaluate(prompt("review the whole codebase for bugs"))).action).toBe("allow"); // 4-file repo
  });

  it("blocks an oversized paste, but ' !' still sends it", async () => {
    const paste = "const x = 1; // some pasted source\n".repeat(1200);
    expect((await engine().evaluate(prompt(`explain this:\n${paste}`))).blockCategory).toBe("oversized-paste");
    expect((await engine().evaluate(prompt(`explain this:\n${paste} !`))).action).toBe("allow");
  });

  it("yolo skips every QC block", async () => {
    const r = await engine({ gitFactory: bigGit, config: { mode: "yolo" } }).evaluate(prompt("review the whole codebase"));
    expect(r.action).toBe("allow");
  });
});

describe("Prompt QC in every language", () => {
  const bigRepo = Array.from({ length: 200 }, (_, i) => `src/mod${i % 10}/file${i}.ts`);
  const bigGit = (cwd: string) =>
    new GitContext(cwd, {
      runner: (args) => (args[0] === "ls-files" ? bigRepo.join("\n") : args[0] === "rev-parse" ? REPO : ""),
      fileExists: () => true,
    });

  it("Level 1 catches vague prompts in major languages", () => {
    const vague = ["fix it", "sửa đi", "arréglalo", "não funciona", "ça marche pas", "geht nicht", "не работает", "perbaiki dong", "修一下", "还是不行", "直して", "動かない", "고쳐줘", "안 돼요", "ไม่ทำงาน", "ठीक करो", "düzelt şunu", "أصلحه", "non funziona", "napraw to", "werkt niet"];
    for (const p of vague) expect(isVaguePrompt(p), p).toBe(true);
  });

  it("never flags prompts with a concrete anchor, whatever the language", () => {
    const concrete = ["修复 src/app.ts 里的空指针", "login.tsの型エラーを直して", "corrige la fonction parseDate()", "исправь ошибку 404 на странице входа", "Làm Phase 2"];
    for (const p of concrete) expect(isVaguePrompt(p), p).toBe(false);
  });

  it("Level 1 catches repo-wide asks in major languages", () => {
    for (const p of ["revisa todo el código", "relis tout le code", "prüfe die ganze Codebasis", "проверь весь код", "检查整个项目", "コード全体をレビューして", "전체 코드를 리뷰해줘", "periksa semua kode"]) {
      expect(detectBroadScope(p), p).toBeTruthy();
    }
  });

  it("counts CJK characters as ~1 token each", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("代码".repeat(200))).toBe(400);
  });

  it("uses the AI verdict for languages without local patterns (Swahili)", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, vague: true, missing: "faili gani na kosa gani" });
    const r = await engine({ classifier }).evaluate(prompt("rekebisha hii"));
    expect(r.blockCategory).toBe("vague-prompt");
    expect(r.reason).toContain("Missing: faili gani na kosa gani");
    const { classifier: broad } = mockClassifier({ complexity: "COMPLEX", matchedFiles: [], confidence: 0.5, broadScope: true });
    const b = await engine({ classifier: broad, gitFactory: bigGit }).evaluate(prompt("kagua msimbo wote wa mradi"));
    expect(b.blockCategory).toBe("broad-scope");
  });

  it("ignores an AI 'vague' verdict that can't say what is missing (quality guard)", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, vague: true });
    expect((await engine({ classifier }).evaluate(prompt("rekebisha hii"))).action).toBe("allow");
  });
});

describe("Classifier contract tolerance", () => {
  it("keeps vague/broadScope when a small model answers complexity 'VAGUE', with zero confidence", () => {
    const r = parseClassifierResponse({ complexity: "VAGUE", matchedFiles: ["src/app.ts"], confidence: 0.9, vague: true });
    expect(r).toMatchObject({ complexity: "STANDARD", confidence: 0, vague: true });
    expect(parseClassifierResponse({ complexity: "HUGE", confidence: 0.9 })).toBeNull();
  });
});

describe("The AI judges vagueness by meaning, in session context", () => {
  it("can call a long prompt vague: length is not the rule", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, vague: true, missing: "which page and which behaviour" });
    const long = "please have a careful look at the thing we talked about and make it behave a lot better than it does right now";
    expect((await engine({ classifier }).evaluate(prompt(long))).blockCategory).toBe("vague-prompt");
  });

  it("overrides Level 1 patterns when it finds the prompt clear", async () => {
    const { classifier } = mockClassifier({ complexity: "TRIVIAL", matchedFiles: [], confidence: 0.9, vague: false });
    expect((await engine({ classifier }).evaluate(prompt("sửa đi"))).action).toBe("allow");
  });

  it("receives the earlier prompts of the session, without the current one", async () => {
    const { classifier, classify } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5 });
    const t = transcript("ctx.jsonl", [userMsg("the login button does nothing on Safari"), assistantMsg("claude-sonnet-4-5"), userMsg("fix it")]);
    await engine({ classifier, config: { mode: "strict" } }).evaluate(prompt("fix it", { transcriptPath: t }));
    expect(classify.mock.calls[0]![0]).toMatchObject({ previousPrompts: ["the login button does nothing on Safari"] });
  });
});

describe("AI hint relevance check", () => {
  const files = ["src/components/Header.tsx", "src/auth/logout.ts", "packages/cli/src/stats-ui.ts", "packages/cli/src/index.ts"];
  const git = new GitContext(REPO, {
    runner: (args) => (args[0] === "ls-files" ? files.join("\n") : args[0] === "rev-parse" ? REPO : ""),
    fileExists: () => true,
  });
  const gold = buildIntelligenceProfile(provider("llama-3.3-70b-versatile"));

  it("drops confident but unrelated files", () => {
    const r = applySafetyLaws({ complexity: "STANDARD", matchedFiles: ["packages/cli/src/stats-ui.ts", "packages/cli/src/index.ts"], confidence: 0.85 }, git, gold, "add a logout button to the header");
    expect(r.hints).toEqual([]);
    expect(r.irrelevant).toHaveLength(2);
  });

  it("keeps related files, and uses the AI's English keywords for other languages", () => {
    const en = applySafetyLaws({ complexity: "STANDARD", matchedFiles: ["src/components/Header.tsx", "src/auth/logout.ts"], confidence: 0.85 }, git, gold, "add a logout button to the header");
    expect(en.hints).toEqual(["src/components/Header.tsx", "src/auth/logout.ts"]);
    const vi = applySafetyLaws({ complexity: "STANDARD", matchedFiles: ["src/auth/logout.ts", "packages/cli/src/index.ts"], confidence: 0.85, keywords: ["logout", "button"] }, git, gold, "thêm nút đăng xuất");
    expect(vi.hints).toEqual(["src/auth/logout.ts"]);
  });
});

describe("Size limits only when the size is knowable", () => {
  const ctx = () => transcript(`fu-${Math.random()}.jsonl`, [userMsg("audit the whole safety pipeline"), assistantMsg("claude-sonnet-4-5"), userMsg("Cả hai")]);

  it("a follow-up with no anchor gets no limits, even if the AI says TRIVIAL", async () => {
    const { classifier } = mockClassifier({ complexity: "TRIVIAL", matchedFiles: [], confidence: 0.9, sizeConfidence: 0.9 });
    const r = await engine({ classifier }).evaluate(prompt("Cả hai", { transcriptPath: ctx() }));
    expect(r.budgetApplied).toBe(false);
    expect(r.systemDirective).not.toMatch(/TRIVIAL|aim for/);
  });

  it("an AI unsure of the size sends no limits", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.9, sizeConfidence: 0.3 });
    expect((await engine({ classifier }).evaluate(prompt("make the dashboard nicer"))).budgetApplied).toBe(false);
  });

  it("a first prompt the AI is sure about keeps its limits", async () => {
    const { classifier } = mockClassifier({ complexity: "TRIVIAL", matchedFiles: [], confidence: 0.9, sizeConfidence: 0.9 });
    expect((await engine({ classifier }).evaluate(prompt("bump the version in the package manifest"))).budgetApplied).toBe(true);
  });
});

describe("A/B measurement on real usage", () => {
  const usage = (input: number, read: number, out: number) => ({ input_tokens: input, cache_read_input_tokens: read, output_tokens: out });
  const turn = (id: string, u: object, tools = 0) => ({
    type: "assistant",
    message: { id, role: "assistant", model: "claude-sonnet-4-5", content: Array.from({ length: tools }, () => ({ type: "tool_use", name: "Read", input: {} })), usage: u },
  });

  it("reads the last turn's usage, de-duplicating split content blocks", () => {
    const t = transcript("usage.jsonl", [
      userMsg("old prompt"),
      turn("m0", usage(999, 0, 999)),
      userMsg("fix the cart total"),
      turn("m1", usage(100, 1000, 50), 1),
      turn("m1", usage(100, 1000, 50), 1), // same API call, second content block
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "file text" }] } },
      turn("m2", usage(10, 2000, 200)),
    ]);
    expect(lastTurnUsage(t)).toEqual({ input: 110, cacheCreation: 0, cacheRead: 3000, output: 250, toolCalls: 2 });
  });

  it("holds back guidance on control prompts and claims no savings for them", async () => {
    const control = await engine({ config: { measure: true }, random: () => 0.1 }).evaluate(prompt("fix the typo in README.md"));
    expect(control.abGroup).toBe("control");
    expect(control.systemDirective).toBe("");
    expect(control.tokensSavedEstimate).toBe(0);
    const guided = await engine({ config: { measure: true }, random: () => 0.9 }).evaluate(prompt("fix the typo in README.md"));
    expect(guided.abGroup).toBe("treatment");
    expect(guided.systemDirective).toContain("TRIVIAL");
  });

  it("records each finished turn into its group and compares cost per turn", async () => {
    const e = (r: number) => engine({ persist: true, config: { measure: true }, random: () => r });
    const run = async (sid: string, r: number, out: number) => {
      await e(r).evaluate({ ...prompt("fix the typo in README.md"), sessionId: sid });
      const t = transcript(`${sid}.jsonl`, [userMsg("fix the typo in README.md"), turn(`${sid}-a`, usage(100, 0, out))]);
      await e(r).handleStop({ ...prompt(""), hookEvent: "Stop", sessionId: sid, transcriptPath: t });
    };
    await run("ab-c", 0.1, 400); // control: 100 + 400*5 = 2100
    await run("ab-t", 0.9, 100); // guided:  100 + 100*5 = 600
    const r = abResults(loadStats()).find((x) => x.complexity === "TRIVIAL")!;
    expect(r.controlCost).toBe(2100);
    expect(r.treatmentCost).toBe(600);
    expect(Math.round(r.savedPct)).toBe(71);
    expect(loadSession("ab-c")?.pendingAb).toBeUndefined();
  });
});

describe("OpenAI Codex host", () => {
  const ev = (type: string, payload: object) => ({ timestamp: "t", type, payload });
  const tokenCount = (input: number, cached: number, output: number, total: number, window = 258_400, used = 8) =>
    ev("event_msg", {
      type: "token_count",
      info: {
        last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
        total_token_usage: { total_tokens: total },
        model_context_window: window,
      },
      rate_limits: { primary: { used_percent: used, window_minutes: 300 }, secondary: { used_percent: 20, window_minutes: 10080 } },
    });
  const rollout = (name: string, extra: object[] = []) =>
    transcript(name, [
      ev("session_meta", { id: "s1", cwd: REPO }),
      ev("turn_context", { model: "gpt-5.5", effort: "xhigh" }),
      ev("event_msg", { type: "user_message", message: "add a retry to the payment call" }),
      ev("response_item", { type: "function_call", name: "shell", arguments: "{}" }),
      tokenCount(40_000, 30_000, 500, 40_500),
      tokenCount(40_000, 30_000, 500, 40_500), // re-emitted, same call
      ev("event_msg", { type: "patch_apply_end", changes: { "src/payment/stripe.ts": { type: "update" } } }),
      tokenCount(45_000, 40_000, 800, 86_300),
      ev("event_msg", { type: "agent_message", message: "Done." }),
      ...extra,
    ]);

  it("reads model, effort, context window, prompts and edits from a rollout", () => {
    const s = detectActiveSession(rollout("codex1.jsonl"));
    expect(s).toMatchObject({ rawModelName: "gpt-5.5", detectedModelTier: "unknown", detectedEffort: "high", contextTokens: 45_000, contextWindow: 258_400 });
    expect(s.recentPrompts).toEqual(["add a retry to the payment call"]);
  });

  it("measures the last turn from token_count events, skipping re-emits", () => {
    expect(lastTurnUsage(rollout("codex2.jsonl"))).toEqual({ input: 15_000, cacheCreation: 0, cacheRead: 70_000, output: 1_300, toolCalls: 1 });
  });

  it("detects a used-up rate-limit window as a rate-limit hit", () => {
    const hit = rollout("codex3.jsonl", [tokenCount(45_000, 40_000, 10, 86_310, 258_400, 100)]);
    expect(RescueEngine.detectRateLimit(hit)).toBe(true);
    expect(RescueEngine.detectRateLimit(rollout("codex4.jsonl"))).toBe(false);
  });

  it("uses Codex wording: no Claude model names or Haiku scout, /new instead of /clear", async () => {
    const r = await engine().evaluate({ ...prompt("fix the typo in README.md"), platform: "codex" });
    expect(r.systemDirective).toContain("low reasoning effort");
    expect(r.systemDirective).not.toMatch(/Haiku|Sonnet|bouncer-scout/);
    const big = rollout("codex5.jsonl", [tokenCount(240_000, 200_000, 10, 99_999_999)]);
    const bloat = await engine({ config: { mode: "strict" } }).evaluate({ ...prompt("now add tests", { transcriptPath: big }), platform: "codex" });
    expect(bloat.blockCategory).toBe("context-bloat");
    expect(bloat.suggestedCommand).toBe("/new");
  });

  it("Stop always answers with JSON, as Codex requires", () => {
    expect(new CodexAdapter().renderStop(undefined)).toEqual({ exitCode: 0, stdout: "{}" });
    expect(new CodexAdapter().parseInput({ prompt: "x", session_id: "s" }).platform).toBe("codex");
  });

  it("installs into ~/.codex/hooks.json, keeps the user's hooks, and uninstalls only its own", () => {
    const home = mkdtempSync(join(tmpdir(), "bouncer-codex-"));
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      const file = join(home, "hooks.json");
      writeFileSync(file, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "my-check" }] }] } }));
      const r = installCodex("node", "/b/index.js");
      expect(r.backupPath).toBe(`${file}.bak`);
      const installed = JSON.parse(readFileSync(file, "utf8"));
      expect(installed.hooks.UserPromptSubmit).toHaveLength(2);
      expect(installed.hooks.Stop[0].hooks[0].command).toContain("hook stop --host codex --bouncer-managed");
      expect(isCodexInstalled()).toBe(true);
      installCodex("node", "/b/index.js"); // re-install never duplicates
      expect(JSON.parse(readFileSync(file, "utf8")).hooks.UserPromptSubmit).toHaveLength(2);
      expect(uninstallCodex().removed).toBe(2);
      expect(JSON.parse(readFileSync(file, "utf8")).hooks).toEqual({ UserPromptSubmit: [{ hooks: [{ type: "command", command: "my-check" }] }] });
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Eco mode: new tasks start in a small context", () => {
  const big = (name: string, last = "add a retry to the payment call") =>
    transcript(name, [
      userMsg(last),
      assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 380_000 }),
    ]);
  const eco = (extra: Partial<BouncerEngineOptions> = {}) => engine({ config: { ecoContextTokens: 200_000 }, ...extra });

  it("blocks a new task above the budget with a handover that includes the prompt", async () => {
    const r = await eco().evaluate(prompt("write the onboarding email templates", { transcriptPath: big("eco1.jsonl") }));
    expect(r.blockCategory).toBe("eco-clear");
    expect(r.suggestedCommand).toBe("/clear");
    expect(r.handoverPrompt).toContain("write the onboarding email templates");
    expect(r.reason).toMatch(/~380k tokens.*cheaper/);
    expect(clipboard).toEqual([r.handoverPrompt]);
  });

  it("never interrupts a follow-up or a prompt continuing the same work", async () => {
    expect((await eco().evaluate(prompt("làm tiếp", { transcriptPath: big("eco2.jsonl") }))).action).toBe("allow");
    expect((await eco().evaluate(prompt("also log every payment retry attempt", { transcriptPath: big("eco3.jsonl") }))).action).toBe("allow");
  });

  it("trusts the AI's newTask verdict when it answered", async () => {
    const cont = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, newTask: false });
    expect((await eco({ classifier: cont.classifier }).evaluate(prompt("write the onboarding email templates", { transcriptPath: big("eco4.jsonl") }))).action).toBe("allow");
    const fresh = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, newTask: true });
    expect((await eco({ classifier: fresh.classifier }).evaluate(prompt("now the invoices page", { transcriptPath: big("eco5.jsonl") }))).blockCategory).toBe("eco-clear");
  });

  it("stays quiet below the budget, when off, and in yolo", async () => {
    const small = transcript("eco6.jsonl", [userMsg("add a retry"), assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 90_000 })]);
    expect((await eco().evaluate(prompt("write the onboarding email templates", { transcriptPath: small }))).action).toBe("allow");
    expect((await engine().evaluate(prompt("write the onboarding email templates", { transcriptPath: big("eco7.jsonl") }))).action).toBe("allow");
    expect((await engine({ config: { ecoContextTokens: 200_000, mode: "yolo" } }).evaluate(prompt("write the onboarding email templates", { transcriptPath: big("eco8.jsonl") }))).action).toBe("allow");
  });

  it("records context size with eco off vs on for the before/after comparison", async () => {
    const before = loadStats().contextAtPrompt ?? {};
    const small = transcript("eco9.jsonl", [userMsg("add a retry"), assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 50_000 })]);
    await engine({ persist: true, config: { ecoContextTokens: 200_000 } }).evaluate({ ...prompt("add jitter", { transcriptPath: small }), sessionId: "eco-stats" });
    const after = loadStats().contextAtPrompt!;
    expect(after.on!.n - (before.on?.n ?? 0)).toBe(1);
    expect(after.on!.sum - (before.on?.sum ?? 0)).toBe(50_002);
  });
});

describe("Footer: status and next actions", () => {
  const stats = { tokensSavedEstimate: 4000 } as Parameters<typeof renderFooter>[0];
  const gold = buildIntelligenceProfile(providerFromPreset("groq-gold", { apiKey: "k" }));
  const cfg = (extra: object = {}) => ({ mode: "balanced", aiTimeoutMs: 3000, footerEnabled: true, clipboardEnabled: true, contextBloatThresholdTokens: 150_000, contextBloatThresholdBytes: 1, ...extra }) as Parameters<typeof renderFooter>[3];
  const session = (last: object) => ({ prompts: 3, blocks: 0, tokensSaved: 4000, lastTokensSaved: 0, overrides: [], lastSeenAt: "",
    last: { action: "allow", complexity: "STANDARD", recommendedModel: "balanced", recommendedEffort: "medium", hints: 0, gitFiles: 0, ai: "ok", savings: [], ...last } }) as Parameters<typeof renderFooter>[1];

  it("shows the context bar, current status, tips and links", () => {
    const text = renderFooter(stats, session({ contextTokens: 467_000, contextWindow: 1_000_000 }), gold, cfg({ ecoContextTokens: 200_000 }));
    expect(text).toMatch(/context +467\.0k \/ 1\.0M ▓▓▓▓▓░░░░░ 47% · eco: new tasks start fresh above 200\.0k/);
    expect(text).toMatch(/status +mode balanced · eco on · A\/B off · 🥇 L3 Groq Cloud/);
    expect(text).toMatch(/next +context is big: when this task is done, \/bouncer rescue → \/clear → paste/);
    expect(text).toMatch(/tips +end a prompt with " !" to skip checks/);
    expect(text).toMatch(/└ more +\/bouncer stats/);
  });

  it("suggests the fix that fits: slow AI, eco off; Codex gets terminal commands and /new", () => {
    const slow = renderFooter(stats, session({ ai: "fail-open", contextTokens: 50_000 }), gold, cfg());
    expect(slow).toContain("/bouncer config --timeout 4000");
    expect(slow).toContain("biggest saving → /bouncer eco on");
    const codex = renderFooter(stats, session({ platform: "codex", contextTokens: 240_000, contextWindow: 258_400 }), gold, cfg({ ecoContextTokens: 200_000 }));
    expect(codex).toContain("bouncer rescue → /new → paste");
    expect(codex).not.toContain("/bouncer");
  });
});
