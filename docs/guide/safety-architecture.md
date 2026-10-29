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
  ├─ 📦 paste > 8k tokens? ─────────────────────────▶ BLOCK (save it to a file, @mention it)
  ├─ 💸 "whole codebase" with no folder, big repo? ──▶ BLOCK (+ cost estimate, folders to pick)
  │
  ├─ 🥉 LEVEL 1  git status · git ls-files · @file matching · regex complexity   (0 network)
  ├─ 🥈/🥇 LEVEL 2–3  optional BYOK classifier, hard 1500 ms deadline ─ fail ─▶ keep Level 1
  │
  ├─ 🧹 context > 150k tokens? ─────────────────────▶ BLOCK + /clear handover
  ├─ 🤨 vague prompt (strict, or session start)? ──▶ BLOCK (+ rewrite on clipboard)
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

## Quality guards

Saving tokens is worthless if Claude does worse work. These rules keep Bouncer from trading quality for budget:

| Guard | What it prevents |
|---|---|
| **"Quality first" clause.** Every budget note ends with *"if the task is bigger than labelled, ignore these limits and do it properly."* Limits are phrased as "aim for", never "must". | A mislabelled TRIVIAL task getting a rushed, wrong fix. |
| **Two-signal Opus guard.** Opus is only blocked when the local classifier *and* the final (AI) verdict both call the task routine. | One wrong AI label interrupting real work. |
| **Session memory.** Re-send a blocked prompt with ` !` and Bouncer stops blocking that category for the rest of the session. | Being nagged again after you've already decided. |
| **Scattershot discount.** Each AI-suggested file beyond the 3rd lowers the confidence used for Law 2, and at most 3 hints are passed on. | Small models listing 5 files at "0.8 confidence" and sending Claude to the wrong ones. |
| **Prompt-ranked file list.** The AI sees the 40 paths most related to your prompt, not the first 40 in the repo. | The right file never being an option in large repos. |
| **Skip when certain.** An exact `@file` plus a strong local signal skips the AI call entirely. | Extra latency and quota spent where AI adds nothing. |
| **Complex = no limits.** COMPLEX tasks get no brevity or tool-call budget at all. | Hard problems being squeezed. |
| **Fail-open.** Any Bouncer error, or an AI slower than the budget, lets the prompt through unchanged. | Bouncer ever blocking you because *it* broke. |
| **Prompt QC with context.** A vague prompt (`fix it`, `sửa đi`) is only blocked in balanced mode before Claude has answered anything, since mid-conversation "it" refers to what you just discussed. Repo-wide asks are only blocked when unscoped *and* the repo is big. | Blocking short follow-ups that are perfectly clear in context. |
| **Any language.** Level 1 recognises vague and repo-wide prompts in about 20 languages (English, Vietnamese, Chinese, Japanese, Korean, Spanish, Portuguese, French, German, Russian, Indonesian, Turkish, Italian, Polish, Dutch, Arabic, Thai, Hindi…). With an AI connected, the model judges *meaning* in any language, and the rewrite it puts on your clipboard stays in your language. An AI "vague" verdict only counts on a short prompt with no file, number, quote or code token. | Non-English prompts slipping through, or a long, specific prompt being called vague. |
| **Secrets beat VIP.** ` !` skips every check *except* the secret filter. | A key leaking because of a habit-typed ` !`. |

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
