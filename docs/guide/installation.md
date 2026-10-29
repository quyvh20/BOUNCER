---
title: Installation & Requirements
description: Install Bouncer step by step on Windows, macOS and Linux - requirements, supported tools (Claude Code CLI, desktop, VS Code, JetBrains and OpenAI Codex; not Cursor or claude.ai chat), how to check it works, update, uninstall and fix common problems.
---

# Installation & Requirements

## Where Bouncer works

Bouncer runs as **hooks**: small commands the coding tool calls before each prompt and after each answer. It works only in tools that offer those hooks.

| Tool | Status | Notes |
|---|:-:|---|
| **Claude Code CLI** (`claude` in a terminal) | ✅ | Everything, including the always-visible status line. |
| **Claude desktop app, Code tab** | ✅ | Same `~/.claude/settings.json`. Hook messages appear as a collapsible "notice"; links in it aren't clickable (use `/bouncer docs`). The status line may not show. |
| **Claude Code in VS Code / JetBrains** | ✅ | Same settings file as the CLI. |
| **OpenAI Codex** (CLI, and the app/IDE when they load `~/.codex/hooks.json`) | ✅ new | `bouncer init --target codex`. Prompt checks, AI routing, savings report, A/B measurement and rate-limit rescue. Claude-only parts are skipped: Opus guard, `/bouncer` command, status line. You must trust the hooks once with `/hooks`. |
| **Cursor, Gemini CLI, other agents** | ❌ not yet | No adapter. |
| **Google Antigravity** | ❌ | No prompt-hook mechanism we could find. |
| **claude.ai chat, Claude desktop Chat tab, mobile apps** | ❌ | Chat has no hooks, so nothing can check a prompt before it is sent. |

