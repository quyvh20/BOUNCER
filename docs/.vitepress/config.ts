import { defineConfig, type HeadConfig } from "vitepress";

const SITE_URL = "https://quyvh20.github.io/BOUNCER/";
const REPO_URL = "https://github.com/quyvh20/BOUNCER";
const SITE_TITLE = "Bouncer: save Claude Code tokens and quota";
const DESCRIPTION =
  "Bouncer is a free, open-source hook for Claude Code and OpenAI Codex. It stops prompts that waste tokens (Opus on small tasks, bloated context, leaked secrets, huge pastes, vague asks) and rescues your session at the 5-hour limit.";

// Structured data for search engines: what Bouncer is, that it's free, where it runs.
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Bouncer",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Windows, macOS, Linux",
  description: DESCRIPTION,
  url: SITE_URL,
  codeRepository: REPO_URL,
  license: "https://opensource.org/licenses/MIT",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
});

export default defineConfig({
  title: "Bouncer",
  titleTemplate: ":title · Bouncer for Claude Code",
  description: DESCRIPTION,
  lang: "en-US",
  base: "/BOUNCER/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE_URL },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/BOUNCER/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#7c3aed" }],
    [
      "meta",
      {
        name: "keywords",
        content:
          "Claude Code, save tokens, token usage, rate limit, 5-hour limit, quota, Opus, Sonnet, Haiku, OpenAI Codex, hooks, CLAUDE.md, context window, prompt cache",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Bouncer" }],
    ["meta", { name: "twitter:card", content: "summary" }],
  ],

  // Per-page canonical URL, Open Graph and Twitter tags, so shared links show the page's own title.
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
    const url = `${SITE_URL}${path}`;
    const isHome = path === "";
    const title = isHome ? SITE_TITLE : `${pageData.title} · Bouncer for Claude Code`;
    const description = pageData.description || DESCRIPTION;
    const head: HeadConfig[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
    ];
    if (isHome) head.push(["script", { type: "application/ld+json" }, JSON_LD]);
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(...head);
  },

  themeConfig: {
    logo: { text: "🕶️" },
    nav: [
      { text: "Install", link: "/guide/installation" },
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/(getting-started|safety|vip|claude-md)" },
      { text: "FAQ", link: "/guide/faq" },
      {
        text: "AI setup",
        activeMatch: "/unlock-gold/",
        items: [
          { text: "🥇 Bronze vs Silver vs Gold", link: "/unlock-gold/" },
          { text: "⭐ Recommended models", link: "/unlock-gold/recommended-models" },
          { text: "Cloudflare Workers AI (free)", link: "/unlock-gold/cloudflare-workers-ai" },
          { text: "Groq Llama 3.3 70B (free)", link: "/unlock-gold/groq-70b-free" },
          { text: "Gemini 2.5 Flash (free)", link: "/unlock-gold/gemini-flash-free" },
          { text: "Ollama (100% offline)", link: "/unlock-gold/ollama-local" },
        ],
      },
      { text: "Templates", link: "/guide/claude-md-templates" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Installation & Requirements", link: "/guide/installation" },
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "FAQ", link: "/guide/faq" },
        ],
      },
      {
        text: "How it works",
        items: [
          { text: "Safety Architecture", link: "/guide/safety-architecture" },
          { text: "Rate-Limit Rescue", link: "/guide/vip-evacuation-rescue" },
          { text: "CLAUDE.md & .claudeignore Templates", link: "/guide/claude-md-templates" },
        ],
      },
      {
        text: "AI setup (optional)",
        items: [
          { text: "Bronze vs Silver vs Gold", link: "/unlock-gold/" },
          { text: "⭐ Recommended models", link: "/unlock-gold/recommended-models" },
          { text: "Cloudflare Workers AI (free)", link: "/unlock-gold/cloudflare-workers-ai" },
          { text: "Groq Llama 3.3 70B (free)", link: "/unlock-gold/groq-70b-free" },
          { text: "Gemini 2.5 Flash (free)", link: "/unlock-gold/gemini-flash-free" },
          { text: "Ollama (100% offline)", link: "/unlock-gold/ollama-local" },
        ],
      },
    ],
    outline: { level: [2, 3], label: "On this page" },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPO_URL }],
    editLink: { pattern: `${REPO_URL}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
    docFooter: { prev: "Previous", next: "Next" },
    footer: {
      message: "Released under the MIT License. Provided \"AS IS\", without warranty of any kind.",
      copyright: "Bouncer contributors",
    },
  },
});
