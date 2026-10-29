---
title: Free Groq Llama 3.3 70B Setup
description: Unlock Bouncer Level 3 Gold in 30 seconds with a free Groq Cloud API key and Llama 3.3 70B Versatile, the fastest free option for semantic file routing.
---

# 🥇 Groq · Llama 3.3 70B (free)

**Recommended #1.** Groq serves Llama 3.3 70B fast enough to fit comfortably inside Bouncer's 1.5-second budget.

## 1. Get a free key

1. Open [console.groq.com/keys](https://console.groq.com/keys) and sign in.
2. Click **Create API Key**, name it `bouncer`, and copy it (it starts with `gsk_`).

## 2. Connect it (one line)

```bash
bouncer config --preset groq-gold --key gsk_your_key_here
```

To keep the key out of your shell history, set it as an environment variable and leave out `--key`:

```bash
export GROQ_API_KEY=gsk_your_key_here
bouncer config --preset groq-gold
```

Bouncer saves the config, then sends one test request:

```text
  Intelligence  🥇 LEVEL 3 (Gold 70B/Flash) · Groq Cloud · llama-3.3-70b-versatile
  🥇 LEVEL 3 unlocked! Semantic file resolution + AI rescue summaries are on.
  Testing Groq Cloud (llama-3.3-70b-versatile)… ok (180ms → TRIVIAL, confidence 0.9)
```

## Preset details

| | |
|---|---|
| Endpoint | `https://api.groq.com/openai/v1/chat/completions` |
| Model | `llama-3.3-70b-versatile` |
| Level | 🥇 3, confidence gate 0.80 |
| Sent per prompt | prompt text + up to 40 file **paths** (never file contents) |

Use a different Groq model with `--model`, for example `bouncer config --preset groq-gold --model llama-3.1-8b-instant` (grades as 🥈 Silver).

## Troubleshooting

- **`failed (HTTP 401)`**: the key is wrong or was revoked. Create a new one.
- **`failed (HTTP 429)`**: you hit Groq's free-tier rate limit. Bouncer falls back to Level 1 until it resets, and your prompts are never held up.
- **Remove it:** `bouncer config --clear`.
