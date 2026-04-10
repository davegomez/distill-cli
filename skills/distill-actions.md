---
name: distill-actions
description: When to use inline --actions vs raw --render, action ordering tips, and when to mark actions optional.
applies_to: distill
---

# Using actions with distill

## When to use `--actions` vs `--render`

Use **`--render` alone** when the page just needs JavaScript execution
to produce content but requires no interaction (clicking, scrolling,
form filling).

Use **`--actions`** when you need to interact with the page before
extracting content:

- Dismissing cookie banners or modals
- Clicking "load more" buttons
- Scrolling to trigger lazy content
- Filling search forms
- Navigating multi-step flows

`--actions` implies `--render` automatically — you never need both flags.

## Action ordering tips

Actions execute sequentially in array order. Follow this general pattern:

1. **Wait** for the page to be ready (`wait` with `for: "network-idle"`
   or a key selector)
2. **Dismiss** overlays (cookie banners, modals) — mark these `optional`
3. **Interact** (click, fill, scroll) to reach the target content
4. **Wait** for the result to appear (wait for a specific selector)

Example:

```json
[
  {"type": "wait", "for": "network-idle"},
  {"type": "dismiss", "selector": ".cookie-banner .close", "optional": true},
  {"type": "click", "selector": ".show-full-article"},
  {"type": "wait", "selector": ".article-body"}
]
```

## When to mark actions `optional`

Mark an action `"optional": true` when the target element may or may
not be present, and its absence should not fail the extraction:

- **Cookie banners** — not shown on every visit
- **Newsletter popups** — may appear only for first-time visitors
- **Age gates** — may already be dismissed
- **"Show more" buttons** — may not exist if content is short

Without `optional`, a missing selector causes exit code 4
(`ACTION_SELECTOR_NOT_FOUND`). With `optional`, the action is skipped
and extraction continues.

**Never** mark critical interactions as optional. If the action is
required to reach the target content, leave `optional` unset (defaults
to `false`) so failures surface immediately.
