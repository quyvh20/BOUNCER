<script setup lang="ts">
// Picklist that builds the one-paste install prompt for the provider/model the reader wants.
import { computed, ref, watch } from "vue";

interface ModelOption {
  id: string;
  label: string;
  note?: string;
  timeoutMs?: number;
}
interface Provider {
  id: string;
  label: string;
  preset?: string;
  keyEnv?: string;
  keyUrl?: string;
  guide?: string;
  needsAccountId?: boolean;
  models: ModelOption[];
}

const DOCS = "https://quyvh20.github.io/BOUNCER";

// Recommendations follow the measured benchmark on /unlock-gold/recommended-models.
const PROVIDERS: Provider[] = [
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI (free daily allocation)",
    preset: "cloudflare-gold",
    keyEnv: "CLOUDFLARE_API_TOKEN",
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    guide: `${DOCS}/unlock-gold/cloudflare-workers-ai`,
    needsAccountId: true,
    models: [
      { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 24B", note: "recommended · most reliable (20/20 within 3 s)" },
      { id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", note: "accurate, occasional timeouts" },
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B", note: "accurate but ~3 s, needs a 4 s budget", timeoutMs: 4000 },
    ],
  },
  {
    id: "groq",
    label: "Groq (free tier, lowest latency)",
    preset: "groq-gold",
    keyEnv: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
    guide: `${DOCS}/unlock-gold/groq-70b-free`,
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", note: "recommended · 🥇 Gold" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", note: "fastest · 🥈 Silver, fewer file hints" },
    ],
  },
  {
    id: "gemini",
    label: "Google AI Studio · Gemini (free tier)",
    preset: "gemini-gold",
    keyEnv: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    guide: `${DOCS}/unlock-gold/gemini-flash-free`,
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "recommended · 🥇 Gold" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", note: "faster · 🥈 Silver" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (100% offline, your GPU)",
    preset: "ollama-coder",
    guide: `${DOCS}/unlock-gold/ollama-local`,
    models: [
      { id: "qwen2.5-coder:14b", label: "Qwen2.5-Coder 14B", note: "recommended · 🥇 Gold, needs a GPU" },
      { id: "qwen2.5-coder:7b", label: "Qwen2.5-Coder 7B", note: "lighter · 🥈 Silver" },
    ],
  },
  {
    id: "custom",
    label: "Any OpenAI-compatible endpoint",
    models: [],
  },
  {
    id: "none",
    label: "No AI: 🥉 Level 1, fully offline",
    models: [],
  },
];

const MODES = [
  { id: "balanced", label: "balanced (default): blocks clear waste, never gets in the way" },
  { id: "strict", label: "strict: also blocks vague prompts mid-session and Opus on standard work" },
  { id: "yolo", label: "yolo: only blocks leaked secrets" },
];

const providerId = ref("cloudflare");
const modelId = ref(PROVIDERS[0]!.models[0]!.id);
const customUrl = ref("https://api.example.com/v1/chat/completions");
const customModel = ref("my-model");
const TARGETS = [
  { id: "claude", label: "Claude Code (CLI, desktop Code tab, VS Code, JetBrains)" },
  { id: "codex", label: "OpenAI Codex" },
  { id: "all", label: "Both Claude Code and Codex" },
];

const target = ref("claude");
const mode = ref("balanced");
const report = ref(true);
const ecoOn = ref(true);
const copied = ref(false);

const provider = computed(() => PROVIDERS.find((p) => p.id === providerId.value)!);
const model = computed(() => provider.value.models.find((m) => m.id === modelId.value));
watch(providerId, () => {
  modelId.value = provider.value.models[0]?.id ?? "";
});

function keySteps(p: Provider, configCmd: string): string {
  return `Do NOT ask me to paste the key into this chat. Instead, tell me to get it at ${p.keyUrl} (guide: ${p.guide}), then give me the exact lines for MY shell to run in my own terminal, which read the key into an environment variable and then configure Bouncer:
   - PowerShell: $env:${p.keyEnv} = Read-Host "Paste key"   (the key goes AFTER this prompt appears, never inside the quotes)
   - bash/zsh: read -rs ${p.keyEnv} && export ${p.keyEnv}
   - then, in the same window: ${configCmd}
   Bouncer tests the connection and prints the measured latency. Wait until I say it worked.`;
}

const aiStep = computed(() => {
  const p = provider.value;
  if (p.id === "none") return "Skip AI setup: I want Level 1, which works fully offline. Mention that I can add a free AI later (guide: " + DOCS + "/unlock-gold/).";
  if (p.id === "custom") {
    return `Connect my OpenAI-compatible endpoint. Do NOT ask me to paste the API key into this chat. Give me this command to run in my own terminal, with my key in place of <KEY>:
   bouncer config --url ${customUrl.value} --model ${customModel.value} --name "My provider" --key <KEY>
   If my endpoint needs no key, I can drop --key. Bouncer tests the connection and prints the measured latency.`;
  }
  const m = model.value!;
  const timeout = m.timeoutMs ? ` --timeout ${m.timeoutMs}` : "";
  if (p.id === "ollama") {
    return `Set up local AI with Ollama (guide: ${p.guide}): check that \`ollama\` is installed (if not, tell me how to install it and stop), run \`ollama pull ${m.id}\`, then run \`bouncer config --preset ${p.preset} --model ${m.id}${timeout}\`.`;
  }
  const account = p.needsAccountId ? " --account-id <MY_ACCOUNT_ID>" : "";
  const cmd = `bouncer config --preset ${p.preset}${account} --model ${m.id}${timeout}`;
  const accountHint = p.needsAccountId ? `\n   My Cloudflare account ID is the 32-character hex string in my dashboard URL (dash.cloudflare.com/<account-id>/…); it is not secret, so I can paste it here. The API token must use the "Workers AI" template.` : "";
  return `Connect ${p.label.split(" (")[0]} with the model ${m.label} (${m.id}).${accountHint}\n   ${keySteps(p, cmd)}`;
});

