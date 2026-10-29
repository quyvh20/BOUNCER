---
title: 100% Offline Setup with Ollama
description: Run Bouncer's AI router fully offline with Ollama and Qwen2.5-Coder — 7B for Level 2 Silver, 14B or 32B for Level 3 Gold. No API key, nothing leaves your machine.
---

# 🔒 Ollama · Qwen2.5-Coder (100% offline)

**Recommended #3.** Nothing leaves your machine and no key is needed. You trade API latency for your own hardware.

## 1. Install Ollama and pull a model

Install Ollama from [ollama.com/download](https://ollama.com/download), then pick a model size:

| Model | Level | Download | Good for |
|---|---|---|---|
| `qwen2.5-coder:7b` | 🥈 Silver | ~4.7 GB | laptops, 8 GB+ VRAM or Apple Silicon |
| `qwen2.5-coder:14b` | 🥇 Gold | ~9 GB | 12–16 GB VRAM, M-series Pro/Max |
| `qwen2.5-coder:32b` | 🥇 Gold | ~20 GB | 24 GB+ VRAM |

```bash
ollama pull qwen2.5-coder:14b
```

## 2. Connect it (one line)

```bash
# Gold
bouncer config --preset ollama-coder --model qwen2.5-coder:14b

# Silver (the preset default)
bouncer config --preset ollama-coder
```

Bouncer talks to Ollama's OpenAI-compatible endpoint at `http://localhost:11434/v1/chat/completions`.

## 3. Make it fast enough

Bouncer gives the AI **1500 ms** per call and then falls back to Level 1, so a slow local model never delays you, but it also doesn't help.

- **Keep the model loaded.** Ollama unloads idle models after 5 minutes, and the first request after that has to load the model again and will time out. Preload it for 2 hours:

  ```bash
  curl http://localhost:11434/api/generate -d '{"model": "qwen2.5-coder:14b", "keep_alive": "2h"}'
  ```

  Or set `OLLAMA_KEEP_ALIVE=2h` in the environment where Ollama runs.

- **Raise the budget** if your GPU is a bit slower:

  ```bash
  bouncer config --timeout 3000
  ```

- **Watch fail-opens** in `bouncer stats`. If most AI calls fail open, switch to the 7B model or [Groq](./groq-70b-free).

::: info CPU only?
A 14B model on CPU usually takes several seconds per answer, which is too slow for the prompt hook. Stay on 🥉 Level 1, or use `qwen2.5-coder:7b` with `--timeout 3000`.
:::

## Troubleshooting

- **`failed (fetch failed)`**: Ollama isn't running. Start the app or run `ollama serve`.
- **`failed (HTTP 404)`**: the model isn't pulled. Run `ollama pull <model>`.
- **Remove it:** `bouncer config --clear`.
