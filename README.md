# distill-cli

An AI-agent-focused CLI for extracting clean, structured content from web pages. Turns presentation-oriented HTML into stable, task-relevant JSON (or markdown/HTML views). Pure extraction engine -- one job, no opinions about downstream workflow.

## Install

```bash
pnpm add -g distill-cli
distill setup
```

Requires Node 24+.

## Quick start

Extract an article as JSON (default output):

```bash
distill extract https://example.com/post
```

Render a JS-heavy page with browser actions before extraction:

```bash
distill extract https://example.com/spa \
  --render \
  --actions '[{"type":"click","selector":".load-more"},{"type":"wait","for":"network-idle"}]'
```

Download images locally and include image metadata in output:

```bash
distill extract https://example.com/post \
  --download-images ./images \
  --fields +images
```

## Commands

```
distill extract <url>       Extract content from a single URL
distill setup               Install Playwright browsers (chromium default)
distill doctor              JSON health check (browser, cache, libs, permissions)
distill cache clear|list    Cache maintenance
distill skills              List bundled skill files for agent integration
```

Every command accepts `--help` (human text) and `--help --json` (machine-readable schema).
All output is JSON by default. Input can be passed as flags or canonical JSON via `--input`.

See [DESIGN.md](DESIGN.md) for the full specification.

## License

AGPL-3.0-or-later
