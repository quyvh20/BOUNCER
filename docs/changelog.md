---
title: Changelog
description: Every notable change to Bouncer, the open-source token guard for Claude Code and OpenAI Codex, newest first.
---

# Changelog

Bouncer is pre-release (`0.1.0`, installed from source). The full history is in the [commit log](https://github.com/quyvh20/BOUNCER/commits/main).

## 0.1.0 · October 2026

### Saving tokens
- **Eco mode**: once a session passes its budget (200k by default), a new task starts in a fresh session with a handover on your clipboard. Follow-ups are never interrupted.
- **Opus guard from the first prompt**, in any language, and only while the context is under 50k (switching in a bigger session costs more than it saves). Paste to keep Opus, or `bouncer opus warn` to never be stopped.
- **Model and effort advice** after each answer: TRIVIAL → Haiku, STANDARD → Sonnet, COMPLEX → Opus, with the command to type.
- **Prompt checks in any language**: vague asks, unscoped repo-wide reviews, oversized pastes and log dumps.
- **Lean mode**: the optional AI only runs when a decision depends on it (~0.4 s per prompt instead of ~2.9 s).

### Measuring honestly
- **A/B measurement** (`bouncer measure on`), comparing real token usage only at the same context size.
- Money estimates removed: "tokens saved" is labelled as an estimate.

### Safety
- Leaked secrets are blocked before any model sees them, even with ` !`.
- AI file hints are checked against git and dropped when unrelated or unsure.
- Fail-open: any error lets the prompt through.
- Bouncer's own handover is never blocked when you paste it back.

### Where it runs
- Claude Code CLI, desktop Code tab, VS Code and JetBrains.
- **OpenAI Codex** (`bouncer init --target codex`).
- Free AI presets: Cloudflare Workers AI (Mistral Small 3.1), Groq, Gemini, Ollama.

### Rescue and reports
- Rate-limit rescue: a git-backed handover with your verbatim prompts.
- After-answer report with context bar, status and next steps; always-visible status line; branded block messages with the next step in capitals.
