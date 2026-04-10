---
name: distill-extract
description: When to use --render, reading extraction.confidence, empty-content recovery, and interpreting extraction.strategy.
applies_to: distill
---

# Extracting content with distill

## When to use `--render`

Use `--render` for pages that rely on JavaScript to produce content:

- Single-page applications (React, Vue, Angular)
- Pages with lazy-loaded or dynamically-inserted content
- Sites that return a shell HTML document and hydrate client-side

If a plain `distill extract <url>` returns empty or low-quality content,
retry with `--render`.

**Skip `--render`** for static HTML pages, server-rendered content, and
RSS/Atom feeds — it adds latency and requires an installed browser.

## Reading `extraction.confidence`

The `extraction.confidence` field is one of `high`, `medium`, or `low`:

| Confidence | Meaning | Action |
|---|---|---|
| `high` | Matched a known content pattern (article, schema.org, etc.) | Trust the result |
| `medium` | Heuristic extraction found a plausible main content area | Verify if precision matters |
| `low` | Fell back to body text or a loose heuristic | Retry with `--selector` or `--render` |

## When `content.markdown` is empty

If `content.markdown` is empty or missing:

1. Check `extraction.confidence` — `low` confidence often means the
   extractor could not identify main content.
2. Try `--render` if the page requires JavaScript.
3. Try `--selector <css>` to target a specific container.
4. Check `extraction.strategy` to understand what was attempted.

## Interpreting `extraction.strategy`

The `extraction.strategy` field tells you which extraction path produced
the result:

- `selector` — an explicit `--selector` was used
- `selector-chain` — automatic selector chain matched (e.g., `article`,
  `[role=main]`)
- `heuristic` — fell back to content-density heuristics

If `strategy` is `heuristic` and `confidence` is `low`, the result may
contain navigation chrome or boilerplate. Retry with a targeted
`--selector`.
