---
title: Recommended AI Models for Bouncer
description: Which free AI model to connect to Bouncer, with measured latency, task classification and file-routing accuracy for Cloudflare Workers AI, Groq, Gemini and Ollama.
---

# Recommended AI Models

When a decision depends on it (the first prompt of a session, a small task on Opus, a new task in a big session), Bouncer asks the model one small question: *how hard is this task, which files does it touch, and is it clear?* The model has to answer **within the time budget** (default 1.5 s, configurable), or Bouncer falls back to Level 1 for that prompt. So **speed matters as much as smarts**.

## Quick picks

| Your situation | Pick | Command |
|---|---|---|
| You have a Cloudflare account | **Mistral Small 3.1** on Workers AI | `bouncer config --preset cloudflare-gold --account-id <ID>` (sets a 3 s budget) |
| You want the lowest latency | **Llama 3.3 70B** on Groq | `bouncer config --preset groq-gold --key <KEY>` |
| You want the biggest context | **Gemini 2.5 Flash** | `bouncer config --preset gemini-gold --key <KEY>` |
| Nothing may leave your machine | **Qwen2.5-Coder 14B** on Ollama (GPU) | `bouncer config --preset ollama-coder --model qwen2.5-coder:14b` |
| No account, no GPU | Stay on 🥉 Level 1 | nothing to do; every protection still works |

::: tip Set it up in one paste
Pick your provider and model on the [lazy-install picklist](/#lazy-install): it writes the full setup prompt for your coding agent, with these recommendations as defaults.
:::

## Measured: Cloudflare Workers AI

10 labelled prompts against Bouncer's own repository (English and Vietnamese): 7 with a known task size and target file, 2 vague prompts, and 1 follow-up that is clear only from the previous prompt. Every model went through Bouncer's real classifier and safety laws, sequentially, twice, in October 2026. Ranges cover both rounds.

| Model | Level | Median | Within 3 s | Task size | **Right file** | Misleading | Vague call | Verdict |
|---|:-:|--:|:-:|:-:|:-:|:-:|:-:|---|
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 🥇 | 2.1 s | **20/20** | 7/7 | 5/7 | 0 | 10/10 | ✅ **default**: most reliable |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 🥇 | 1.9–2.5 s | 16/20 | 5–6/7 | 5–6/7 | 0 | 9–10/10 | good, but timeouts (p90 up to 8 s) |
| `@cf/nvidia/nemotron-3-120b-a12b` ¹ | 🥇 | 1.5–1.7 s | 19/20 | 6/7 | 5/7 | 0 | 8/10 | fastest good one; misses some vague prompts |
| `@cf/openai/gpt-oss-20b` ¹ | 🥇 | 1.6–2.2 s | 17/20 | 4–5/7 | 5/7 | 0–1 | 9–10/10 | fast, weak on task size |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` ¹ | 🥈 | 2.0–3.0 s | 13/20 | 7/7 | 4–6/7 | 0 | 10/10 | accurate, too slow for the hook |
| `@cf/qwen/qwen3.8-27b` ¹ | 🥇 | 2.2–2.9 s | 15/20 | 6–7/7 | 5–6/7 | 1 | 6–10/10 | strong when it answers, unstable |
| `@cf/openai/gpt-oss-120b` ¹ | 🥇 | 2.6 s | 9/10 | 6/7 | 3/7 | 0 | 9/10 | slower and weaker on files than 20B |
| `@cf/zai-org/glm-4.7-flash` ¹ | 🥈 | 2.3 s | 9/10 | 6/7 | 1/7 | 0 | 9/10 | rarely finds the file |
| `@cf/zai-org/glm-5.3-flash` ¹ | 🥈 | 4.2 s | 3/10 | — | 1/5 | 0 | 6/10 | ❌ too slow |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | 🥈 | 4.4 s | 1/10 | 6/7 | 1/7 | 0 | 9/10 | ❌ slow and rarely finds the file |
| `@cf/ibm-granite/granite-4.0-h-micro` | 🥈 | 3.9 s | 1/10 | 5/6 | 1/6 | 0 | 8/10 | ❌ |
| `@cf/moonshotai/kimi-k2.6` ¹ | 🥈 | 4.8 s+ | 0/10 | — | — | — | — | ❌ reasoning takes too long |

¹ Reasoning model. These spend tokens "thinking" before they answer, so with Bouncer's default request they run out of tokens or time and return nothing. The numbers above were measured with `reasoning_effort: "low"` and a larger token cap, which Bouncer does not send yet, so treat them as an upper bound.

**Misleading hint** means Bouncer passed Claude a file that wasn't the right one. That's the only failure that can cost you tokens. Bouncer's [quality guards](/guide/safety-architecture#quality-guards) (relevance check, confidence gate, scattershot discount) keep it near zero for every model above.

## Other providers

Not yet benchmarked by us. `bouncer config` measures your real latency when you connect one.

| Provider · model | Level | Notes |
|---|:-:|---|
| Groq · `llama-3.3-70b-versatile` | 🥇 | Groq is built for low latency; free-tier rate limits apply |
| Google AI Studio · `gemini-2.5-flash` | 🥇 | free tier may use prompts to improve Google products |
| Ollama · `qwen2.5-coder:14b` (GPU) | 🥇 | fully offline; keep the model loaded |
| Ollama · `qwen2.5-coder:7b` | 🥈 | Silver: file hints need 0.90 confidence |

## Re-run the benchmark yourself

Latency depends on your region and the time of day. Bouncer prints the measured time whenever you configure a model:

```bash
bouncer config --model @cf/mistralai/mistral-small-3.1-24b-instruct
#   Testing Cloudflare Workers AI (...)… ok (1563ms → TRIVIAL, confidence 1)
```

Then watch **AI router … fail-opens** in `bouncer stats`. With a 2 s budget, Llama 4 Scout failed open on 10 of 10 real prompts, which is why the Cloudflare preset now sets 3 s. If more than about 1 in 4 calls fail open, raise the budget (`--timeout 2500`) or pick a faster model.
