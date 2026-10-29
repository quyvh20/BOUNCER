---
title: Getting Started
description: Install Bouncer for Claude Code in under a minute, learn the CLI commands, the /bouncer slash command, and the strict, balanced and yolo modes.
---

# Getting Started

Bouncer sits on the door of every prompt you send to Claude Code. It runs as two [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks):

- **`UserPromptSubmit`**: checks each prompt *before* Claude sees it. It blocks leaked secrets, Opus overkill and context bloat, and adds a short, advisory budget note to the prompts it lets through.
- **`Stop`**: when a session ends on a rate-limit error, it builds a [rescue handover](./vip-evacuation-rescue) so you can continue elsewhere.

Out of the box it runs at **🥉 Level 1**: 100% offline, no API keys, no network.

## Install

::: warning Not on npm yet
Bouncer is pre-release. Until `@bouncer/cli` is published, install from source. Requirements, per-OS steps, supported tools and troubleshooting: **[Installation & Requirements](./installation)**.
:::

```bash
git clone https://github.com/quyvh20/BOUNCER.git
cd BOUNCER
npm install
npm run build
node packages/cli/dist/index.js init
```

Optional: put `bouncer` on your `PATH` with `npm link -w @bouncer/cli`. The examples below assume you did this.

`bouncer init`:

1. Backs up `~/.claude/settings.json` to `settings.json.bak`. The first backup is kept; later re-installs never overwrite it.
2. Adds the `UserPromptSubmit` and `Stop` hooks. Your existing hooks are left untouched, and re-running `init` never duplicates entries.
3. Installs the `/bouncer` slash command and a savings status line (skipped if you already have a status line).
4. Prints your current intelligence level.

Restart Claude Code (or open a new session) to activate the hooks.

## See everything at once

```bash
bouncer all
```

`bouncer all` shows whether the hooks are installed, whether an AI is connected (with a setup link if not), your mode and savings, every command, and links to these docs. Running `bouncer` with no arguments, or `/bouncer` inside Claude Code, shows the same thing.

## See your savings

Bouncer reports in two places.

**After every answer**, a short report: what this prompt saved and why, how Bouncer routed it, and your session and all-time totals.

```text
🕶️ Bouncer saved ~5.0k tokens on this prompt
  ├ why     3 verified file hints, fewer exploratory reads (−3.0k) · surgical diff instead of a long answer (−2.0k)
  ├ route   TRIVIAL → Haiku/low · you're on Opus · 🥇 L3 AI ✓ · 2 modified files pointed out
  ├ context 486.4k / 1.0M ▓▓▓▓▓░░░░░ 49% · eco: new tasks start fresh above 200.0k
  ├ session −12.4k over 6 prompts · 1 blocked
  ├ total   −95.1k (estimate)
  ├ status  mode balanced · eco on · A/B off · 🥇 L3 Cloudflare Workers AI
  ├ next    context is big: when this task is done, /bouncer rescue → /clear → paste (new task, small context)
  ├ tips    end a prompt with " !" to skip checks · /bouncer mode strict|balanced|yolo · /bouncer config --footer off hides this
  └ more    /bouncer stats · /bouncer all · /bouncer docs (https://quyvh20.github.io/BOUNCER/)
```

| Row | What it tells you |
|---|---|
| **why** | Where this prompt's savings came from. |
| **route** | Task size and the model/effort that fits it, the model you're on, whether the AI answered. |
| **context** | How full the session's context window is. Every call re-reads all of it, so this is your biggest cost. |
| **session / total** | Savings in this session and since you installed Bouncer (estimates; real numbers come from `bouncer measure on`). |
| **status** | Mode, eco, A/B measurement and the connected AI at a glance. |
| **next** | Up to 3 actions that fit right now: a fresh start when the context is big, a fix when the AI was too slow, `eco on` if it's off, a free AI if none is connected. |
| **tips / more** | The everyday controls: ` !` to skip checks, switch mode, hide this report, stats, all commands, docs. |

In Codex the commands are the terminal ones (`bouncer …`) and a fresh start is `/new`.

With no AI connected, a **next** row links to the [free Gold setup](/unlock-gold/). Turn the report off with `bouncer config --footer off`. The Claude desktop app folds hook messages into a collapsible "notice" (click it to expand) and doesn't make links in it clickable, so run `/bouncer docs` (or `/bouncer docs gold`, `models`, `cloudflare`) to open the page in your browser.

**Status line**, always visible under the prompt box in the terminal. `bouncer init` installs it unless you already have your own status line:

```text
🕶️ Bouncer 🥇 L3 Cloudflare Workers AI  ·  last TRIVIAL → Haiku −5.0k  ·  session −12.4k / 6 prompts  ·  total −95.1k  ·  ctx 42.0k  ·  📖 docs ↗
```

The `📖 docs ↗` at the end is a clickable link in terminals that support it (Windows Terminal, iTerm2, VS Code, most modern Linux terminals).

## Which model for which task

