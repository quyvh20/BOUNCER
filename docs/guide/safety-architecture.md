---
title: Safety Architecture
description: The 5 zero-damage safety laws that keep Bouncer's AI routing from ever misleading Claude Code or breaking your project, plus the 3-tier evaluation pipeline.
---

# Safety Architecture

Bouncer can use an AI model to guess which files a prompt is about. A wrong guess sends Claude on a wild-goose chase and burns the very tokens Bouncer is meant to save. Five laws, enforced **in code** and not only in prompts, keep that from happening.

## The evaluation pipeline

```text
prompt
  │
  ├─ ends with " !"? ───────────────────────────────▶ ALLOW (no checks, nothing added)
  ├─ slash command (/model, /clear…)? ──────────────▶ ALLOW
  ├─ 🔑 secret / 📜 log dump? ───────────────────────▶ BLOCK (before any LLM sees it)
  │
  ├─ 🥉 LEVEL 1  git status · git ls-files · @file matching · regex complexity   (0 network)
  ├─ 🥈/🥇 LEVEL 2–3  optional BYOK classifier, hard 1500 ms deadline ─ fail ─▶ keep Level 1
  │
  ├─ 🧹 context > 150k tokens? ─────────────────────▶ BLOCK + /clear handover
  ├─ 🤨 vague prompt (strict)? ─────────────────────▶ BLOCK (+ rewrite on clipboard)
  ├─ 🛑 Opus on routine work? ──────────────────────▶ BLOCK (+ prompt on clipboard)
  │
  └─ ALLOW + advisory budget note
```

## Law 1: Strict file whitelist

Every file path an AI suggests is intersected with the real output of `git ls-files` **and** checked on disk. A path that doesn't exist is stripped before anything reaches Claude.

```text
AI says:   ["src/real.ts", "src/hallucinated-fake.ts"]
Bouncer:   ["src/real.ts"]
```

The same filter covers files you mention yourself (`@README.md`, `src/app.ts`) and the files `git status` reports as modified.

## Law 2: Confidence threshold gate

The classifier must return a `confidence` between 0.0 and 1.0. File hints are only released when:

| Level | Minimum confidence |
|---|---|
| 🥈 Silver (≈8B models) | **0.90** |
| 🥇 Gold (70B / Flash) | **0.80** |

A confidence of 0.45 means **no hints at all**. Claude gets no hint rather than a misleading one.

## Law 3: Zero silent prompt mutation

Bouncer **never** edits the prompt you send. On an allowed prompt it only *adds* a separate context note. A rewritten prompt is shown in exactly one case: a vague prompt blocked in `strict` mode, where the rewrite goes to your **clipboard** for you to review and paste yourself.

## Law 4: Non-binding advisory directives

Hints are phrased as starting points, never as orders:

```text
[Bouncer] Task: STANDARD · Budget: Sonnet / medium effort · ≤10 exploration tool calls · output: standard-complete.
Ground truth — files modified in git right now: @src/payment/stripe.ts.
Check these verified workspace files first: @src/payment/stripe.ts; if the target logic is
elsewhere, delegate search to the `bouncer-scout` subagent.
```

If a hint misses, Claude is told how to keep looking instead of being boxed in.

## Law 5: MIT license shield

Bouncer ships under the MIT License, provided **"AS IS", without warranty of any kind**. Bouncer only reads your files and runs read-only git commands (`status`, `diff --stat`, `ls-files`, `rev-parse`). It never writes to your repository.

## What leaves your machine

| Level | Network traffic |
|---|---|
| 🥉 Level 1 | **None.** |
| 🥈/🥇 Level 2–3 | Your prompt text, up to 40 modified/workspace **file paths** (not contents), sent to the provider *you* configured. Prompts containing secrets are blocked before this step. |
| 🥇 Rescue summary | The most recent ~24k characters of the conversation, sent only when you build a rescue on Gold. |

With [Ollama](/unlock-gold/ollama-local), even Level 3 stays on your machine.

::: info API keys
Provider keys are stored in plain text in `~/.bouncer/config.json`, which is created with owner-only permissions on macOS/Linux. Prefer free-tier keys created just for Bouncer.
:::
