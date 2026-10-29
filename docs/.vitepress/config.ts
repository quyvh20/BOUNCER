import { defineConfig } from "vitepress";
import { DESCRIPTION, OG_IMAGE, REPO_URL, SITE_URL, headFor, writeLlmsFiles } from "./seo";

export default defineConfig({
  title: "Bouncer",
  titleTemplate: ":title · Bouncer",
  description: DESCRIPTION,
  lang: "en-US",
  base: "/BOUNCER/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE_URL },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/BOUNCER/favicon.svg" }],
    ["link", { rel: "alternate", type: "text/plain", title: "llms.txt", href: "/BOUNCER/llms.txt" }],
    ["meta", { name: "theme-color", content: "#7c3aed" }],
    ["meta", { name: "author", content: "Quy Hoang" }],
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
    ["meta", { property: "og:image", content: OG_IMAGE }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:image:alt", content: "Bouncer: stop wasting AI coding tokens in Claude Code and Codex" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: OG_IMAGE }],
  ],

  // Per-page canonical URL, Open Graph/Twitter tags and schema.org JSON-LD.
  transformPageData(pageData, { siteConfig }) {
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(...headFor(pageData, siteConfig.srcDir));
  },

  // llms.txt and llms-full.txt, so AI assistants can read the docs in one go.
  buildEnd(siteConfig) {
    writeLlmsFiles(siteConfig);
  },

  themeConfig: {
    logo: { src: "/favicon.svg", alt: "Bouncer" },
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
      {
        text: "More",
        items: [
          { text: "CLAUDE.md Templates", link: "/guide/claude-md-templates" },
          { text: "About", link: "/about" },
          { text: "Privacy & Security", link: "/privacy" },
          { text: "Changelog", link: "/changelog" },
        ],
      },
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
      {
        text: "About the project",
        items: [
          { text: "About", link: "/about" },
          { text: "Privacy & Security", link: "/privacy" },
          { text: "Changelog", link: "/changelog" },
        ],
      },
    ],
    outline: { level: [2, 3], label: "On this page" },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPO_URL }],
    editLink: { pattern: `${REPO_URL}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
    lastUpdated: { text: "Last updated" },
    docFooter: { prev: "Previous", next: "Next" },
    footer: {
      message:
        'MIT License · Made by <a href="https://github.com/quyvh20">Quy Hoang</a> · <a href="/BOUNCER/about">About</a> · <a href="/BOUNCER/privacy">Privacy</a> · <a href="/BOUNCER/changelog">Changelog</a> · <a href="/BOUNCER/llms.txt">llms.txt</a>',
      copyright: "Provided \"AS IS\", without warranty of any kind.",
    },
  },
});