The [🦥 lazy-install prompt](/#lazy-install) works in any agent that can run shell commands, but what it installs protects **Claude Code** and **Codex** only.

## Requirements

| | Needed | How to check |
|---|---|---|
| **Claude Code** | v2.1.251 or later (`UserPromptSubmit`, `Stop`, `SessionStart`, `PostModelSwitch` hooks and `statusLine`) | `claude --version` |
| **OpenAI Codex** *(if you use it)* | A version with lifecycle hooks (`hooks.json`, on by default in 2026 releases) | `codex --version` |
| **Node.js** | **18.17 or newer** (22 LTS recommended) | `node -v` |
| **npm** | Comes with Node.js | `npm -v` |
| **git** | Any 2.x, on your `PATH` | `git --version` |
| **OS** | Windows 10/11, macOS 12+, or Linux | |
| **Disk** | About 250 MB for the source and `node_modules` | |
| **Clipboard** *(optional)* | Windows and macOS: built in. Linux: `wl-copy` (Wayland) or `xclip`/`xsel` (X11). Without one, handovers are saved to `~/.bouncer/` instead. | `which wl-copy xclip xsel` |
| **Internet** *(optional)* | Only to connect an AI (Level 2/3). Level 1 is fully offline. | |
| **AI account** *(optional)* | A free Cloudflare, Groq or Google AI Studio key, or Ollama on your machine. See [Recommended models](/unlock-gold/recommended-models). | |

Bouncer only **reads** your projects: `git status`, `git diff --stat`, `git ls-files`. It writes only to `~/.bouncer/` and to Claude Code's own config (below).

## Install

::: tip Prefer one paste?
The [lazy-install picklist](/#lazy-install) builds a prompt for your coding agent that runs every step below for you.
:::

::: code-group

```powershell [Windows (PowerShell)]
# 1. Requirements: install Node.js LTS and Git if missing
winget install OpenJS.NodeJS.LTS
winget install Git.Git
# open a NEW PowerShell window afterwards so PATH updates

# 2. Get and build Bouncer
cd $HOME
git clone https://github.com/quyvh20/BOUNCER.git
cd BOUNCER
npm install
npm run build

# 3. Put `bouncer` on your PATH, then install the hooks
npm link -w @bouncer/cli
bouncer init
```

```bash [macOS]
# 1. Requirements (Homebrew)
brew install node git

# 2. Get and build Bouncer
cd ~
git clone https://github.com/quyvh20/BOUNCER.git
cd BOUNCER
npm install
npm run build

# 3. Put `bouncer` on your PATH, then install the hooks
npm link -w @bouncer/cli
bouncer init
```

```bash [Linux]
# 1. Requirements (Debian/Ubuntu; use your distro's package manager otherwise)
#    Node 18.17+ is needed: if your distro's nodejs is older, use https://nodejs.org or nvm
sudo apt install -y nodejs npm git xclip

# 2. Get and build Bouncer
cd ~
git clone https://github.com/quyvh20/BOUNCER.git
cd BOUNCER
npm install
npm run build

# 3. Put `bouncer` on your PATH, then install the hooks
npm link -w @bouncer/cli    # if this needs sudo, skip it and use the line below instead
bouncer init                 # or: node ~/BOUNCER/packages/cli/dist/index.js init
```

:::

**Then restart Claude Code** (or open a new session). Hooks are read when a session starts.

### Also for OpenAI Codex

```bash
bouncer init --target codex     # or --target all for Claude Code and Codex together
```

This adds two entries to `~/.codex/hooks.json` (`UserPromptSubmit` and `Stop`; an existing file is backed up to `hooks.json.bak` and your own hooks are kept). **Codex only runs new hooks after you trust them:** start Codex, run `/hooks`, and trust the two Bouncer hooks. If you edit or re-install them, trust them again.

In Codex, Bouncer reads the session's rollout file (`~/.codex/sessions/…`) for the model, reasoning effort, real context size and window, and the 5-hour/weekly limit usage: a used-up window triggers the same [rescue handover](./vip-evacuation-rescue). Its notes speak Codex: reasoning effort instead of Claude model names, `/new` instead of `/clear`, and `bouncer …` terminal commands instead of `/bouncer`.

### What `bouncer init` changes

| File | Change |
|---|---|
| `~/.claude/settings.json` | Adds the `UserPromptSubmit` and `Stop` hooks, the `SessionStart` and `PostModelSwitch` hooks (they only record the current model, so the Opus guard works on the first prompt), and a `statusLine` (only if you have none). Your other settings and hooks are kept. The first original is backed up to `settings.json.bak`. |
| `~/.claude/commands/bouncer.md` | The `/bouncer` slash command. |
| `~/.bouncer/` | Bouncer's own config, stats and handovers. |

Running `init` again is safe: it never duplicates entries.

## Check that it works

1. In a terminal: `bouncer all`. You should see `✔ Hooks installed in Claude Code` (and `✔ Hooks installed in OpenAI Codex` if you installed it).
2. Open a **new** Claude Code session and send a prompt. After the answer you should see a `🕶️ Bouncer …` report (in the desktop app, inside the collapsible notice).
3. Optional, to see a block: start a new session with just `fix it`. Bouncer should stop it as a vague prompt. End it with ` !` to send it anyway.

## Connect a free AI (optional)

Level 1 works offline. For smarter routing in any language, connect a model: pick one on [Recommended models](/unlock-gold/recommended-models), or use the [picklist](/#lazy-install). Example:

```bash
bouncer config --preset cloudflare-gold --account-id <ACCOUNT_ID>   # token read from CLOUDFLARE_API_TOKEN
```

`bouncer config` tests the connection and prints the measured latency.

## Update

```bash
cd ~/BOUNCER
git pull
npm install
npm run build
bouncer init     # refreshes the hook commands and /bouncer
```

## Uninstall

```bash
bouncer uninstall          # removes Bouncer's hooks (Claude Code and Codex), status line and /bouncer only
```

Then delete `~/.bouncer/` (config and stats) and the `BOUNCER` folder if you want everything gone. Your pre-install settings stay in `~/.claude/settings.json.bak`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `bouncer: command not found` | `npm link` didn't reach your `PATH`. Use `node ~/BOUNCER/packages/cli/dist/index.js <command>` instead, or add npm's global bin folder (`npm prefix -g`) to `PATH`. |
| PowerShell: *"running scripts is disabled on this system"* for `npm` | Run `npm.cmd install` (and `npm.cmd run build`) instead, or allow local scripts for your user with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| No `🕶️ Bouncer` report after answers | Restart Claude Code. Run `bouncer all`: if hooks show ⚠, run `bouncer init`. In Claude Code, `/hooks` lists the active hooks. |
| `~/.claude/settings.json is not valid JSON` | Bouncer refuses to overwrite a broken file. Fix the JSON (or restore `settings.json.bak`) and run `bouncer init` again. |
| You already had a status line | Bouncer keeps yours and doesn't add its own. `init` says so. |
| AI never answers (`bouncer stats` shows many fail-opens) | `bouncer config --show` re-tests it. Raise the budget with `bouncer config --timeout 3000`, or pick a faster model from [Recommended models](/unlock-gold/recommended-models). |
| `HTTP 401/403` when configuring | Wrong key, or the Cloudflare token lacks the **Workers AI** permission. |
| Codex: nothing happens | Run `/hooks` in Codex and trust the Bouncer hooks; changed hooks stay skipped until re-trusted. Check `~/.codex/hooks.json` contains `--host codex`. |
| A prompt was blocked but you want it through | End it with ` !`. Bouncer then stops blocking that kind of prompt for the rest of the session (secrets are always blocked). |
| The first prompt of a session feels 1–3 s slower | That's the AI check, which only runs when a decision depends on it (first prompt, Opus, eco). Pick a faster model, or `bouncer config --clear` to go back to offline Level 1. |
| Behind a corporate proxy | AI calls don't go through a proxy yet, so they fail open. Stay on Level 1 (everything except AI routing still works), or use Ollama locally. |
