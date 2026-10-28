# 🕶️ Bouncer: The Token Door-Guy for Claude Code

**Stop burning your Claude Code quota.** Bouncer is a free, open-source [Claude Code hook](https://docs.anthropic.com/en/docs/claude-code/hooks) that blocks Opus overkill, leaked secrets and context bloat, and rescues your session when the 5-hour rate limit hits. It never touches your codebase.

📖 **Docs:** https://quyvh20.github.io/BOUNCER/

## What it does

| | |
|---|---|
| 🛑 **Opus Overkill Guard** | You're on Opus (≈5x quota) for a typo fix? Blocked. Your exact prompt goes to the clipboard so you can `/model sonnet` and paste it back. |
| 🔑 **Contraband blocking** | API keys, private keys, tokens and giant log dumps are stopped before any model sees them. |
| 🧹 **Crowd control** | Context over 150k tokens? Get a `/clear`-ready handover instead of paying to re-read history every turn. |
| 🚨 **Rate-limit rescue** | Hit the 5-hour wall? A git-backed handover with your verbatim prompts and the real diff is on your clipboard. |
| 🕵️ **Haiku scout** | A `bouncer-scout` subagent pinned to Haiku handles broad file searches. |
| 🧭 **Git-truth hints** | Points Claude at files that are really modified or mentioned, all checked against `git ls-files`. |

## Install (from source, pre-release)

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
bouncer config --preset cloudflare-gold --account-id <ID>  # Llama 4 Scout on Workers AI (token in CLOUDFLARE_API_TOKEN)
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

After every Claude answer, Bouncer prints one line with the tokens saved this prompt, this session and in total.

End any prompt with ` !` to skip every check except the secret filter (`fix the flaky test !`). Bouncer then stops blocking that kind of prompt for the rest of the session.

## Safety first

1. AI-suggested files must exist in `git ls-files` **and** on disk. Hallucinations are stripped.
2. File hints are released only above a confidence threshold (0.80 Gold / 0.90 Silver).
3. Your prompt is never silently rewritten.
4. Hints are advisory: "check these first; if it's elsewhere, delegate search to `bouncer-scout`".
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