const hostName = computed(() => (target.value === "codex" ? "OpenAI Codex" : target.value === "all" ? "Claude Code and OpenAI Codex" : "Claude Code"));

const initStep = computed(() => {
  const claude = "Run `bouncer init`. It backs up ~/.claude/settings.json and adds the hooks itself, so do NOT edit settings.json by hand.";
  const codex = "It writes ~/.codex/hooks.json itself (backing up any existing one), so do NOT edit Codex config by hand.";
  if (target.value === "codex") return `Run \`bouncer init --target codex\`. ${codex}`;
  if (target.value === "all") return `Run \`bouncer init --target all\`. It installs the hooks in Claude Code (~/.claude/settings.json, backed up first) and in Codex (~/.codex/hooks.json). ${codex.replace("It writes ~/.codex/hooks.json itself (backing up any existing one), so do", "Do")}`;
  return claude;
});

const restartStep = computed(() => {
  const claude = "Tell me to restart Claude Code (or open a new session) so the hooks take effect.";
  const codex = "Tell me that Codex only runs new hooks after I trust them: I must start Codex, run `/hooks` and trust the two Bouncer hooks (in the Codex app, accept the hook prompt or restart it).";
  if (target.value === "codex") return codex;
  if (target.value === "all") return `${claude} ${codex}`;
  return claude;
});

const prompt = computed(() => {
  const steps = [
    "Check that Node.js 18.17+ and git are installed (`node -v`, `git -v`). If not, tell me how to install them and stop.",
    "Clone https://github.com/quyvh20/BOUNCER.git into a folder named BOUNCER in my home directory. If it already exists, run `git pull` there instead.",
    "In that folder run `npm install`, then `npm run build`.",
    "Run `npm link -w @bouncer/cli` so `bouncer` is on my PATH. If that fails (e.g. permissions), don't use sudo: use `node <BOUNCER folder>/packages/cli/dist/index.js` everywhere I write `bouncer` below.",
    initStep.value,
    aiStep.value,
  ];
  if (mode.value !== "balanced") steps.push(`Run \`bouncer mode ${mode.value}\`.`);
  if (ecoOn.value) steps.push("Run `bouncer eco on` (new tasks start in a fresh, small context once a session passes 200k tokens; follow-ups are never interrupted).");
  if (!report.value) steps.push("Run `bouncer config --footer off` (I don't want the savings report after each answer).");
  steps.push("Run `bouncer all` and show me the output.", restartStep.value);
  return `Install Bouncer (https://github.com/quyvh20/BOUNCER), the token guard for ${hostName.value}, on this machine. Do these steps in order, run each command yourself, and stop to tell me if one fails:\n\n${steps
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n")}`;
});

async function copy() {
  try {
    await navigator.clipboard.writeText(prompt.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div class="lazy">
    <div class="lazy-grid">
      <label>
        <span>Install into</span>
        <select v-model="target">
          <option v-for="t in TARGETS" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
      </label>
      <label>
        <span>AI provider</span>
        <select v-model="providerId">
          <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <label v-if="provider.models.length">
        <span>Model</span>
        <select v-model="modelId">
          <option v-for="m in provider.models" :key="m.id" :value="m.id">{{ m.label }}{{ m.note ? ` — ${m.note}` : "" }}</option>
        </select>
      </label>
      <template v-if="provider.id === 'custom'">
        <label>
          <span>Endpoint URL</span>
          <input v-model="customUrl" spellcheck="false" />
        </label>
        <label>
          <span>Model name</span>
          <input v-model="customModel" spellcheck="false" />
        </label>
      </template>
      <label>
        <span>Mode</span>
        <select v-model="mode">
          <option v-for="m in MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </label>
      <label class="lazy-check">
        <input v-model="ecoOn" type="checkbox" />
        <span>🌱 Eco mode (biggest saving)</span>
      </label>
      <label class="lazy-check">
        <input v-model="report" type="checkbox" />
        <span>Savings report after each answer</span>
      </label>
    </div>
    <div class="lazy-out">
      <button class="lazy-copy" type="button" @click="copy">{{ copied ? "Copied ✓" : "Copy prompt" }}</button>
      <pre>{{ prompt }}</pre>
    </div>
  </div>
</template>

<style scoped>
.lazy {
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
}
.lazy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px 16px;
  padding: 16px;
  background: var(--vp-c-bg-soft);
}
.lazy-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  min-width: 0;
}
.lazy-grid label > span {
  color: var(--vp-c-text-2);
  font-weight: 600;
}
.lazy-grid select,
.lazy-grid input:not([type="checkbox"]) {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
}
.lazy-check {
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
  align-self: end;
}
.lazy-out {
  position: relative;
  background: var(--vp-code-block-bg);
}
.lazy-out pre {
  margin: 0;
  padding: 44px 16px 16px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
}
.lazy-copy {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.lazy-copy:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
</style>
