# 🕶️ Bouncer: The Token Door-Guy for Claude Code

**Stop burning your Claude Code quota.** Bouncer is a free, open-source [Claude Code hook](https://docs.anthropic.com/en/docs/claude-code/hooks) that blocks Opus overkill, leaked secrets and context bloat, and rescues your session when the 5-hour rate limit hits. It never touches your codebase.

📖 **Docs:** https://quyvh20.github.io/BOUNCER/

## What it does

| | |
|---|---|
| 🛑 **Opus Overkill Guard** | You're on Opus for a typo fix (in any language)? Blocked while switching is still cheap. Your exact prompt goes to the clipboard so you can `/model sonnet` and paste it back. Rather not be stopped? `bouncer opus warn` sends it with a reminder. |
| 🔑 **Contraband blocking** | API keys, private keys, tokens and giant log dumps are stopped before any model sees them. |
| 🧹 **Crowd control** | Context past 75% of its window? A warning, or in strict mode a `/clear`-ready handover, so you stop paying to re-read history every turn. |
| 🚨 **Rate-limit rescue** | Hit the 5-hour wall? A git-backed handover with your verbatim prompts and the real diff is on your clipboard. |
| 🌱 **Eco mode** | New tasks start in a fresh, small context once a session passes 200k tokens. Follow-ups are never interrupted. |
| ⚡ **Lean** | Local checks take ~0.4 s; the optional AI is only asked when a decision needs it. |
| 🧭 **Git-truth hints** | Points Claude at files that are really modified or mentioned, all checked against `git ls-files`. |

## Install (from source, pre-release)

Needs Node.js 18.17+, git and Claude Code (CLI, desktop Code tab, VS Code or JetBrains) or OpenAI Codex (`bouncer init --target codex`). Cursor, Antigravity and claude.ai chat are not supported yet. Full guide: [Installation & Requirements](https://quyvh20.github.io/BOUNCER/guide/installation).


```bash
git clone https://github.com/quyvh20/BOUNCER.git
cd BOUNCER
npm install
npm run build
node packages/cli/dist/index.js init     # or: npm link -w @bouncer/cli && bouncer init
```

Restart Claude Code. Done: you're on 🥉 **Level 1**, 100% offline.

## Unlock 🥇 Level 3 for free

```bash
bouncer config --preset cloudflare-gold --account-id <ID>  # Mistral Small 3.1 on Workers AI (token in CLOUDFLARE_API_TOKEN)
bouncer config --preset groq-gold   --key <GROQ_KEY>     # Llama 3.3 70B
bouncer config --preset gemini-gold --key <GEMINI_KEY>   # Gemini 2.5 Flash
bouncer config --preset ollama-coder --model qwen2.5-coder:14b   # fully offline
```

| | 🥉 Bronze | 🥈 Silver | 🥇 Gold |
|---|:-:|:-:|:-:|
| Secret/log blocking, Opus guard, rescue | ✅ | ✅ | ✅ |
| Semantic complexity routing | regex | ✅ | ✅ |
| Semantic file resolution | — | ≥ 0.90 conf. | ≥ 0.80 conf. |
| AI summary in rescues | — | — | ✅ |

Not sure which? See the measured [recommended models](https://quyvh20.github.io/BOUNCER/unlock-gold/recommended-models).

## Commands

```text
bouncer all     # status, every command, setup links
bouncer init | config | rescue | stats | mode <strict|balanced|yolo> | reset | uninstall
```

After every answer Bouncer reports what it saved and why, how it routed the prompt, and your session and all-time totals. An always-visible status line shows the same at a glance.

**Biggest saving: `bouncer eco on`.** Re-reading a long context is most of the bill (~77% on the sessions we measured). Eco mode starts each *new* task in a fresh session with a handover once the context passes 200k tokens, and never interrupts follow-ups.

Want real numbers instead of estimates? `bouncer measure on` A/B-tests Bouncer's guidance on your own usage and reports the measured difference in `bouncer stats`.

End any prompt with ` !` to skip every check except the secret filter (`fix the flaky test !`). Bouncer then stops blocking that kind of prompt for the rest of the session.

## Safety first

1. AI-suggested files must exist in `git ls-files` **and** on disk. Hallucinations are stripped.
2. File hints are released only above a confidence threshold (0.80 Gold / 0.90 Silver).
3. Your prompt is never silently rewritten.
4. Hints are advisory: "check these first; if it's elsewhere, search for it".
5. MIT licensed, provided "AS IS", without warranty.

Bouncer fails open: if anything breaks or an AI is slower than 1.5 s, your prompt goes through untouched.

## Repository layout

```text
packages/core        @bouncer/core: host-agnostic engine
packages/cli         bouncer CLI + Claude Code adapter
packages/vscode-ext  VS Code extension skeleton
docs/                VitePress site (deployed to GitHub Pages)
```

## License

[MIT](./LICENSE)
