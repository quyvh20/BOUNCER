---
title: FAQ
description: Answers about Bouncer for Claude Code and Codex - why a prompt was blocked, how to send it anyway, whether it really saves tokens, whether it changes your prompt or model, privacy, speed and uninstalling.
faq: true
---

# FAQ

## What is Bouncer?

Bouncer is a free, open-source (MIT) token guard for Claude Code and OpenAI Codex. It installs as hooks, checks each prompt before it is sent, and stops the ones that would waste tokens or leak a secret: Opus on a small task, a new task in an oversized session, a pasted log, an API key, a vague first prompt. It never edits your code or your prompt, and it runs offline by default.

## How do I reduce Claude Code token usage?

Most of the cost is Claude re-reading the whole conversation on every call, so the biggest win is keeping sessions small:

1. Start a new session (`/clear`) for each new task, with a short handover. Bouncer's eco mode does this for you once a session passes 200k tokens.
2. Use the cheapest model that fits: Haiku for typos and renames, Sonnet for everyday work, Opus for hard problems.
3. Point Claude at files with `@path` instead of asking it to search or review the whole repo.
4. Save big logs to a file and mention it, instead of pasting them.
5. Keep `CLAUDE.md` short and add a `.claudeignore` for build output and lockfiles ([templates](./claude-md-templates)).

Bouncer checks 2–4 on every prompt, and 1 once you turn on eco mode (`bouncer eco on`).

## How is Bouncer different from /clear, /compact or CLAUDE.md rules?

Those are things you have to remember to do. Bouncer is the reminder that runs on every prompt: it notices when a session is too big for a new task, when you're on Opus for a typo, or when a prompt is too vague, and puts the next step on your clipboard. It works alongside your `CLAUDE.md`; it doesn't replace it.

## Is Bouncer free?

Yes. It's MIT-licensed, has no paid tier and no telemetry. The optional AI providers (Cloudflare Workers AI, Groq, Google AI Studio) have free tiers, and Ollama runs locally for free.

## Why was my prompt blocked?

The message says why in its title (`🛑 OPUS ON A SMALL TASK`, `🌱 NEW TASK? START FRESH`, `🤨 PROMPT TOO VAGUE`…) and the line in capitals says what to do. Your prompt, or a handover, is already on your clipboard, so nothing you typed is lost. [Every message explained →](./getting-started#what-a-block-looks-like)

## How do I send it anyway?

End the prompt with a space and `!`:

```text
fix the flaky checkout test !
```

After an Opus block you don't even need to type it: the copy on your clipboard already ends with ` !`, so just paste. Once you skip a kind of block, Bouncer stops showing it for the rest of that session. Leaked secrets are the one thing ` !` never lets through.

## Why don't I see any blocks?

That's normal. Bouncer only blocks when blocking clearly pays off:

- Vague prompts are only checked at the start of a session (or always, in `strict` mode). Mid-conversation, Claude has the context.
- The Opus guard only blocks while the session is under 50k tokens. In a bigger session, switching models costs more than it saves, so you get advice in the after-answer report instead.
- Eco only blocks a **new** task once the session is past its budget (200k by default), and never a follow-up.
- After you skip a block with ` !`, that kind stays off for the session.

Want it stricter? `bouncer mode strict`.

## Does Bouncer really save tokens?

Some of it is certain, some isn't, and Bouncer says which is which:

- **Certain:** a blocked prompt is not sent. A secret that never leaves, an Opus call that never happens, a 300k-token session that isn't re-read for a new task.
- **Estimated:** the "saved" numbers in the report are heuristics, not billing data. That's why Bouncer doesn't show money.
- **Measured:** `bouncer measure on` runs an A/B test on your own usage (half the prompts get no guidance) and compares real token usage at the same context size. [How the test works →](./getting-started#measure-it-on-your-own-usage)

The biggest lever is keeping the context small: re-reading the conversation is most of the bill. Turn on [eco mode](./getting-started#eco-mode).

## Does it change my prompt?

No. A hook can only let a prompt through or stop it. When it lets one through, Bouncer may add a short note for Claude (task size, files worth checking first). Your text is never edited. When it suggests a clearer prompt, it puts that on your clipboard for you to send yourself.

## Can it switch the model or effort for me?

No. Claude Code doesn't let hooks change the model. Bouncer tells you what fits (TRIVIAL → Haiku, STANDARD → Sonnet, COMPLEX → Opus) and the command to type. [Which model for which task →](./getting-started#which-model-for-which-task)

## Is my code sent anywhere?

Not by default: Level 1 runs fully offline. If you connect an AI (Cloudflare, Groq, Gemini or a local Ollama), Bouncer sends it the prompt text and up to 40 file **paths**, never file contents, and only when a decision depends on it. Secrets are blocked before any AI sees the prompt.

## Will it slow me down?

Local checks take about 0.4 s. The AI, if connected, is only asked on the first prompt of a session, on Opus, or for eco, and it has a hard time budget (1.5 s by default, 3 s on Cloudflare). If it's late or anything breaks, your prompt goes through.

## Does it work in Codex, Cursor or claude.ai?

- **Claude Code** (CLI, desktop Code tab, VS Code, JetBrains): yes, everything.
- **OpenAI Codex**: yes, with `bouncer init --target codex`. Claude-only parts (the Opus guard, `/bouncer`, the status line) are skipped.
- **Cursor, Gemini CLI, Antigravity, claude.ai chat**: no. They don't offer the hooks Bouncer needs.

[Full compatibility table →](./installation#where-bouncer-works)

## Where do I send feedback or report a wrong block?

On the [feedback page](/feedback): pick "wrong or missed block", "bug" or "idea" and fill in the short GitHub form. Run `bouncer feedback` first and paste its first line, so we know your setup.

## How do I remove it?

```bash
bouncer uninstall
```

This removes only Bouncer's hooks, status line and `/bouncer` command. Delete `~/.bouncer` to also remove its config and stats.
