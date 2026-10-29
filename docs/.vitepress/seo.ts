// Structured data (schema.org JSON-LD) and AI-readable files (llms.txt) for the docs site.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HeadConfig, PageData, SiteConfig } from "vitepress";

export const SITE_URL = "https://quyvh20.github.io/BOUNCER/";
export const REPO_URL = "https://github.com/quyvh20/BOUNCER";
export const SITE_TITLE = "Bouncer: save tokens and quota in Claude Code and Codex";
export const DESCRIPTION =
  "Bouncer is a free, open-source hook for Claude Code and OpenAI Codex. It stops prompts that waste tokens (Opus on small tasks, bloated context, leaked secrets, huge pastes, vague asks) and rescues your session at the 5-hour limit.";
export const OG_IMAGE = `${SITE_URL}og.png`;
const VERSION = "0.1.0";

const AUTHOR = {
  "@type": "Person",
  "@id": `${SITE_URL}about#author`,
  name: "Quy Hoang",
  url: "https://github.com/quyvh20",
  sameAs: ["https://github.com/quyvh20"],
};

const SECTION: Record<string, [string, string]> = { guide: ["Guide", "guide/getting-started"], "unlock-gold": ["AI setup", "unlock-gold/"] };

/** Plain text from a Markdown fragment, for schema answers. */
function plain(md: string): string {
  return md
    .replace(/```[a-z]*\n([\s\S]*?)```/g, "$1")
    .replace(/:::[\s\S]*?:::/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/^\s*[-|].*$/gm, (l) => l.replace(/\|/g, " ").replace(/^\s*-\s*/, "• "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Question/answer pairs from "## Question" sections of a Markdown page. */
function faqFromMarkdown(src: string): { q: string; a: string }[] {
  const body = src.replace(/^---[\s\S]*?---/, "");
  return body
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [q, ...rest] = block.split("\n");
      return { q: q!.trim(), a: plain(rest.join("\n")).slice(0, 900) };
    })
    .filter((x) => x.q.endsWith("?") && x.a);
}

const INSTALL_STEPS = [
  ["Check the requirements", "Install Node.js 18.17 or newer and git, and use Claude Code v2.1.251+ or OpenAI Codex."],
  ["Get the code", "Run: git clone https://github.com/quyvh20/BOUNCER.git && cd BOUNCER"],
  ["Build it", "Run: npm install && npm run build"],
  ["Install the hooks", "Run: node packages/cli/dist/index.js init (add --target codex for OpenAI Codex)."],
  ["Restart and test", "Restart Claude Code, open a new session and send 'fix it'. Bouncer stops it and explains why."],
];

export function jsonLdFor(page: PageData, srcDir: string): object[] {
  const path = page.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
  const url = `${SITE_URL}${path}`;
  const out: object[] = [];

  if (path === "") {
    out.push(
      { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE_URL}#website`, name: "Bouncer", url: SITE_URL, description: DESCRIPTION, inLanguage: "en", publisher: AUTHOR },
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}#software`,
        name: "Bouncer",
        alternateName: ["Bouncer for Claude Code", "Bouncer for OpenAI Codex"],
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Claude Code hook",
        operatingSystem: "Windows, macOS, Linux",
        softwareVersion: VERSION,
        softwareRequirements: "Node.js 18.17+, git, Claude Code v2.1.251+ or OpenAI Codex",
        description: DESCRIPTION,
        url: SITE_URL,
        downloadUrl: REPO_URL,
        codeRepository: REPO_URL,
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: AUTHOR,
        image: OG_IMAGE,
        featureList: [
          "Eco mode: new tasks start in a fresh, small context",
          "Opus guard: stops Opus on small tasks from the first prompt",
          "Blocks leaked API keys, tokens and private keys",
          "Flags vague prompts, repo-wide asks and huge pastes in any language",
          "Rate-limit rescue handover with verbatim prompts and git state",
          "Model and effort advice per task",
          "A/B measurement of real token savings",
          "Works offline; optional free AI (Cloudflare, Groq, Gemini, Ollama)",
        ],
      },
    );
    return out;
  }

  const section = SECTION[path.split("/")[0]!];
  out.push({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Bouncer", item: SITE_URL },
      ...(section ? [{ "@type": "ListItem", position: 2, name: section[0], item: `${SITE_URL}${section[1]}` }] : []),
      { "@type": "ListItem", position: section ? 3 : 2, name: page.title, item: url },
    ],
  });
  out.push({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.title,
    description: page.description || DESCRIPTION,
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    image: OG_IMAGE,
    author: AUTHOR,
    publisher: AUTHOR,
    datePublished: "2026-10-29",
    ...(page.lastUpdated ? { dateModified: new Date(page.lastUpdated).toISOString() } : {}),
    about: { "@id": `${SITE_URL}#software` },
  });

  if (page.frontmatter.faq) {
    const qa = faqFromMarkdown(readFileSync(join(srcDir, page.relativePath), "utf8"));
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: qa.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    });
  }
  if (page.frontmatter.howto) {
    out.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "How to install Bouncer for Claude Code and Codex",
      description: page.description,
      totalTime: "PT2M",
      tool: ["Node.js 18.17+", "git", "Claude Code or OpenAI Codex"],
      step: INSTALL_STEPS.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text, url })),
    });
  }
  if (path === "about") {
    out.push({ "@context": "https://schema.org", "@type": "AboutPage", url, mainEntity: AUTHOR });
  }
  return out;
}

