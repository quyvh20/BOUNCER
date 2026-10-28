import { defineConfig } from "vitepress";

const SITE_URL = "https://quyvh20.github.io/BOUNCER/";
const REPO_URL = "https://github.com/quyvh20/BOUNCER";
const DESCRIPTION =
  "Bouncer is an open-source token door-guy for Claude Code: it blocks Opus overkill, leaked secrets and context bloat, and rescues your session when the 5-hour rate limit hits.";

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
    ["meta", { name: "theme-color", content: "#7c3aed" }],
    ["meta", { name: "keywords", content: "Claude Code, token usage, rate limit, Opus, Sonnet, Haiku, CLAUDE.md, hooks, Groq, Gemini, Ollama" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Bouncer" }],
    ["meta", { property: "og:title", content: "Bouncer — The Token Door-Guy for Claude Code" }],
    ["meta", { property: "og:description", content: DESCRIPTION }],
    ["meta", { property: "og:url", content: SITE_URL }],
    ["meta", { name: "twitter:card", content: "summary" }],
    ["meta", { name: "twitter:title", content: "Bouncer — The Token Door-Guy for Claude Code" }],
    ["meta", { name: "twitter:description", content: DESCRIPTION }],
  ],

  // Per-page canonical URLs for SEO.
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(["link", { rel: "canonical", href: `${SITE_URL}${path}` }]);
  },

  themeConfig: {
    logo: { text: "🕶️" },
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "🥇 Unlock Gold", link: "/unlock-gold/", activeMatch: "/unlock-gold/" },
      { text: "CLAUDE.md Templates", link: "/guide/claude-md-templates" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Safety Architecture", link: "/guide/safety-architecture" },
          { text: "VIP Evacuation (Rescue)", link: "/guide/vip-evacuation-rescue" },
          { text: "CLAUDE.md & .claudeignore Templates", link: "/guide/claude-md-templates" },
        ],
      },
      {
        text: "Unlock 🥇 Level 3",
        items: [
          { text: "Bronze vs Silver vs Gold", link: "/unlock-gold/" },
          { text: "Groq Llama 3.3 70B (free)", link: "/unlock-gold/groq-70b-free" },
          { text: "Gemini 2.5 Flash (free)", link: "/unlock-gold/gemini-flash-free" },
          { text: "Cloudflare Workers AI (free)", link: "/unlock-gold/cloudflare-workers-ai" },
          { text: "Ollama (100% offline)", link: "/unlock-gold/ollama-local" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPO_URL }],
    editLink: { pattern: `${REPO_URL}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
    footer: {
      message: "Released under the MIT License. Provided \"AS IS\", without warranty of any kind.",
      copyright: "Bouncer contributors",
    },
  },
});
