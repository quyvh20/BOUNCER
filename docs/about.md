---
title: About Bouncer
description: Who builds Bouncer, why it exists, how its numbers were measured (144 real Claude Code sessions, a 14-model benchmark, an A/B test you can run yourself), what it can't do, and how to report a problem.
---

# About Bouncer

Bouncer is a free, open-source ([MIT](https://github.com/quyvh20/BOUNCER/blob/main/LICENSE)) guard for **Claude Code** and **OpenAI Codex**. It runs as the tools' official [hooks](https://code.claude.com/docs/en/hooks): it checks each prompt before it is sent, stops the ones that would waste tokens or leak a secret, and tells you what to do instead. It never edits your code or your prompt.

## Who makes it

Bouncer is built and maintained by **Quy Hoang** ([@quyvh20 on GitHub](https://github.com/quyvh20)), a developer who uses Claude Code every day and kept running into the 5-hour limit. Every change is public in the [repository](https://github.com/quyvh20/BOUNCER), with the full history in the [changelog](/changelog).

## Why it exists

Looking at real usage showed where the tokens go, and most of it isn't the prompt you type:

- In **144 Claude Code sessions** (about 43,000 API calls) on the author's machine, **77% of the cost was re-reading the conversation** from the prompt cache, 15% was writing it, and only 8% was Claude's output.
- The average call carried **~437k tokens** of context, and 89% of calls ran above 150k.
- Replaying those sessions with the context kept under 200k tokens gives up to **44% lower cost**.

So the biggest saving is keeping each session small, which is what [eco mode](/guide/getting-started#eco-mode) does. Bouncer also catches the cheaper mistakes: Opus on a typo, a pasted log, a key in a prompt.

## How the numbers were measured

| Claim | Where it comes from |
|---|---|
| Cost split and context sizes | The 144-session analysis above, using the token counts Claude Code writes to each session transcript, at Anthropic's price ratios (cache write 1.25x, cache read 0.1x, output 5x). |
| Which AI model to connect | A benchmark of 14 Cloudflare Workers AI models on 10 labelled prompts, run twice. Results and method: [Recommended models](/unlock-gold/recommended-models). |
| Whether Bouncer's guidance saves tokens **for you** | `bouncer measure on`: an A/B test on your own usage that compares real token counts at the same context size. [How it works](/guide/getting-started#measure-it-on-your-own-usage). |
| "Tokens saved" in the report | An **estimate**, labelled as one. It isn't billing data, so Bouncer doesn't turn it into money. |

## What it can't do

Honest limits, so you can decide if it's for you:

- It can't switch your model or effort: Claude Code doesn't let hooks do that. It tells you the command.
- It can't rewrite your prompt. It lets it through, or stops it and puts a better version on your clipboard.
- It doesn't work in Cursor, Gemini CLI, Antigravity or claude.ai chat, which have no prompt hooks.
- Its savings on your work are only known once you measure them; early A/B results need 10+ turns per group.

## Report a problem

Open an issue on [GitHub](https://github.com/quyvh20/BOUNCER/issues). For anything security-related, see [Privacy & security](/privacy).
