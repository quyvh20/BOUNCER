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
      text: Get Started
      link: /guide/getting-started
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
    details: Once a session's real context passes 150k tokens, Bouncer hands you a /clear-ready handover so every next turn stops re-reading the whole history.
  - icon: 🚨
    title: VIP Evacuation
    details: Hit the rate limit? A git-backed handover with your verbatim prompts, the modified files and the real diff lands on your clipboard. Continue in another account or tool.
  - icon: 🕵️
    title: Haiku Scout
    details: Installs a bouncer-scout subagent pinned to Haiku, so broad file searches don't burn your Sonnet or Opus context.
  - icon: 🛡️
    title: Zero-Damage Safety Laws
    details: AI file hints are checked against git ls-files and a confidence gate, never silently rewrite your prompt, and fail open in 1.5 s. Your project is only ever read.
---

## 🦥 Lazy install: paste one prompt {#lazy-install}

Don't want to type commands? Copy this prompt (button in the top-right corner), paste it into Claude Code, Codex, Cursor or any coding agent that can run shell commands, and let it do the setup.

<div class="wrap-code">

```text
Install Bouncer (https://github.com/quyvh20/BOUNCER), the token guard for Claude Code, on this machine. Do these steps in order, run each command yourself, and stop to tell me if one fails:

1. Check that Node.js 18.17+ and git are installed (`node -v`, `git -v`). If not, tell me how to install them and stop.
2. Clone https://github.com/quyvh20/BOUNCER.git into a folder named BOUNCER in my home directory. If it already exists, run `git pull` there instead.
3. In that folder run `npm install`, then `npm run build`.
4. Run `npm link -w @bouncer/cli` so `bouncer` is on my PATH. If that fails (e.g. permissions), don't use sudo: use `node <BOUNCER folder>/packages/cli/dist/index.js` everywhere I write `bouncer` below.
5. Run `bouncer init`. It backs up ~/.claude/settings.json and adds the hooks itself, so do NOT edit settings.json by hand.
6. Ask me whether I want the free 🥇 Gold level (needs a free Groq, Gemini or Cloudflare key). Do NOT ask me to paste the key into this chat. Instead, give me the exact command to run in my own terminal, e.g. `bouncer config --preset groq-gold --key <MY_KEY>` (or `gemini-gold`, or `cloudflare-gold --account-id <ID> --key <TOKEN>`). Key links: https://console.groq.com/keys · https://aistudio.google.com/apikey. If I say no, skip this: Level 1 works fully offline.
7. Run `bouncer all` and show me the output.
8. Tell me to restart Claude Code (or open a new session) so the hooks take effect.
```

</div>

::: tip Why not paste the key into the chat?
Once installed, Bouncer blocks any prompt that contains an API key, so the agent hands you the command to run yourself. Your key never passes through the AI.
:::

## 10-second install

```bash
git clone https://github.com/quyvh20/BOUNCER.git && cd BOUNCER
npm install && npm run build
node packages/cli/dist/index.js init
```

Works **100% offline** at 🥉 Level 1. Add a free Groq or Gemini key to reach 🥇 Level 3 in about 30 seconds. [See how →](/unlock-gold/)