export function headFor(page: PageData, srcDir: string): HeadConfig[] {
  const path = page.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
  const url = `${SITE_URL}${path}`;
  const title = path === "" ? SITE_TITLE : `${page.title} · Bouncer`;
  const description = page.description || DESCRIPTION;
  const head: HeadConfig[] = [
    ["link", { rel: "canonical", href: url }],
    ["meta", { property: "og:url", content: url }],
    ["meta", { property: "og:title", content: title }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { name: "twitter:title", content: title }],
    ["meta", { name: "twitter:description", content: description }],
  ];
  if (page.lastUpdated) head.push(["meta", { property: "article:modified_time", content: new Date(page.lastUpdated).toISOString() }]);
  for (const data of jsonLdFor(page, srcDir)) head.push(["script", { type: "application/ld+json" }, JSON.stringify(data)]);
  return head;
}

// ---------------------------------------------------------------- llms.txt
const LLMS_SECTIONS: [string, [string, string, string][]][] = [
  [
    "Start here",
    [
      ["Installation & Requirements", "guide/installation", "Requirements, supported tools (Claude Code, Codex), per-OS install, troubleshooting."],
      ["Getting Started", "guide/getting-started", "The after-answer report, eco mode, model advice, A/B measurement, commands, modes, block messages."],
      ["FAQ", "guide/faq", "Why a prompt was blocked, how to send it anyway, whether it saves tokens, privacy, speed."],
    ],
  ],
  [
    "How it works",
    [
      ["Safety Architecture", "guide/safety-architecture", "The evaluation pipeline, the 5 safety laws and the quality guards."],
      ["Rate-Limit Rescue", "guide/vip-evacuation-rescue", "The git-backed handover built when the 5-hour limit hits."],
      ["CLAUDE.md Templates", "guide/claude-md-templates", "Copy-paste CLAUDE.md and .claudeignore rules that cut token use."],
    ],
  ],
  [
    "Optional AI setup",
    [
      ["Bronze vs Silver vs Gold", "unlock-gold/", "What connecting a free AI adds."],
      ["Recommended models", "unlock-gold/recommended-models", "Measured benchmark of 14 models."],
      ["Cloudflare Workers AI", "unlock-gold/cloudflare-workers-ai", "Free setup, default Mistral Small 3.1."],
      ["Groq", "unlock-gold/groq-70b-free", "Free Llama 3.3 70B."],
      ["Gemini", "unlock-gold/gemini-flash-free", "Free Gemini 2.5 Flash."],
      ["Ollama", "unlock-gold/ollama-local", "100% offline."],
    ],
  ],
  [
    "Trust",
    [
      ["About", "about", "Who builds it, how the numbers were measured, honest limits."],
      ["Privacy & Security", "privacy", "What is read, stored and sent; API keys; reporting vulnerabilities."],
      ["Changelog", "changelog", "Notable changes."],
    ],
  ],
];

const LLMS_INTRO = `# Bouncer

> ${DESCRIPTION}

Bouncer is a set of hooks (UserPromptSubmit, Stop, SessionStart, PostModelSwitch) installed by \`bouncer init\`. It checks each prompt before Claude Code or Codex sends it. It never edits code or prompts: it lets a prompt through with a short advisory note, or stops it and puts the prompt (or a handover) on the clipboard with one clear next step. Ending a prompt with " !" skips every check except secret blocking. It runs offline by default; a free AI (Cloudflare Workers AI, Groq, Gemini, Ollama) is optional and only asked when a decision depends on it.

Key facts:
- Free and open source (MIT). Version ${VERSION}, installed from source: ${REPO_URL}
- Requirements: Node.js 18.17+, git, Claude Code v2.1.251+ (CLI, desktop Code tab, VS Code, JetBrains) or OpenAI Codex. Not supported: Cursor, Gemini CLI, Antigravity, claude.ai chat.
- Biggest saving: eco mode (\`bouncer eco on\`). In 144 measured sessions 77% of cost was re-reading context; keeping it under 200k gives up to 44% lower cost.
- Model advice: TRIVIAL → Haiku/low, STANDARD → Sonnet/medium, COMPLEX → Opus/high. Hooks cannot switch models; Bouncer tells the user the command.
- Savings shown are estimates; \`bouncer measure on\` measures real savings with an A/B test.
`;

/** Writes llms.txt (an index for AI assistants) and llms-full.txt (every page as Markdown). */
export function writeLlmsFiles(siteConfig: SiteConfig): void {
  const index = [LLMS_INTRO];
  const full = [LLMS_INTRO];
  for (const [section, pages] of LLMS_SECTIONS) {
    index.push(`## ${section}\n`);
    for (const [title, path, note] of pages) {
      index.push(`- [${title}](${SITE_URL}${path}): ${note}`);
      const file = path.endsWith("/") ? `${path}index.md` : `${path}.md`;
      try {
        const md = readFileSync(join(siteConfig.srcDir, file), "utf8").replace(/^---[\s\S]*?---\s*/, "");
        full.push(`\n---\n\nSource: ${SITE_URL}${path}\n\n${md.replace(/<ClientOnly>[\s\S]*?<\/ClientOnly>/g, "")}`);
      } catch {
        /* page missing: index entry only */
      }
    }
    index.push("");
  }
  index.push(`## Optional\n\n- [Full documentation in one file](${SITE_URL}llms-full.txt)\n- [Source code](${REPO_URL})\n`);
  writeFileSync(join(siteConfig.outDir, "llms.txt"), index.join("\n"), "utf8");
  writeFileSync(join(siteConfig.outDir, "llms-full.txt"), full.join("\n"), "utf8");
}
