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
import { DOC_PAGES, link, renderFooter, renderStatusLine } from "../src/stats-ui.js";

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
    expect(text).toMatch(/route\s+STANDARD → Sonnet\/medium · you're on Opus · 🥇 L3 AI ✓ · 2 modified files pointed out · context 42\.0k/);
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
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, vague: true });
    const r = await engine({ classifier }).evaluate(prompt("rekebisha hii"));
    expect(r.blockCategory).toBe("vague-prompt");
    const { classifier: broad } = mockClassifier({ complexity: "COMPLEX", matchedFiles: [], confidence: 0.5, broadScope: true });
    const b = await engine({ classifier: broad, gitFactory: bigGit }).evaluate(prompt("kagua msimbo wote wa mradi"));
    expect(b.blockCategory).toBe("broad-scope");
  });

  it("ignores an AI 'vague' verdict on a long or anchored prompt (quality guard)", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, vague: true });
    expect((await engine({ classifier }).evaluate(prompt("rekebisha kosa la 404 kwenye ukurasa wa kuingia"))).action).toBe("allow");
  });
});

describe("Classifier contract tolerance", () => {
  it("keeps vague/broadScope when a small model answers complexity 'VAGUE', with zero confidence", () => {
    const r = parseClassifierResponse({ complexity: "VAGUE", matchedFiles: ["src/app.ts"], confidence: 0.9, vague: true });
    expect(r).toMatchObject({ complexity: "STANDARD", confidence: 0, vague: true });
    expect(parseClassifierResponse({ complexity: "HUGE", confidence: 0.9 })).toBeNull();
  });
});

describe("AI vague verdict is limited to very short prompts", () => {
  it("does not block a full question even if the AI calls it vague", async () => {
    const { classifier } = mockClassifier({ complexity: "STANDARD", matchedFiles: [], confidence: 0.5, vague: true });
    expect((await engine({ classifier }).evaluate(prompt("đánh giá xem có giảm chất lượng công việc không?"))).action).toBe("allow");
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
