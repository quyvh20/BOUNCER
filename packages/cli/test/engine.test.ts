// Automated safety & verification suite (SPEC §7, Phase 5: TC-01 … TC-10).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BouncerEngine,
  GitContext,
  RescueEngine,
  buildIntelligenceProfile,
  exitCodeFor,
  providerFromPreset,
  type BouncerEngineOptions,
  type Classifier,
  type ClassifierResponse,
  type GitRunner,
  type ProviderConfig,
} from "@bouncer/core";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";

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
    expect(r.systemDirective).toContain("Ground truth — files modified in git right now: @src/payment/stripe.ts");
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
    expect(r.systemDirective).toContain("no brevity or tool-call restrictions");
    expect(r.systemDirective).not.toMatch(/≤\d+ exploration tool calls/);
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
  it("generates a /clear handover for a >130KB transcript and copies it to the clipboard", async () => {
    const t = transcript("big.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", [{ type: "text", text: "x".repeat(140 * 1024) }]),
    ]);

    const r = await engine().evaluate(prompt("now add tests for the cart", { transcriptPath: t }));

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
    expect((await engine().evaluate(prompt("now add tests", { transcriptPath: bigFileSmallContext }))).action).toBe("allow");

    const smallFileBigContext = transcript("heavy.jsonl", [
      userMsg("Build the checkout page"),
      assistantMsg("claude-sonnet-4-5", undefined, { input_tokens: 2, cache_read_input_tokens: 170_000, cache_creation_input_tokens: 1_000 }),
    ]);
    const r = await engine().evaluate(prompt("now add tests", { transcriptPath: smallFileBigContext }));
    expect(r.blockCategory).toBe("context-bloat");
    expect(r.reason).toContain("~171k tokens");
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
