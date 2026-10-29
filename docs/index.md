---
layout: home
title: The Token Door-Guy for Claude Code
description: Bouncer is a free, open-source Claude Code hook that blocks Opus overkill, leaked secrets and context bloat, and rescues your session when the 5-hour rate limit hits.

hero:
  name: Bouncer
  text: The Token Door-Guy for Claude Code
  tagline: Keeps you in the coding flow when the 5-hour wall hits, without ever touching your codebase.
  actions:
    - theme: brand
      text: Install
      link: /guide/installation
    - theme: alt
      text: 🦥 Lazy install (1 paste)
      link: '#lazy-install'
    - theme: alt
      text: 🥇 Unlock Gold for free
      link: /unlock-gold/
    - theme: alt
      text: GitHub
      link: https://github.com/quyvh20/BOUNCER

features:
  - icon: 🛑
    title: Opus Overkill Guard
    details: Detects when you're on Opus (≈5x quota) for a typo fix, blocks it, and puts your exact prompt on the clipboard so you can switch to Sonnet and paste it back.
  - icon: 🔑
    title: Contraband Blocking
    details: API keys, private keys, tokens and giant pasted logs are stopped before Claude or any AI ever sees them.
  - icon: 🧹
    title: Crowd Control
    details: When a session's real context passes 75% of its window, Bouncer warns you (or, in strict mode, hands you a /clear-ready handover) so you stop paying to re-read the whole history.
  - icon: 🚨
    title: VIP Evacuation
    details: Hit the rate limit? A git-backed handover with your verbatim prompts, the modified files and the real diff lands on your clipboard. Continue in another account or tool.
  - icon: 🕵️
    title: Lean and fast
    details: Local checks take ~0.4 s. The optional AI is only asked when a decision needs it (a vague first prompt, or whether a prompt starts a new task), so everyday prompts aren't slowed down.
  - icon: 🛡️
    title: Zero-Damage Safety Laws
    details: AI file hints are checked against git ls-files and a confidence gate, never silently rewrite your prompt, and fail open in 1.5 s. Your project is only ever read.
---

## 🦥 Lazy install: paste one prompt {#lazy-install}

Don't want to type commands? Pick your AI provider and model, copy the prompt, paste it into Claude Code, Codex, Cursor or any coding agent that can run shell commands, and let it do the setup. Not sure which model? The defaults are the [measured best picks](/unlock-gold/recommended-models).

<ClientOnly>
  <LazyPrompt />
</ClientOnly>

::: tip Why not paste the key into the chat?
Once installed, Bouncer blocks any prompt that contains an API key, so the agent hands you the command to run yourself. Your key never passes through the AI.
:::

## 10-second install

```bash
git clone https://github.com/quyvh20/BOUNCER.git && cd BOUNCER
npm install && npm run build
node packages/cli/dist/index.js init
```

Works **100% offline** at 🥉 Level 1. Add a free Cloudflare, Groq or Gemini key to reach 🥇 Level 3 in about 30 seconds. [See how →](/unlock-gold/)
