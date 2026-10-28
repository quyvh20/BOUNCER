---
title: Free Gemini 2.5 Flash Setup
description: Unlock Bouncer Level 3 Gold with a free Google AI Studio API key and Gemini 2.5 Flash through its OpenAI-compatible endpoint.
---

# 🥇 Google AI Studio · Gemini 2.5 Flash (free)

**Recommended #2.** Gemini 2.5 Flash has a huge context window and strong reasoning. It's a great fit for the 🧠 Executive Summary in [rescue handovers](/guide/vip-evacuation-rescue).

## 1. Get a free key

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key** and copy it (it starts with `AIza`).

## 2. Connect it (one line)

```bash
bouncer config --preset gemini-gold --key AIza_your_key_here
```

Or keep the key in your environment (`GEMINI_API_KEY` or `GOOGLE_API_KEY`):

```bash
export GEMINI_API_KEY=AIza_your_key_here
bouncer config --preset gemini-gold
```

## Preset details

| | |
|---|---|
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` |
| Model | `gemini-2.5-flash` |
| Level | 🥇 3, confidence gate 0.80 |
| Sent per prompt | prompt text + up to 40 file **paths** (never file contents) |

::: warning Privacy on the free tier
Google's terms for unpaid Gemini API usage allow prompts to be used to improve Google products. If your prompts are sensitive, use a paid key or [Ollama](./ollama-local) instead.
:::

::: tip Latency
Flash usually answers within Bouncer's 1500 ms budget. A slow reply simply falls back to Level 1 for that prompt. Run `bouncer stats` to see how often that happens ("fail-opens"), and raise the budget with `bouncer config --timeout 2500` if needed.
:::

## Troubleshooting

- **`failed (HTTP 400/403)`**: the key is invalid, or the Gemini API isn't enabled for its project. Create a fresh key in AI Studio.
- **`failed (HTTP 429)`**: free-tier quota reached. Bouncer stays on Level 1 until it resets.
- **Remove it:** `bouncer config --clear`.