Bouncer sizes every prompt and the report says what fits (the **route** row). Hooks can't switch models, so when you're on a different one, a **next** row tells you the command:

| Task Bouncer sees | Examples | Fits | Commands |
|---|---|---|---|
| **TRIVIAL** | typo, rename, one-line fix, small question | Haiku · effort low | `/model haiku` · `/effort low` |
| **STANDARD** | a feature or bug fix in a few files, a test, a refactor of one module | Sonnet · effort medium | `/model sonnet` · `/effort medium` |
| **COMPLEX** | architecture, a migration, a hard bug across many files, security work | Opus · effort high | `/model opus` · `/effort high` |

```text
  ├ next    trivial task → Haiku · effort low is enough (you're on Opus · effort high): /model haiku · /effort low
  ├ next    complex task → Opus · effort high gives better results (you're on Sonnet): /model opus · /effort high
```

Two rules keep the advice honest:

- **Going up is always suggested** for a complex task, because quality comes first.
- **Going down is only suggested when it pays.** The prompt cache belongs to one model. Switching in a big session makes the new model cache the whole context again, which can cost more than the cheaper model saves. Above 50k context Bouncer says "start tasks like this in a new session with …" instead.

When Bouncer isn't sure of the size it suggests nothing. In Codex the advice is about reasoning effort (change it with `/model`).

## 🌱 Eco mode: the biggest saving

On real Claude Code sessions we measured, **about 77% of the token cost was re-reading the conversation's context** on every API call (cache reads), and the average call carried ~437k tokens of context. Trimming exploration or output can't touch that; keeping the context small can.

```bash
bouncer eco on              # budget 200k tokens; change it with --at 150000
```

When a session's context is above the budget **and your prompt starts a new task**, Bouncer stops it and puts a handover on your clipboard: the goal, recent prompts, git state, and the prompt you just typed. Run `/clear` (Codex: `/new`), paste, and the new task runs on a small context.

```text
🕶️ BOUNCER  ·  🌱 NEW TASK? START FRESH
──────────────────────────────────────────────
This session re-reads ~510k tokens on every call; in a new session each call gets ~94% cheaper.
This looks like a new task, so it doesn't need the old context.
✔ Your handover (goal, recent prompts, git state and this prompt) is on your clipboard.

   👉  OPEN A NEW SESSION ( /clear )   →   PRESS CTRL + V   →   DONE !

Want to stay in this session? Re-send your prompt ending with " !".
```

**Quality guard:** follow-ups, corrections and anything continuing the current work (`làm tiếp`, `also log the retries`) are never interrupted, because there the context is what makes the answer right. With an AI connected, the AI decides "new task or not" from the meaning and the session's earlier prompts; without one, a prompt counts as new only if it describes a task on its own and shares no word with your recent prompts. End a prompt with ` !` to stay in the session.

Replaying our 144 sessions with the context kept under 300k / 200k / 150k gives **31% / 44% / 52%** lower cost as an upper bound; each fresh start costs a little (re-reading a few files), so expect less. `bouncer stats` shows the measured effect on you: the average context per prompt with eco off vs on.

## Measure it on your own usage

The savings above are estimates. To get real numbers, turn on A/B measurement:

```bash
bouncer measure on
```

Bouncer then sends its guidance on only about half of the prompts it would guide. When each turn ends, it reads the real token usage from the session transcript (input, cache, output, API calls) and compares the two halves per task size in `bouncer stats`:

```text
  Measured savings (A/B) · on
  TRIVIAL   −38% cost per turn · 1.9 vs 3.1 context re-reads · 2.0 vs 3.3 calls · 400 vs 900 output · 14 guided / 12 control turns
  STANDARD  −9% cost per turn (need 10+ per group) · …
```

Most of a turn's cost is re-reading the session's context, so comparing raw tokens would mostly compare how big the sessions were. Bouncer avoids that in two ways:

- Turns are only compared with turns at **the same context size**: under 100k, 100–300k, or 300k+.
- A turn's cost (Anthropic price ratios: cache write 1.25x, cache read 0.1x, output 5x) is divided by its context size. The result reads as "how many times this turn re-read the whole context".

Read the result once each group has 10+ turns. If guidance doesn't help on your work, disconnect the AI (`bouncer config --clear`) to drop the ~2 s it adds per prompt; every safety check keeps working at Level 1. Turn measurement off with `bouncer measure off`.

::: info Estimates
The "saved" token counts are heuristic estimates: skipped exploratory reads, surgical output, Opus→Sonnet switches and `/clear` handovers. They are not billing data, so Bouncer doesn't turn them into money. For real numbers, use `bouncer measure on`.
:::

## Commands

