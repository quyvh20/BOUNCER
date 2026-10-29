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
  ├─ 🥈/🥇 LEVEL 2–3  optional AI, only when a decision needs it ─ timeout ─▶ keep Level 1
  │      (first prompt of a session · strict mode · eco over budget; ~0.4 s otherwise)
  │
  ├─ 🧹 context > 75% of window? ──── strict: BLOCK + /clear handover · balanced: WARN once
  ├─ 🤨 vague prompt (strict, or session start)? ──▶ BLOCK (+ rewrite on clipboard)
  ├─ 🌱 eco on, context > budget, NEW task? ───────▶ BLOCK (+ handover with the prompt on clipboard)
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
elsewhere, delegate search to the Explore subagent.
```

If a hint misses, Claude is told how to keep looking instead of being boxed in.

## Law 5: MIT license shield

Bouncer ships under the MIT License, provided **"AS IS", without warranty of any kind**. Bouncer only reads your files and runs read-only git commands (`status`, `diff --stat`, `ls-files`, `rev-parse`). It never writes to your repository.

## Quality guards

Saving tokens is worthless if Claude does worse work. These rules keep Bouncer from trading quality for budget:

| Guard | What it prevents |
|---|---|
| **"Quality first" clause.** Every budget note ends with *"if the task is bigger than labelled, ignore these limits and do it properly."* Limits are phrased as "aim for", never "must". | A mislabelled TRIVIAL task getting a rushed, wrong fix. |
| **Careful Opus guard.** Opus is only blocked when the local classifier calls the task routine, or the AI is sure it is (confidence ≥ 0.9, size confidence ≥ 0.8) and the prompt doesn't describe something broken ("crash", "lỗi", "错误"…). And only while the session's context is under 50k: the prompt cache belongs to one model, so switching in a bigger session costs more than it saves. There the report suggests starting tasks like this on Sonnet instead. | One wrong AI label interrupting real work; a "saving" switch that costs more. |
| **Session memory.** Re-send a blocked prompt with ` !` and Bouncer stops blocking that category for the rest of the session. | Being nagged again after you've already decided. |
| **Scattershot discount.** Each AI-suggested file beyond the 3rd lowers the confidence used for Law 2, and at most 3 hints are passed on. | Small models listing 5 files at "0.8 confidence" and sending Claude to the wrong ones. |
| **Relevance check.** An AI-suggested file must share a word with your prompt or with the English keywords the AI extracts from it (so a Vietnamese "nút đăng xuất" still matches `logout.ts`). Unrelated files need 0.95 confidence. | A small model confidently pointing at `stats-ui.ts` for "add a logout button to the header". |
| **Prompt-ranked file list.** The AI sees the 40 paths most related to your prompt, not the first 40 in the repo. | The right file never being an option in large repos. |
| **Skip when certain.** An exact `@file` plus a strong local signal skips the AI call entirely. | Extra latency and quota spent where AI adds nothing. |
| **Complex = no limits.** COMPLEX tasks get no brevity or tool-call budget at all. | Hard problems being squeezed. |
| **Fail-open.** Any Bouncer error, or an AI slower than the budget, lets the prompt through unchanged. | Bouncer ever blocking you because *it* broke. |
| **Prompt QC with context.** A vague prompt (`fix it`, `sửa đi`) is only blocked in balanced mode before Claude has answered anything, since mid-conversation "it" refers to what you just discussed. Repo-wide asks are only blocked when unscoped *and* the repo is big. | Blocking short follow-ups that are perfectly clear in context. |
| **Any language.** Level 1 recognises vague and repo-wide prompts in about 20 languages (English, Vietnamese, Chinese, Japanese, Korean, Spanish, Portuguese, French, German, Russian, Indonesian, Turkish, Italian, Polish, Dutch, Arabic, Thai, Hindi…). With an AI connected, the model judges *meaning* in any language, and the rewrite it puts on your clipboard stays in your language. With an AI connected, vagueness is judged by **meaning, not length**: the AI reads the prompt together with your earlier prompts in the session, so a follow-up like "fix it" is clear when the context says what "it" is, and a long rambling prompt can still be vague. A "vague" verdict only counts if the AI says what is missing, and that is what the block message shows you. | Non-English prompts slipping through, length-based guesses, and blocking follow-ups that are clear in context. |
| **No limits when unsure.** Tool-call limits, brevity and the size label are only sent when the AI answered *and* is sure of the size, or a strong local signal fired. A follow-up with no file, symbol or number ("do both", "sửa luôn") never gets limits: its real size is in earlier work nobody can see. Otherwise Claude gets only verified facts (modified files, file hints). | A guessed "STANDARD" squeezing a big task, e.g. every non-English prompt when the AI times out. |
| **Context bloat warns, not blocks (balanced).** The threshold scales with the session's window, and balanced mode shows one warning instead of forcing `/clear` mid-task. | Losing the detail of a long session at the worst moment. |
| **Honest savings.** A block's savings are taken back when you override it with ` !`. | Inflated "tokens saved" numbers. |
| **Eco never cuts work in progress.** Eco mode only proposes a fresh session for a prompt that starts a *new* task (judged by the AI in context, or by having no word in common with recent prompts). Follow-ups keep their context. | Losing the detail Claude needs halfway through a task. |
| **Lean AI.** The AI is only called when a decision depends on it: vagueness on the first prompt of a session (or every prompt in strict), and "is this a new task?" once eco's budget is passed. Other prompts run local checks only (~0.4 s instead of ~2.9 s measured). `aiEveryPrompt: true` in `~/.bouncer/config.json` restores the old behaviour. | Paying latency on every prompt for guesses that didn't prove useful. |
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
