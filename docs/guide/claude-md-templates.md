---
title: The Ultimate CLAUDE.md & .claudeignore Templates
description: Copy-paste CLAUDE.md templates and ignore rules that cut Claude Code token usage, keep Opus for hard problems and stop Claude from reading build output and lockfiles.
---

# CLAUDE.md & .claudeignore Templates

`CLAUDE.md` is loaded into **every** Claude Code session in a project, so each line costs tokens on every turn. These templates are short on purpose. Copy one, cut whatever doesn't apply, and keep the file under ~60 lines.

## Template 1: Token-lean project `CLAUDE.md`

```markdown
# Project: <name>

## Stack
- <language/framework/version>, package manager: <npm|pnpm|uv|cargo>
- Entry points: <src/main.ts>, <src/server/>

## Commands
- Build: `<cmd>`   Test one file: `<cmd> path/to/test`   Lint: `<cmd>`
- Never run the full test suite unless asked; run the closest test file.

## Map (read these first, don't explore blindly)
- `<src/api/>`: HTTP handlers
- `<src/core/>`: business logic, no I/O
- `<src/db/>`: schema + migrations (never edit old migrations)

## Working rules
- Make the smallest change that solves the task. No drive-by refactors.
- Answer with a short summary of the diff, not a re-print of whole files.
- For broad searches ("where is X used?"), delegate to the `bouncer-scout` subagent.
- If a task needs more than ~10 files read, stop and propose a plan first.

## Don't touch
- `<generated/>`, `<vendor/>`, lockfiles, `.env*`
```

## Template 2: Model & effort etiquette

Add this block when a team shares one subscription:

```markdown
## Model etiquette
- Default: Sonnet, medium effort.
- Use Haiku (`/model haiku`) for: renames, typos, copy changes, formatting, simple config.
- Use Opus + high effort only for: architecture, concurrency bugs, cross-module refactors,
  security reviews. Say why in the first message.
- Run `/clear` when switching to an unrelated task.
```

## Template 3: Monorepo root `CLAUDE.md`

```markdown
# Monorepo

Packages (each has its own CLAUDE.md, so read only the one you work in):
- `packages/api`: backend
- `packages/web`: frontend
- `packages/shared`: types shared by both (changes here affect everyone; ask first)

Run commands from the package folder, not the root, unless told otherwise.
```

## Keeping files out of Claude's context

Claude Code reads what its tools find, and its search tools already skip anything in `.gitignore`. Two extra layers help.

### 1. Deny reads in `.claude/settings.json`

This is the setting Claude Code actually enforces. Commit it to your repo:

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(./**/*.pem)",
      "Read(./node_modules/**)",
      "Read(./dist/**)",
      "Read(./build/**)",
      "Read(./coverage/**)",
      "Read(./**/*.min.js)",
      "Read(./**/*.map)",
      "Read(./package-lock.json)",
      "Read(./pnpm-lock.yaml)",
      "Read(./yarn.lock)"
    ]
  }
}
```

### 2. A `.claudeignore` file as a shared convention

`.claudeignore` is a **community convention**, not a built-in Claude Code feature. Some tools and wrappers read it, and it documents intent for humans. Keep it in sync with the deny list above, and mention it in `CLAUDE.md` ("Never read files matched by `.claudeignore`") so Claude respects it too:

```text
# Build output & dependencies
node_modules/
dist/
build/
.next/
coverage/
*.min.js
*.map

# Lockfiles (huge, rarely useful)
package-lock.json
pnpm-lock.yaml
yarn.lock
Cargo.lock
poetry.lock

# Secrets
.env
.env.*
*.pem
secrets/

# Data & media
*.csv
*.parquet
*.sqlite
*.png
*.jpg
*.mp4

# Logs
*.log
logs/
```

## Why this pairs well with Bouncer

- Bouncer's [contraband filter](./safety-architecture) blocks secrets you *paste*. The deny list stops Claude from *reading* them.
- The file map in `CLAUDE.md` plus Bouncer's git-verified hints mean Claude starts in the right file instead of exploring.
- The model etiquette rules match what Bouncer enforces with its [Opus overkill guard](./getting-started#modes).
