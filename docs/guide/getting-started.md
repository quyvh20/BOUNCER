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
Bouncer is pre-release. Until `@bouncer/cli` is published, install from source:
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
3. Installs the `bouncer-scout` subagent (`~/.claude/agents/bouncer-scout.md`, pinned to **Haiku**) and the `/bouncer` slash command.
4. Prints your current intelligence level.

Restart Claude Code (or open a new session) to activate the hooks.

## See everything at once

```bash
bouncer all
```

`bouncer all` shows whether the hooks are installed, whether an AI is connected (with a setup link if not), your mode and savings, every command, and links to these docs. Running `bouncer` with no arguments, or `/bouncer` inside Claude Code, shows the same thing.

## After every answer

When Claude finishes a reply, Bouncer adds one line:

```text
🕶️ Bouncer ✓ saved ~3.0k tokens this prompt · ~12.4k this session · ~95.1k total (≈$0.29) · 🥇 L3 Cloudflare Workers AI · `bouncer all` · https://quyvh20.github.io/BOUNCER/
```

With no AI connected, the end of the line links to the [free Gold setup](/unlock-gold/) instead. Turn it off with `bouncer config --footer off`.

::: info Estimates
Savings are heuristic estimates: skipped exploratory reads, surgical output, Opus→Sonnet switches and `/clear` handovers. They are not billing data.
:::

## Commands

| Command | What it does |
|---|---|
| `bouncer all` | Status, every command and setup links. |
| `bouncer init [--target claude\|codex]` | Install hooks, the scout agent and `/bouncer`. Codex is a skeleton for now. |
| `bouncer config --preset <name> [--key K]` | One-command AI setup: `cloudflare-gold`, `groq-gold`, `gemini-gold`, `ollama-coder`. See [Unlock Gold](/unlock-gold/) and [recommended models](/unlock-gold/recommended-models). |
| `bouncer config --url U --model M [--key K]` | Any OpenAI-compatible endpoint. |
| `bouncer config --show \| --clear \| --timeout <ms>` | Inspect, remove the AI provider, or change the hot-path timeout (default 1500 ms). |
| `bouncer config --footer on\|off` | The tokens-saved line after each answer. |
| `bouncer rescue [--transcript P] [--print]` | Build a handover from git + the latest session transcript. |
| `bouncer stats [--json]` | Dashboard: intelligence badge, blocks, tokens and USD saved. |
| `bouncer mode [strict\|balanced\|yolo]` | Show or change how hard the bouncer is. |
| `bouncer reset` | Clear stats and cache (keeps config). |
| `bouncer uninstall` | Remove only Bouncer's hooks, agent and slash command. |

Inside Claude Code you can run the same thing via the slash command: `/bouncer`, `/bouncer stats`, `/bouncer mode strict`.

## Modes

| | strict | balanced *(default)* | yolo |
|---|:-:|:-:|:-:|
| Leaked secrets (API keys, private keys, tokens) | 🚫 block | 🚫 block | 🚫 block |
| Pasted log dumps (60+ lines, mostly log lines) | 🚫 block | 🚫 block | ✅ allow |
| Context bloat (> 150k context tokens) | 🚫 block | 🚫 block | ✅ allow |
| Opus on a **trivial** task | 🚫 block | 🚫 block | ✅ allow |
| Opus on a **standard** task | 🚫 block | ✅ allow | ✅ allow |
| Vague prompts (`fix it`, `doesn't work`) | 🚫 block | ✅ allow | ✅ allow |
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

When Bouncer blocks a prompt, Claude Code discards it and shows the reason. Where it helps, Bouncer first copies your prompt **unchanged** to the clipboard:

```text
🛑 OPUS OVERKILL: You're on Opus (5x quota cost) for a routine task! Run '/model sonnet'
(or '/effort low'), then press Cmd+V / Ctrl+V to paste your prompt back (or end it with ' !' to force Opus).
```

## Fail-open by design

If anything inside Bouncer breaks (bad JSON, a slow AI provider, a missing git binary), the prompt goes through. A bug in Bouncer never stops you from coding.

## Uninstall

```bash
bouncer uninstall
```

Your `~/.bouncer` stats and config are kept. Delete that folder to remove everything.
