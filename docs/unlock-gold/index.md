---
title: Bronze vs Silver vs Gold — Intelligence Levels
description: Compare Bouncer's three intelligence levels and unlock Level 3 Gold semantic file routing for free with Groq, Gemini 2.5 Flash or a local Ollama model.
---

# Bronze vs Silver vs Gold

Bouncer works fully offline. Connecting a free AI model makes it smarter about *which files* a prompt is about and *how hard* the task is.

## Capability matrix

| Capability | 🥉 Level 1 Bronze | 🥈 Level 2 Silver | 🥇 Level 3 Gold |
|---|:-:|:-:|:-:|
| API key needed | none | optional (local) | free key or local GPU |
| Network | none | provider you choose | provider you choose |
| 🔑 Secret & 📜 log blocking | ✅ | ✅ | ✅ |
| 🛑 Opus overkill guard | ✅ regex | ✅ AI | ✅ AI |
| 🧹 Context-bloat handover | ✅ | ✅ | ✅ |
| `bouncer-scout` Haiku offloading | ✅ | ✅ | ✅ |
| Git-truth hints (`git status`, `@file`) | ✅ | ✅ | ✅ |
| Semantic complexity (TRIVIAL / STANDARD / COMPLEX) | regex | ✅ | ✅ |
| Semantic file resolution ("the payment webhook" → `src/payment/stripe.ts`) | — | ✅ at ≥ 0.90 confidence | ✅ at ≥ 0.80 confidence |
| Rewrite of vague prompts (to clipboard) | — | ✅ | ✅ |
| 🧠 Executive summary in rescues | — | — | ✅ |

Every AI result still passes the [5 safety laws](/guide/safety-architecture): hallucinated files are stripped, low-confidence guesses are dropped, and any call slower than 1500 ms falls back to Level 1.

## How models are graded

Bouncer grades the model you configure automatically:

| Model | Level |
|---|---|
| *(none configured)* | 🥉 1 |
| Open-weights models **under 14B** parameters: `llama-3.1-8b-instant`, `qwen2.5-coder:7b`, `gemma2-9b-it` | 🥈 2 |
| Open-weights models **14B and up**: `llama-3.3-70b-versatile`, `qwen2.5-coder:14b`, `qwen2.5-coder:32b` | 🥇 3 |
| Frontier "flash/pro" API models: `gemini-2.5-flash`, `gpt-4o`, … | 🥇 3 |
| `*-mini`, `*-nano`, `*-lite` variants, and models Bouncer doesn't recognise | 🥈 2 |

Not sure which model? See the measured [⭐ recommended models](./recommended-models).

## Pick a path (each takes ~30 seconds)

| | Best for | Cost | Setup |
|---|---|---|---|
| [**Groq · Llama 3.3 70B**](./groq-70b-free) — *recommended #1* | lowest latency | free tier | `bouncer config --preset groq-gold --key …` |
| [**Google AI Studio · Gemini 2.5 Flash**](./gemini-flash-free) | big context, strong reasoning | free tier | `bouncer config --preset gemini-gold --key …` |
| [**Cloudflare Workers AI · Llama 4 Scout**](./cloudflare-workers-ai) | already on Cloudflare | free daily allocation | `bouncer config --preset cloudflare-gold --account-id … --key …` |
| [**Ollama · Qwen2.5-Coder**](./ollama-local) | 100% offline, private | your hardware | `bouncer config --preset ollama-coder` |

Check your level at any time:

```bash
bouncer stats
```
