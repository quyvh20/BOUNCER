---
layout: home
title: Save Tokens in Claude Code and Codex
description: Bouncer is a free, open-source hook for Claude Code and OpenAI Codex. It stops prompts that waste tokens (Opus on small tasks, bloated context, leaked secrets, huge pastes, vague asks) and rescues your session at the 5-hour limit.

hero:
  name: Bouncer
  text: Stop wasting AI coding tokens
  tagline: For Claude Code and OpenAI Codex. Checks every prompt before it is sent, stops the ones that waste your quota, and tells you exactly what to do instead. Free, open source, works offline, never touches your code.
  actions:
    - theme: brand
      text: Install in 1 minute
      link: /guide/installation
    - theme: alt
      text: 🦥 Let your agent install it
      link: '#lazy-install'
    - theme: alt
      text: How it works
      link: /guide/getting-started
    - theme: alt
      text: FAQ
      link: /guide/faq

features:
  - icon: 🌱
    title: Eco mode, the biggest saving
    details: Most of the bill is re-reading a long conversation on every call. Once a session is big, a new task is started in a fresh session with a handover already on your clipboard. Follow-ups are never interrupted.
    link: /guide/getting-started#eco-mode
    linkText: How eco works
  - icon: 🛑
    title: Opus guard, from the first prompt
    details: On Opus for a typo fix, in any language? Bouncer stops it while switching is still cheap. Type /model sonnet and paste, or just paste to keep Opus.
    link: /guide/getting-started#which-model-for-which-task
    linkText: Which model for which task
  - icon: 🔑
    title: Secrets never leave
    details: API keys, private keys and tokens are stopped before Claude or any AI sees them. Not even the ' !' skip lets them through.
  - icon: 🤨
    title: Prompt checks in any language
    details: Vague asks ("fix it", "sửa đi"), unscoped repo-wide reviews, huge pastes and log dumps get a clear message and a better way to ask.
    link: /guide/getting-started#modes
    linkText: What gets checked
  - icon: 🚨
    title: Rate-limit rescue
    details: Hit the 5-hour limit? A git-backed handover with your verbatim prompts, the changed files and the real diff lands on your clipboard. Continue in another account or tool.
    link: /guide/vip-evacuation-rescue
    linkText: See a handover
  - icon: 🛡️
    title: Safe, fast, honest
    details: Local checks take ~0.4 s, an AI is only asked when a decision needs it, and any error lets your prompt through. Savings you can measure on your own usage with an A/B test.
    link: /guide/safety-architecture
    linkText: Safety architecture
---

## 🦥 Lazy install: paste one prompt {#lazy-install}

Don't want to type commands? Pick your AI provider and model, copy the prompt, paste it into Claude Code, Codex, Cursor or any coding agent that can run shell commands, and let it do the setup. Not sure which model? The defaults are the [measured best picks](/unlock-gold/recommended-models).

<ClientOnly>
  <LazyPrompt />
</ClientOnly>

::: tip Why not paste the key into the chat?
Once installed, Bouncer blocks any prompt that contains an API key, so the agent hands you the command to run yourself. Your key never passes through the AI.
:::

## Install by hand

Needs [Node.js 18.17+](https://nodejs.org) and git. Full per-OS steps: [Installation & Requirements](/guide/installation).

```bash
git clone https://github.com/quyvh20/BOUNCER.git && cd BOUNCER
npm install && npm run build
node packages/cli/dist/index.js init                  # Claude Code
node packages/cli/dist/index.js init --target codex   # OpenAI Codex (optional)
```

Restart Claude Code, then try it: open a new session and send `fix it`. Bouncer stops it and explains why.

Works **100% offline** at 🥉 Level 1. Add a free Cloudflare, Groq or Gemini key to reach 🥇 Level 3 in about 30 seconds. [See how →](/unlock-gold/)

## What happens to a prompt

| You send | Bouncer |
|---|---|
| A normal prompt | Lets it through, adds a short note (task size, files to check first), and reports after the answer. |
| `fix the typo in README.md` on Opus | 🛑 Stops it: `/model sonnet` then paste, or just paste to keep Opus. |
| A new task in a 300k-token session (eco on) | 🌱 Stops it and puts a handover on your clipboard: `/clear`, paste, done. |
| A prompt with an API key | 🔑 Stops it. Always. |
| `fix it` as the first prompt | 🤨 Asks what exactly, with a clearer version on your clipboard. |
| Anything ending with ` !` | Lets it through untouched (except secrets). |

Blocks never cost you work: the prompt is always on your clipboard. [Every message explained →](/guide/getting-started#what-a-block-looks-like)
