---
title: Privacy & Security
description: What Bouncer reads, what it stores on your machine, what (if anything) it sends to an AI provider, how API keys are handled, and how to report a security problem.
---

# Privacy & Security

## In short

- **No telemetry.** Bouncer never phones home. There is no Bouncer server.
- **Offline by default.** At 🥉 Level 1 nothing leaves your machine.
- **Your code is only read, never changed.** Bouncer reads `git status`, `git ls-files` and the session transcript; it writes only to its own folder and, on `init`, to the tool's settings file.
- **Secrets are stopped first.** A prompt containing an API key, private key or token is blocked before any model, including the optional AI, sees it. The ` !` skip doesn't change that.

## What Bouncer reads

| What | Why |
|---|---|
| The prompt you're sending | To check it. |
| The session transcript (`~/.claude/projects/…` or `~/.codex/sessions/…`) | Context size, current model, recent prompts for handovers, real token usage for the A/B test. |
| `git status`, `git ls-files`, `git diff --stat` | To point Claude at files you changed, and to verify any file name an AI suggests actually exists. |
| The Claude Code process command line (`$CLAUDE_PID`) | Only the `--model` value, once per session, when Claude Code doesn't report the model itself. |

## What it stores (on your machine only)

Everything is in `~/.bouncer/`:

- `config.json`: your settings, and the AI provider's URL, model and key if you connected one.
- `stats.json`: counts of checked and blocked prompts, estimates, A/B and eco numbers, and per-session state (no prompt text).
- Handovers you generate.

Delete the folder to remove all of it. `bouncer uninstall` removes the hooks and leaves this folder alone.

## What it sends to an AI (only if you connect one)

When a decision depends on it, Bouncer sends the provider **the prompt text, up to 40 file paths and your last few prompts**, never file contents. You choose the provider: Cloudflare Workers AI, Groq, Google AI Studio, any OpenAI-compatible endpoint, or a local Ollama that keeps everything on your machine. That provider's own privacy terms apply.

## API keys

- When you run `bouncer config`, the key can come from an environment variable (`CLOUDFLARE_API_TOKEN`, `GROQ_API_KEY`, `GEMINI_API_KEY`) so you don't type it into a chat or your shell history.
- It is then saved in `~/.bouncer/config.json` on your machine, in plain text like most CLI tools' config. Keep that file private; `bouncer config --clear` removes it.
- Don't paste keys into Claude: Bouncer blocks the prompt, and a key that was ever shared should be rotated.

## Report a security problem

Please don't post vulnerability details in a public issue. Use GitHub's private [security advisory form](https://github.com/quyvh20/BOUNCER/security/advisories/new); if it isn't available, open an issue that only asks for a private contact.
