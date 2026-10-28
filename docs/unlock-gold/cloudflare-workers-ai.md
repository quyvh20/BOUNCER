---
title: Free Cloudflare Workers AI Setup
description: Unlock Bouncer Level 3 Gold with Llama 4 Scout on Cloudflare Workers AI, using the free daily allocation that comes with every Cloudflare account.
---

# 🥇 Cloudflare Workers AI · Llama 4 Scout (free allocation)

Every Cloudflare account, including free ones, gets a daily Workers AI allocation at no cost. Bouncer's requests are tiny (a prompt plus up to 40 file paths), so normal use fits comfortably inside it.

## 1. Find your account ID

Open the [Cloudflare dashboard](https://dash.cloudflare.com/). Your **Account ID** is in the URL (`dash.cloudflare.com/<account-id>/…`) and on the **Workers & Pages** overview. It is 32 hex characters.

If you use Wrangler, `npx wrangler whoami` also prints it.

## 2. Create an API token with Workers AI access only

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) and choose **Create Token**.
2. Pick the **Workers AI** template. It grants `Workers AI: Read` and `Workers AI: Edit`, and nothing else.
3. Limit it to your account, choose **Continue to summary**, then **Create Token**, and copy the token.

## 3. Connect it (one line)

```bash
bouncer config --preset cloudflare-gold --account-id <ACCOUNT_ID> --key <API_TOKEN>
bouncer config --timeout 2000
```

To keep the token out of your shell history, set environment variables and leave out the flags:

```bash
export CLOUDFLARE_ACCOUNT_ID=<ACCOUNT_ID>
export CLOUDFLARE_API_TOKEN=<API_TOKEN>
bouncer config --preset cloudflare-gold
```

## Preset details

| | |
|---|---|
| Endpoint | `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1/chat/completions` |
| Model | `@cf/meta/llama-4-scout-17b-16e-instruct` |
| Level | 🥇 3, confidence gate 0.80 |
| Sent per prompt | prompt text + up to 40 file **paths** (never file contents) |

Measured from Bouncer (4 calls each):

| Model | Level | Latency | Notes |
|---|---|---|---|
| `@cf/meta/llama-4-scout-17b-16e-instruct` *(default)* | 🥇 | 1.3–1.6 s | best balance; set `--timeout 2000` |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 🥇 | 2.2–3.4 s | accurate but usually misses the budget |
| `@cf/meta/llama-3.1-8b-instruct-fast` | 🥈 | 0.7–1.0 s | fastest; Silver needs 0.90 confidence for file hints |

Switch with `--model`, for example `bouncer config --model @cf/meta/llama-3.1-8b-instruct-fast`.

## Troubleshooting

- **`failed (HTTP 401/403)`**: the token is wrong, or it has no Workers AI permission for this account.
- **`failed (HTTP 429)`** or failures late in the day: you've used up the free daily allocation. Bouncer stays on Level 1 until it resets.
- **Remove it:** `bouncer config --clear`.
