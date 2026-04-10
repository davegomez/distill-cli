---
name: distill-errors
description: Exit codes, error code catalog, retryable/retry_with decision table, and common recovery patterns.
applies_to: distill
---

# Error handling for distill

## Exit codes

| Code | Category |
|---|---|
| `0` | Success |
| `1` | Extraction error (fetch worked, extraction failed) |
| `2` | Network/auth error (fetch itself failed) |
| `3` | Validation error (bad input) |
| `4` | Action error (browser action failed) |
| `5` | Internal/setup error |

## Error code catalog

### Exit 1 — extraction errors

| Code | Meaning |
|---|---|
| `CONTENT_EMPTY` | Selector matched but produced no text |
| `SELECTOR_NOT_FOUND` | Explicit `--selector` didn't match any element |
| `EXTRACTION_LOW_QUALITY` | Fell back to heuristic, confidence = low |
| `ALL_STRATEGIES_FAILED` | Both selector chain and heuristic produced nothing |

### Exit 2 — network/auth errors

| Code | Meaning |
|---|---|
| `DNS_FAILURE` | DNS lookup failed |
| `CONNECTION_REFUSED` | Target refused the connection |
| `TIMEOUT` | Request timed out |
| `HTTP_4XX` | Client error response (status in message) |
| `HTTP_5XX` | Server error response (status in message) |
| `BOT_BLOCKED` | 403/429 with bot-block heuristics |
| `TLS_ERROR` | TLS handshake failed |
| `TOO_LARGE` | Response body exceeds size limit |

### Exit 3 — validation errors

| Code | Meaning |
|---|---|
| `INVALID_URL` | Malformed URL |
| `INVALID_SCHEME` | Non-http(s) scheme |
| `PRIVATE_NETWORK_BLOCKED` | Private/internal address blocked |
| `INVALID_PATH` | File path does not exist or is unreadable |
| `INVALID_COOKIES_FILE` | Cookies file is invalid |
| `INVALID_INPUT_JSON` | `--input` JSON is malformed |
| `INVALID_SELECTOR` | CSS selector is invalid |
| `INVALID_ACTIONS` | `--actions` JSON is malformed |

### Exit 4 — action errors

| Code | Meaning |
|---|---|
| `ACTION_SELECTOR_NOT_FOUND` | Action target element not found |
| `ACTION_TIMEOUT` | Browser action timed out |
| `ACTION_INTERCEPTED` | Dialog or overlay blocked the action |
| `ACTION_INVALID` | Malformed action definition |

### Exit 5 — internal/setup errors

| Code | Meaning |
|---|---|
| `BROWSER_NOT_INSTALLED` | Playwright browser not installed |
| `BROWSER_LAUNCH_FAILED` | Browser failed to start |
| `CACHE_CORRUPTION` | Cache database is corrupted |
| `UNKNOWN` | Unexpected internal error |

## Retryable / retry_with decision table

| Code | `retryable` | `retry_with` | Action |
|---|---|---|---|
| `CONNECTION_REFUSED` | `true` | — | Wait and retry the same command |
| `TIMEOUT` | `true` | `--timeout`, `--render` | Retry, optionally increase timeout |
| `HTTP_5XX` | `true` | `--timeout` | Wait and retry the same command |
| `BOT_BLOCKED` | `false` | `--render`, `--cookies`, `--user-agent` | Change approach (see below) |
| `BROWSER_NOT_INSTALLED` | `false` | `distill setup` | Run setup first |
| `SELECTOR_NOT_FOUND` | `false` | `--selector`, `--render` | Try without `--selector` or use `--render` |
| `ALL_STRATEGIES_FAILED` | `false` | `--render`, `--selector` | Use `--render` or provide a `--selector` |
| All others | `false` | — | Fix the input or investigate |

## Common recovery patterns

### BOT_BLOCKED

The site is blocking automated requests. Escalation path:

1. Retry with `--render` (uses a real browser)
2. Retry with `--cookies <file>` (authenticated session)
3. Retry with `--user-agent <string>` (custom user agent)

### SELECTOR_NOT_FOUND

The explicit `--selector` did not match. Recovery:

1. Retry without `--selector` (let heuristic extraction try)
2. Retry with `--render` (element may require JavaScript)
3. Use a different `--selector` value

### CONTENT_EMPTY

The selector matched but the element had no text:

1. Try `--render` (content may be JS-rendered)
2. Try a broader `--selector`
3. Check if the page requires authentication (`--cookies`)

### BROWSER_NOT_INSTALLED

Run `distill setup` to install the browser, then retry the original
command.
