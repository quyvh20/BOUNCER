---
title: Recommended AI Models for Bouncer
description: Which free AI model to connect to Bouncer, with measured latency, task classification and file-routing accuracy for Cloudflare Workers AI, Groq, Gemini and Ollama.
---

# Recommended AI Models

Bouncer asks the model one small question per prompt: *how hard is this task, and which files does it touch?* The model has to answer **within the time budget** (default 1.5 s, configurable), or Bouncer falls back to Level 1 for that prompt. So **speed matters as much as smarts**.

## Quick picks

| Your situation | Pick | Command |
|---|---|---|
| You have a Cloudflare account | **Llama 4 Scout** on Workers AI | `bouncer config --preset cloudflare-gold --account-id <ID>` (sets a 3 s budget) |
| You want the lowest latency | **Llama 3.3 70B** on Groq | `bouncer config --preset groq-gold --key <KEY>` |
| You want the biggest context | **Gemini 2.5 Flash** | `bouncer config --preset gemini-gold --key <KEY>` |
| Nothing may leave your machine | **Qwen2.5-Coder 14B** on Ollama (GPU) | `bouncer config --preset ollama-coder --model qwen2.5-coder:14b` |
| No account, no GPU | Stay on 🥉 Level 1 | nothing to do; every protection still works |

## Measured: Cloudflare Workers AI

We ran 8 labelled prompts against Bouncer's own repository. Each prompt has a known difficulty and a known target file, and every model went through Bouncer's real classifier and safety laws. Calls were sequential, measured in October 2026.

| Model | Level | Median | In 2 s | Difficulty right | **Right file** | Misleading hints | Verdict |
|---|:-:|--:|:-:|:-:|:-:|:-:|---|
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 🥇 | 1.8 s | 6/8 | 7/8 | **6/8** | 2 | ✅ **default**: best speed/accuracy balance |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 🥇 | 2.1 s | 4/8 | 8/8 | 6/8 | 2 | good, a bit slow; use `--timeout 2500` |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 🥇 | 3.0 s | 0/8 | 8/8 | 6/8 | 1 | accurate but too slow for the prompt hook |
| `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | 🥈 | 3.1 s | 4/8 | 8/8 | 2/8 | 0 | honest confidence, weak file routing |
| `@cf/meta/llama-3.1-8b-instruct-fast` | 🥈 | 1.1 s | 8/8 | 6/8 | 2/8 | 1 | fast, but rarely finds the file |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 🥇 | 3.3 s | 1/8 | 4/8 | 2/8 | 1 | ❌ often returns nothing |
| `@cf/google/gemma-4-26b-a4b-it` | 🥇 | 7.3 s | 0/8 | 1/8 | 1/8 | 0 | ❌ no JSON, too slow |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | 🥇 | ~3.2 s | — | — | — | — | ❌ empty answers via the OpenAI endpoint |

**Misleading hint** means the model pointed Claude at files but missed the right one. That's the only failure that can cost you tokens, because Claude reads a wrong file first. Bouncer's [quality guards](/guide/safety-architecture#quality-guards) shrink it further.

::: tip What we learned
Most models report confidence **≈ 0.8 every time**, even when they list four or five files, which is a guess. Bouncer doesn't trust that number alone: each file beyond the third lowers the confidence it uses, and at most 3 hints reach Claude.
:::

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
bouncer config --model @cf/meta/llama-4-scout-17b-16e-instruct
#   Testing Cloudflare Workers AI (...)… ok (1563ms → TRIVIAL, confidence 1)
```

Then watch **AI router … fail-opens** in `bouncer stats`. With a 2 s budget, Scout failed open on 10 of 10 real prompts, which is why the Cloudflare preset now sets 3 s. If more than about 1 in 4 calls fail open, raise the budget (`--timeout 2500`) or pick a faster model.