| Command | What it does |
|---|---|
| `bouncer all` | Status, every command and setup links. |
| `bouncer docs [start\|gold\|cloudflare\|models\|safety]` | Open a docs page in your browser. |
| `bouncer init [--target claude\|codex\|all]` | Install hooks (plus the status line and `/bouncer` for Claude Code). `codex` installs into `~/.codex/hooks.json`; trust them once with `/hooks` in Codex. |
| `bouncer config --preset <name> [--key K]` | One-command AI setup: `cloudflare-gold`, `groq-gold`, `gemini-gold`, `ollama-coder`. See [Unlock Gold](/unlock-gold/) and [recommended models](/unlock-gold/recommended-models). |
| `bouncer config --url U --model M [--key K]` | Any OpenAI-compatible endpoint. |
| `bouncer config --show \| --clear \| --timeout <ms>` | Inspect, remove the AI provider, or change the hot-path timeout (default 1500 ms). |
| `bouncer config --footer on\|off` | The savings report after each answer. |
| `bouncer rescue [--transcript P] [--print]` | Build a handover from git + the latest session transcript. |
| `bouncer stats [--json]` | Dashboard: intelligence badge, blocks, tokens and USD saved. |
| `bouncer mode [strict\|balanced\|yolo]` | Show or change how hard the bouncer is. |
| `bouncer eco on\|off [--at 200000]` | Start new tasks in a fresh session once the context passes the budget (the biggest saving). |
| `bouncer measure on\|off` | A/B-test Bouncer's guidance on your real token usage. |
| `bouncer reset` | Clear stats and cache (keeps config). |
| `bouncer uninstall` | Remove only Bouncer's hooks, status line, agent and slash command. |

Inside Claude Code you can run the same thing via the slash command: `/bouncer`, `/bouncer stats`, `/bouncer mode strict`.

## Modes

| | strict | balanced *(default)* | yolo |
|---|:-:|:-:|:-:|
| Leaked secrets (API keys, private keys, tokens) | 🚫 block | 🚫 block | 🚫 block |
| Pasted log dumps (60+ lines, mostly log lines) | 🚫 block | 🚫 block | ✅ allow |
| Context bloat (75% of the context window: 150k of 200k, 750k of 1M) | 🚫 block + handover | ⚠️ warn once, no block | ✅ allow |
| Opus on a **trivial** task | 🚫 block | 🚫 block | ✅ allow |
| Opus on a **standard** task | 🚫 block | ✅ allow | ✅ allow |
| Vague prompts, any language (`fix it`, `sửa đi`, `直して`, `arréglalo`) | 🚫 block | 🚫 block at session start, ✅ allow mid-conversation | ✅ allow |
| Unscoped repo-wide asks (`review the whole codebase`, `đọc hết code`, `检查整个项目`) | 🚫 block (50+ files) | 🚫 block (150+ files) | ✅ allow |
| Oversized pastes | 🚫 block (> 3k tokens) | 🚫 block (> 8k tokens) | ✅ allow |
| Advisory budget note | ✅ | ✅ | ✅ |

## The VIP pass: end with ` !`

End any prompt with a standalone exclamation mark to skip every check:

```text
fix the flaky checkout test !
```

The `!` has to stand on its own after a space. `Fix it!` is an ordinary prompt, so you can't trigger the pass by accident.

Two more rules: ` !` never bypasses the **secret filter**, and once you use it on a blocked prompt, Bouncer stops blocking that kind of prompt for the rest of the session.

See the [quality guards](./safety-architecture#quality-guards) for everything Bouncer does to keep savings from costing you quality.

## What a block looks like

When Bouncer blocks a prompt, Claude Code discards it and shows why. Every message has the same shape, so you always know it's Bouncer and what to do: a `🕶️ BOUNCER` title, two or three plain lines, and the next step in capitals. Where it helps, Bouncer first copies your prompt **unchanged** (or a handover) to the clipboard:

```text
🕶️ BOUNCER  ·  🛑 OPUS ON A SMALL TASK
──────────────────────────────────────────────
This looks like a routine task: Sonnet does it just as well, and Opus uses much more of your quota.
✔ Your prompt is on your clipboard.

   👉  TYPE /model sonnet   →   PRESS CTRL + V   →   DONE !

Keep Opus? JUST PRESS CTRL + V.
```

The Opus guard works from the **first prompt** of a session: Bouncer's `SessionStart` and `PostModelSwitch` hooks (Claude Code v2.1.251+) tell it the current model before Claude has answered. The copy on your clipboard ends with ` !`, so pasting it sends it as is, on whichever model you're on by then.

On a Mac the step says `⌘ + V`. The titles you can meet: `🔑 SECRET BLOCKED` (can't be overridden), `📜 LOG DUMP`, `📦 PASTE TOO BIG`, `💸 TOO BROAD`, `🧹 CONTEXT FULL`, `🤨 PROMPT TOO VAGUE`, `🌱 NEW TASK? START FRESH`, `🛑 OPUS ON A SMALL TASK`.

## Fail-open by design

If anything inside Bouncer breaks (bad JSON, a slow AI provider, a missing git binary), the prompt goes through. A bug in Bouncer never stops you from coding.

## Uninstall

```bash
bouncer uninstall
```

Your `~/.bouncer` stats and config are kept. Delete that folder to remove everything.
