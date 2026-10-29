---
title: Send Feedback
description: Tell the Bouncer team about a wrong block, a bug or an idea. Every report makes the prompt checks fairer for everyone using Claude Code and Codex.
---

# Send Feedback

Bouncer gets better from real prompts. Pick what fits; each opens a short form on GitHub (a free GitHub account is needed).

<div class="feedback-cards">
  <a class="feedback-card" href="https://github.com/quyvh20/BOUNCER/issues/new?template=wrong-block.yml">
    <strong>🚦 Wrong or missed block</strong>
    <span>It stopped a fine prompt, let a bad one through, or the message was confusing.</span>
  </a>
  <a class="feedback-card" href="https://github.com/quyvh20/BOUNCER/issues/new?template=bug.yml">
    <strong>🐛 Bug</strong>
    <span>Install, hooks, the report, stats or a command doesn't work.</span>
  </a>
  <a class="feedback-card" href="https://github.com/quyvh20/BOUNCER/issues/new?template=idea.yml">
    <strong>💡 Idea or feedback</strong>
    <span>A feature you'd like, or what you think so far.</span>
  </a>
</div>

## Before you post

- **Remove secrets and private code.** A safe paraphrase of the prompt is enough.
- **Add your setup.** Run this and paste its first line:

```bash
bouncer feedback
```

It prints your Bouncer version, Node.js version, OS, mode and AI provider (never your key), and opens this page.

## Other ways

- Quick questions: the [FAQ](/guide/faq) may already answer it.
- Security problems: report them [privately](https://github.com/quyvh20/BOUNCER/security/advisories/new), not in a public issue.
- Improve the docs directly: every page has an **Edit this page on GitHub** link at the bottom.
