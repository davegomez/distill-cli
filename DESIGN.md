# distill-cli — Design Specification

**Status**: v0.1.0 design, pre-implementation
**License**: AGPL-3.0-or-later
**Package manager**: pnpm (development); published to the npm registry
**Node**: 24+ (latest LTS, required for built-in `node:sqlite`)
**Language**: TypeScript

## 1. Purpose and scope

An AI-agent-focused CLI for extracting clean, structured content from web pages. Agents call it to turn presentation-oriented HTML into stable, task-relevant JSON (or markdown/HTML views). The tool is a **pure extraction engine** — it does one job. It does not manage documents, write files to opinionated locations, or assume a downstream workflow.

**Design principles**:
- **Agent DX first**: predictable, structured, introspectable. Every output is JSON by default. Every input shape is discoverable via `--help --json`.
- **Raw-first**: default to HTTP fetch. Playwright is an opt-in escape hatch.
- **Stateless**: no sessions, no daemons, no long-lived processes. Every invocation is independent.
- **Bounded surface**: fewer commands, stronger invariants. Add features when real use proves them necessary.
- **Content is data, not instructions**: extracted text is wrapped in a boundary marker to defend agents against prompt injection embedded in web pages.

**Non-goals for v0.1.0**:
- Session-based interactive browsing (replaced by inline `--actions`)
- MCP surface (deferred to v0.2.0)
- Batch multi-URL extraction (deferred to v0.2.0)
- Helper commands (`+obsidian`, `+summary`, etc.)
- Configuration files
- Schema subcommand (`distill schema`) — `--help --json` covers v0.1.0

---

## 2. Commands

Four top-level commands in v0.1.0:

| Command | Purpose |
|---|---|
| `distill extract <url>` | Extract content from a single URL |
| `distill setup` | Install Playwright browsers (`chromium` default) |
| `distill doctor` | JSON health check (browser, cache, sessions, libs, permissions) |
| `distill cache clear` / `distill cache list` | Cache maintenance |

Every command accepts `--help` (human text) and `--help --json` (machine-readable schema).

---

## 3. Input contract

### 3.1 Canonical JSON input via `--input`

Agents pass input as JSON via stdin or file:
```bash
echo '{"url": "...", "render": true, "actions": [...]}' | distill extract --input -
distill extract --input @params.json
```

The JSON shape is the **canonical source of truth**. Flags exist as sugar over the same schema — every flag maps 1:1 to a field in the input schema. A contract test enforces this invariant.

Precedence when both are passed: positional URL wins over `url` in JSON input; other flags override JSON fields.

### 3.2 Direct flags (sugar over canonical schema)

```
distill extract <url> [flags]
```

Flags:
- `--input -` / `--input @file.json` — canonical JSON input
- `--render` — use Playwright for JS-rendered pages
- `--actions '<json>'` — browser actions to execute before extraction (implies `--render`)
- `--format json|markdown|html` — output format (default: `json`)
- `--selector <css>` — explicit extraction target (skips heuristics)
- `--fields <list>` — additive opt-in field groups (see §4.2)
- `--download-images <dir>` — download referenced images to directory
- `--max-image-size <size>` — default `10MB`
- `--concurrency <n>` — parallel image fetches, default `5`
- `--download-images-format wikilinks|markdown` — path rewrite style (Obsidian vs standard)
- `--cookies <file>` — Netscape cookie jar (file must be mode `0600`)
- `--header "K: V"` — custom header (repeatable)
- `--user-agent <string>` — override UA string
- `--timeout <ms>` — request timeout, default `30000`
- `--retries <n>` — network retry count, default `2`
- `--max-age <duration>` / `--no-cache` / `--refresh` — cache controls
- `--max-size <size>` — max response body size, default `50MB`
- `--allow-private-network` — disable SSRF guard (explicit opt-in only)
- `--dry-run` — validate and echo the resolved canonical input, don't fetch

### 3.3 `--dry-run` semantics

`--dry-run` echoes the resolved canonical JSON input (merged from flags + `--input`) without performing any network action. Agents use this to "think out loud" — generate the input, verify it, then execute.

---

## 4. Output contract

### 4.1 Minimal default shape

```json
{
  "_meta": {
    "schema_version": "1.0.0",
    "tool_version": "0.1.0",
    "command": "extract",
    "fetched_at": "2026-04-09T14:23:00Z",
    "elapsed_ms": 842,
    "http_status": 200,
    "from_cache": false
  },
  "url": "https://example.com/post",
  "final_url": "https://example.com/post/",
  "title": "Post Title",
  "content": {
    "markdown": "<distilled_content>\n# Post Title\n\n...\n</distilled_content>"
  },
  "word_count": 1523,
  "extraction": {
    "strategy": "selector",
    "selector": "main",
    "confidence": "high",
    "archetype": "article-blog"
  },
  "warnings": []
}
```

**Invariants**:
- `_meta.schema_version` is independent of `tool_version`. Schema changes follow semver; patch bumps of the tool never break the schema.
- `content` is always an object (shape stable). Default key is `markdown` only; `html` appears only when requested.
- `content.markdown` is always wrapped in `<distilled_content>...</distilled_content>` tags by default. Use `--raw-content` to strip. Skill file `distill-content-is-data.md` instructs agents to treat content strings as untrusted data.
- `extraction.confidence` is the enum `"high" | "medium" | "low"` with rubric published in `--help --json`. Never a float.
- `extraction.archetype` is one of `"article-blog" | "docs" | "news"` in v0.1.0 (more added as the corpus grows).
- `warnings` is always present (may be empty) for non-fatal issues.

### 4.2 Additive opt-in field groups

Use `--fields <list>` to add groups to the default response. Syntax is comma-separated with `+` prefix:

```bash
distill extract <url> --fields +meta,+links,+images,+content.html
```

Groups:
| Group | Adds |
|---|---|
| `+meta` | `description`, `author`, `published`, `language`, `site_name` (top level) |
| `+links` | `links: [{text, href, rel?}]` |
| `+images` | `images: [{alt, src, local_path?}]` |
| `+content.html` | `content.html` — cleaned HTML subtree |
| `+content.text` | `content.text` — plain text version |
| `+extraction.metrics` | `extraction.metrics: {text_length, text_html_ratio, paragraphs, link_density}` |
| `+extraction.trace` | `extraction.tried: [...]`, `extraction.stripped: {...}` |
| `+actions_trace` | `_meta.actions_trace: [{index, type, result, error?, elapsed_ms}]` |
| `all` | Every group above |

### 4.3 Block-based internal representation

Even though the v0.1.0 default output is flat (`content.markdown` as a string), the **internal representation is block-based**: ordered content blocks with `(text, tag_path, link_density, heading_level, image_refs, visibility)`. Markdown/HTML/text views are rendered **from** blocks. This means:
- The algorithm can evolve (multi-candidate ranking, block merging, archetype-specific strategies) without changing the output contract.
- Future features (positional image association, block-level confidence, structural diff) are incremental additions, not rewrites.

### 4.4 Error shape

```json
{
  "_meta": {"schema_version": "1.0.0", "tool_version": "0.1.0", "command": "extract"},
  "error": {
    "code": "BOT_BLOCKED",
    "message": "Target responded with 403 after 2 retries.",
    "hint": "Try --render, or provide --cookies, or set --user-agent.",
    "retryable": false,
    "retry_with": ["--render", "--cookies", "--user-agent"],
    "received": {"url": "https://example.com/post"}
  }
}
```

**Stream**: JSON errors go to **stdout** (agents parse stdout). stderr stays empty for errors unless `isatty(stderr)` in which case a one-line human summary is written for terminal use.

**`retryable` semantics** (strict transient-only):
- `true` — same invocation will probably work if retried (5xx, timeouts, connection refused)
- `false` — don't retry without changing something (4xx, bot-block, validation, action failures)

**`retry_with`** — list of flag names that might unblock the situation. Reasons go in `hint`.

---

## 5. Actions DSL

Replaces the session model. `--actions` is a JSON array executed in order before extraction. Implies `--render`.

### 5.1 Action types (v0.1.0)

```json
[
  {"type": "wait", "selector": "article h1"},
  {"type": "wait", "ms": 2000},
  {"type": "wait", "for": "network-idle"},
  {"type": "click", "selector": ".load-more"},
  {"type": "click", "role": "button", "name": "Show more"},
  {"type": "scroll", "to": "bottom"},
  {"type": "scroll", "selector": ".infinite-scroll"},
  {"type": "fill", "selector": "input[name='q']", "value": "search term"},
  {"type": "press", "key": "Enter"},
  {"type": "dismiss", "selector": ".cookie-banner .close", "optional": true}
]
```

### 5.2 Design rules

- **`type` field required** on every action (consistent shape, easy to validate).
- **Targeting**: `selector` for CSS, `role`+`name` for semantic (a11y-based). Reject actions that specify neither or both.
- **Wait forms**: `selector`, `for` (`network-idle | load | domcontentloaded`), or `ms` (hard cap at 10s). Every wait has an implicit 30s ceiling.
- **No `eval` action.** Arbitrary JS is out of scope for v0.1.0. If users need it, they should use Playwright directly and pipe HTML into `distill extract`.
- **Failure policy**: fail-fast by default (exit code 4, `ACTION_SELECTOR_NOT_FOUND` or similar). Per-action `"optional": true` allows continuing if the target isn't present (useful for cookie banners).
- **Implicit `--render`**: `--actions` automatically enables rendering. Missing browser → `BROWSER_NOT_INSTALLED` error with `retry_with: ["distill setup"]`.
- **Trace**: always captured internally, exposed via `--fields +actions_trace`.

---

## 6. Extraction strategy

Hybrid with graceful degradation:

1. **Explicit selector** — if `--selector` passed, use it. Skip all heuristics.
2. **Selector chain** — try `main` → `article` → `[role="main"]` → `#content` → `.post-content` → `.entry-content`.
3. **Quality scoring** — for the first match, compute quality score (text length, text/HTML ratio, paragraphs vs. links).
4. **Fallback** — if score below threshold, run Readability-style scoring on `body` minus chrome.
5. **Chrome stripping** — always remove `script`, `style`, `noscript`, `nav`, `header`, `footer`, `aside`, `.cookie-banner`, social widgets BEFORE scoring.
6. **Archetype classification** — detect `article-blog | docs | news` (more archetypes later). May influence stripping rules and scoring weights in future versions.
7. **Output** — report `strategy`, `selector`, `confidence`, and `archetype` in `extraction` field so agents can decide whether to retry with different options.

### 6.1 Confidence rubric (published in `--help --json`)

- **`high`** — explicit selector matched, or selector chain matched with strong quality score (text length > 500 words, link density < 0.3)
- **`medium`** — selector chain matched with moderate quality score
- **`low`** — fell back to heuristic scoring on body, or quality metrics marginal. Agent should consider retrying with a different selector.

---

## 7. Image handling

### 7.1 Default behavior (no flag)

- Images are **not downloaded**
- `+images` field group (when requested) returns `[{alt, src}]` with absolute URLs
- Fetch dedup within a single run via in-memory URL cache

### 7.2 With `--download-images <dir>`

- **Filename**: `<md5>.<ext>` using chunked MD5 (15KB start + 15KB middle + 15KB end)
- **Extension detection priority**:
  1. `file-type` magic-byte sniffing (authoritative)
  2. URL pathname extension (fallback)
  3. `is-svg` check if `file-type` returns `xml` or nothing
  4. Skip with warning if none resolve
- **Cross-run dedup**: same content → same filename → no re-download, no duplication
- **Markdown rewrite**: `content.markdown` references are rewritten to local paths
- **Output**: each image in `+images` gets both `src` (original URL) and `local_path` (local file)
- **`--download-images-format wikilinks|markdown`** — controls syntax in `content.markdown` for Obsidian vs standard markdown
- **Auth context**: image fetches inherit `--cookies` and `--header` values from the main request
- **Failed downloads**: logged in `warnings`, markdown keeps original URL
- **Size limits**: `--max-image-size 10MB` default, skipped with warning if exceeded
- **Concurrency**: `--concurrency 5` parallel fetches default

---

## 8. Caching

**Primitive**: `node:sqlite` (built-in as of Node 22+, requiring Node 24+ means it's rock-solid) in WAL mode for concurrent writers.

**Key**: `hash(url, normalized_headers, cookies_present)`. Cookies change the cache key entirely — authenticated responses never share cache with unauthenticated ones.

**Rule**: **never cache responses when `--cookies` or an `Authorization` header is present.** Even with different cache keys, the safest policy is to bypass cache entirely for authenticated requests. Unit test enforces this invariant.

**TTL**: respects `Cache-Control` headers if stricter than default; otherwise default 1 hour. `--max-age <duration>` overrides, `--refresh` forces a fetch and updates, `--no-cache` bypasses read (still writes).

**Location**: XDG cache dir (`~/.cache/distill/` on Linux, `~/Library/Caches/distill/` on macOS). Database file: `http-cache.sqlite`.

**Atomic writes**: SQLite transactions handle concurrency natively. Parallel `distill extract` invocations on the same URL won't corrupt state.

**Commands**:
- `distill cache list` — JSON summary of cached entries (age, size, URL)
- `distill cache clear [--older-than <dur>] [--url <glob>]` — prune

---

## 9. Security hardening

### 9.1 URL validation (every URL input)

- Strict parse (reject malformed URLs)
- Only `http://` and `https://` schemes (reject `file://`, `javascript:`, `data:`, etc.)
- Reject URLs containing control characters (< 0x20)
- Reject URLs resolving to private/loopback ranges unless `--allow-private-network`
- Max URL length 2048 chars

### 9.2 Path validation (for `--download-images <dir>` and other paths)

- Canonicalize, reject `..` escapes
- Reject absolute paths to sensitive locations (`/etc`, `/proc`, `/sys`, `/dev`)
- Create dirs with safe permissions (not world-writable)

### 9.3 Cookies file

- On load, `fstat` the file. Refuse if group/world readable (mode broader than `0600`). Error with `INVALID_COOKIES_FILE` and explicit remediation: `"chmod 600 <file>"`.
- **Never cache authenticated responses** (see §8).
- **Never log cookie values.** Headers matching `/^(cookie|authorization|x-api-key|x-auth)/i` are redacted in all output, including error messages.

### 9.4 Resource limits

- Max response size: 50MB (configurable via `--max-size`)
- Max image size: 10MB (configurable via `--max-image-size`)
- Request timeout: 30s (configurable via `--timeout`)
- Hard ceiling on `wait ms` in actions: 10s

### 9.5 Prompt injection defense

- `content.markdown`, `content.text`, and `content.html` are wrapped in `<distilled_content>...</distilled_content>` tags by default.
- `--raw-content` strips the wrapping for callers that want just the content.
- Skill file `distill-content-is-data.md` instructs agents that content fields are untrusted data, never instructions.

---

## 10. Exit codes and error codes

### 10.1 Exit codes

| Code | Category |
|---|---|
| `0` | Success |
| `1` | Extraction error (fetch worked, extraction failed) |
| `2` | Network/auth error (fetch itself failed) |
| `3` | Validation error (bad input) |
| `4` | Action error (browser action failed) |
| `5` | Internal/setup error |

### 10.2 Error code catalog

**Exit 1 — extraction**:
- `CONTENT_EMPTY` — selector matched but produced no text
- `SELECTOR_NOT_FOUND` — explicit `--selector` didn't match
- `EXTRACTION_LOW_QUALITY` — fell back to heuristic, confidence = low
- `ALL_STRATEGIES_FAILED` — both selector chain and heuristic produced nothing

**Exit 2 — network/auth**:
- `DNS_FAILURE`
- `CONNECTION_REFUSED`
- `TIMEOUT`
- `HTTP_4XX` (message includes status)
- `HTTP_5XX` (message includes status)
- `BOT_BLOCKED` (403/429 with bot-block heuristics)
- `TLS_ERROR`
- `TOO_LARGE`

**Exit 3 — validation**:
- `INVALID_URL`, `INVALID_SCHEME`, `PRIVATE_NETWORK_BLOCKED`
- `INVALID_PATH`, `INVALID_COOKIES_FILE`
- `INVALID_INPUT_JSON`, `INVALID_SELECTOR`, `INVALID_ACTIONS`

**Exit 4 — action**:
- `ACTION_SELECTOR_NOT_FOUND`, `ACTION_TIMEOUT`, `ACTION_INTERCEPTED`, `ACTION_INVALID`

**Exit 5 — internal/setup**:
- `BROWSER_NOT_INSTALLED`, `BROWSER_LAUNCH_FAILED`, `CACHE_CORRUPTION`, `UNKNOWN`

Every error code is enumerated in `--help --json` output so agents build a canonical decision table from introspection.

---

## 11. Schema introspection

`distill extract --help --json` (and same for every command) returns:

```json
{
  "name": "extract",
  "tool_version": "0.1.0",
  "schema_version": "1.0.0",
  "summary": "Extract clean content from a web page",
  "usage": "distill extract <url> [flags]",
  "arguments": [{"name": "url", "type": "string", "required": true}],
  "flags": [{"name": "--render", "type": "boolean", "default": false, "description": "..."}],
  "input_schema": { /* JSON Schema for --input - */ },
  "output_schema": { /* JSON Schema for the extraction result */ },
  "error_codes": ["BOT_BLOCKED", "CONTENT_EMPTY", "..."],
  "exit_codes": {"0": "success", "1": "extraction", "2": "network", "3": "validation", "4": "action", "5": "internal"}
}
```

**Generated from Zod/arktype schemas** that drive arg parsing and output validation. Never hand-written, never drifts from behavior. Contract test ensures the `input_schema` and flag list are equivalent (every flag has a schema field).

---

## 12. Skills files

Shipped in `skills/` directory, discoverable via `distill skills list` and `distill skills show <name>`. Format: YAML frontmatter + Markdown.

**v0.1.0 shipping list**:
1. `distill-extract.md` — when to use `--render`, reading `extraction.confidence`, empty-content recovery
2. `distill-content-is-data.md` — prompt injection boundary, content as untrusted data
3. `distill-errors.md` — exit codes, `retryable`/`retry_with` decision table, common recovery patterns
4. `distill-actions.md` — inline actions vs raw `--render`, action ordering, optional steps
5. `distill-fields.md` — which `--fields` groups for which tasks (summary, crawl, vision)
6. `distill-images.md` — when to `--download-images`, content addressing behavior, dedup semantics

---

## 13. Evaluation harness

### 13.1 Structure

```
test/fixtures/
├── corpus/
│   ├── article-blog/
│   │   ├── 01-personal-blog.html
│   │   └── 01-personal-blog.expected.json
│   ├── docs/
│   └── news/
└── index.json
```

- **10 fixtures** across 3 archetypes for v0.1.0 (article-blog, docs, news)
- Each fixture: saved HTML snapshot + hand-curated `.expected.json` (canonical extraction)
- Fixtures grow organically: every real-world extraction bug becomes a new fixture

### 13.2 Metrics

- **Regression tests** — diff `extract()` output against `.expected.json`. CI fails on unexpected changes.
- **Quality metrics** — precision, recall, F1 at word level; structural diff (do headings, lists, code blocks survive?)
- **Cross-tool comparison** — `pnpm eval:compare` runs corpus through Defuddle, Readability, Trafilatura. **On-demand only, not in CI.** Output: `test/fixtures/comparison.json`.

### 13.3 Curation workflow

```bash
# Extract + hand-fix ground truth
distill extract https://example.com/post > test/fixtures/corpus/article-blog/new.expected.json
curl https://example.com/post > test/fixtures/corpus/article-blog/new.html
# Update index.json with archetype + notes
```

---

## 14. Distribution and installation

### 14.1 Package distribution

- **npm registry**, package name `distill-cli`
- Development uses pnpm; published as a standard npm package (any client can install)
- Node 24+ required (documented in `engines` field)
- No native dependencies, no postinstall downloads

### 14.2 Playwright browser install

**Never downloads during `pnpm add -g distill-cli`.**

- On first `--render` or `--actions` use, check for Chromium at `PLAYWRIGHT_BROWSERS_PATH` or default path
- If missing: exit `5` with `BROWSER_NOT_INSTALLED` error:
  ```json
  {"error": {"code": "BROWSER_NOT_INSTALLED", "hint": "Run: distill setup (≈450MB download)", "retry_with": ["distill setup"]}}
  ```
- `distill setup [--browser chromium|firefox|webkit|all] [--force] [--check]`
- Respects `PLAYWRIGHT_BROWSERS_PATH` env var (share browsers across tools, or place in container)
- `DISTILL_SKIP_BROWSER_CHECK=1` escape hatch for CI that never renders

### 14.3 `distill doctor` (JSON health check)

Checks reported as JSON:
- `node.version` meets minimum
- `playwright.installed`
- `playwright.browser.chromium.present`
- `playwright.browser.chromium.launches` (actual spawn test; translates missing-lib errors to install hints)
- `playwright.browser.version_match`
- `cache.dir.writable`, `cache.dir.free_space_mb`
- `network.dns_ok` (resolves example.com)
- `platform.tmpdir` exists and writable
- `platform.is_root` (warn if root without `--no-sandbox`)

Exit `0` if healthy, `5` if any check fails. `distill doctor --fix` prompts to install missing browser, prune stale cache, etc. (`--yes` for non-interactive CI).

---

## 15. Testing strategy (three-tier)

**Test runner**: Vitest, `environment: 'node'` (no jsdom — HTML parsing goes through `linkedom`, not browser globals).

**Layout**: test files colocated with source as `src/**/*.test.ts`. Integration and E2E tests live under `test/integration/` and `test/e2e/` respectively and are addressed via Vitest workspace projects.

### 15.1 Unit tier
- Extraction algorithm against `test/fixtures/corpus/*.html`
- No browser, no network
- Fast, deterministic, golden-output style
- Runs on every commit via `pnpm test`

### 15.2 Integration tier
- Local HTTP server (`node:http`) serves fixtures with configurable headers/cookies/status codes/delays
- Exercises HTTP caching, retries, `--cookies`, `--header`, SQLite concurrency, SSRF, path traversal
- No browser
- Runs on every commit via `pnpm test`

### 15.3 E2E (browser) tier
- Playwright smoke tests against fixtures served by the integration harness
- Tests `--render` and `--actions`
- Gated behind `DISTILL_E2E=1` env var (and a separate `pnpm test:e2e` script)
- Runs in a dedicated CI job using the `mcr.microsoft.com/playwright:v1.X-jammy` base image

### 15.4 Determinism rule
Extraction MUST be deterministic given fixed HTML. Sources of nondeterminism (timestamps, random IDs) are pinned or rounded in tests.

---

## 16. Tooling and conventions

The toolchain mirrors Dave's standard TypeScript/Node setup (reference project: `raquel/bluechart`), adapted for a Node-only CLI.

**Versioning policy**: always install the **latest** version of every tool and dependency. `pnpm add <pkg>` (no version pin). `package.json` uses caret ranges; the lockfile captures resolved versions. No specific versions are committed to in this document — upgrade freely.

### 16.1 Package manager

**pnpm** with a lockfile (`pnpm-lock.yaml`). `package.json` includes:

```json
{
  "name": "distill-cli",
  "version": "0.1.0",
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "engines": { "node": ">=24" },
  "bin": { "distill": "./bin/distill" },
  "imports": { "#/*": "./src/*" },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild", "lefthook", "playwright", "better-sqlite3"]
  }
}
```

`onlyBuiltDependencies` explicitly allowlists packages permitted to run postinstall scripts (prevents supply-chain surprises and matches pnpm's safe-by-default posture). Playwright is listed but **does not download the browser at install time** — see §14.2.

### 16.2 TypeScript

`tsconfig.json`:

```json
{
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "#/*": ["./src/*"] },

    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    "skipLibCheck": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  }
}
```

**Differences from `bluechart`** (which is a Vite-bundled web app):
- `module` / `moduleResolution`: `NodeNext` (Node-only, no bundler) instead of `ESNext` / `bundler`
- `lib`: `["ES2023"]` only — no `DOM` or `DOM.Iterable` (HTML parsing is handled by `linkedom`; no browser globals are referenced)
- `types`: `["node"]` instead of `["vite/client"]`

**Path alias**: `#/*` → `./src/*`, matching the `package.json#imports` field so the alias works at both compile and runtime without a bundler.

**Build**: `tsc` emits to `dist/`. A build step will be added during implementation — likely `tsdown` or `tsup` if startup time or single-file distribution becomes a concern. Not blocking for v0.1.0.

### 16.3 Formatter and linter

**Biome**. `biome.json` (the `$schema` URL uses whatever version is installed — update alongside the package):

```json
{
  "$schema": "https://biomejs.dev/schemas/<version>/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "ignoreUnknown": true,
    "includes": [
      "src/**",
      "test/**",
      "*.config.ts",
      "bin/**",
      "!dist/**",
      "!test/fixtures/corpus/**"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 4,
    "lineWidth": 80
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  }
}
```

**Excluded from formatting/linting**: `dist/` (build output), `test/fixtures/corpus/**` (raw HTML fixtures — don't touch). Generated JSON Schema files from the Zod source of truth are included and auto-formatted.

### 16.4 Tests

**Vitest**. `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] })],
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
        exclude: ['test/e2e/**', 'test/fixtures/**'],
        setupFiles: ['test/setup.ts'],
    },
});
```

**E2E** runs as a separate project via `vitest.e2e.config.ts` (or a standalone `playwright test` call) gated behind `DISTILL_E2E=1`.

### 16.5 Git hooks

**Lefthook**. `lefthook.yml`:

```yaml
pre-commit:
    commands:
        biome:
            glob: "*.{js,ts,cjs,mjs,json,jsonc}"
            run: pnpm biome check --write --no-errors-on-unmatched --files-ignore-unknown=true --colors=off {staged_files}
            stage_fixed: true
        type-check:
            glob: "*.{ts,tsx}"
            run: pnpm type-check
```

`pre-commit` runs Biome on staged files (auto-fixes + re-stages) and a `type-check` pass. The type-check is added vs. bluechart because a CLI's type errors can't be caught by a browser dev server.

### 16.6 Node version

**`.nvmrc`** contains `lts/*` (track whatever is the current LTS). `package.json#engines.node` pins `>=24` to enforce the minimum at install time.

### 16.7 `package.json` scripts

```json
{
  "scripts": {
    "build": "tsc",
    "check": "pnpm run type-check && biome check .",
    "type-check": "tsc --noEmit",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "DISTILL_E2E=1 vitest run --config vitest.e2e.config.ts",
    "eval": "tsx test/eval.ts",
    "eval:compare": "tsx test/eval.ts --compare"
  }
}
```

`pnpm check` is the one-liner CI uses — `type-check` first (fast-fail on TS errors), then Biome. `pnpm eval` runs the quality metrics against the corpus; `pnpm eval:compare` is the on-demand cross-tool comparison against Defuddle / Readability / Trafilatura.

---

## 17. Repo layout

```
distill-cli/
├── src/
│   ├── cli.ts                 # entry point, arg parsing, subcommand routing
│   ├── commands/
│   │   ├── extract.ts
│   │   ├── setup.ts
│   │   ├── doctor.ts
│   │   └── cache.ts
│   ├── extractor/
│   │   ├── fetch.ts           # raw HTTP + retries + caching
│   │   ├── render.ts          # Playwright wrapper
│   │   ├── actions.ts         # --actions DSL executor
│   │   ├── strategies/
│   │   │   ├── explicit.ts
│   │   │   ├── selector-chain.ts
│   │   │   └── heuristic.ts
│   │   ├── blocks.ts          # DOM → block representation (via linkedom)
│   │   ├── archetype.ts       # page classification
│   │   ├── markdown.ts        # blocks → markdown renderer
│   │   └── confidence.ts
│   ├── images/
│   │   ├── download.ts
│   │   ├── hash.ts            # chunked MD5
│   │   └── filename.ts
│   ├── cache/
│   │   └── sqlite.ts          # node:sqlite cache layer
│   ├── schema/                # Zod schemas — source of truth
│   │   ├── input.ts
│   │   ├── output.ts
│   │   └── errors.ts
│   ├── security/
│   │   ├── url.ts             # SSRF, scheme checks
│   │   ├── path.ts            # traversal guards
│   │   └── cookies.ts         # permission check
│   └── util/
├── skills/                    # shipped agent skill files
├── test/
│   ├── setup.ts               # Vitest shared setup
│   ├── fixtures/corpus/       # eval harness HTML + expected JSON
│   ├── eval.ts                # quality metrics + regression
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── bin/distill                # executable entry point (#!/usr/bin/env node)
├── dist/                      # tsc build output (gitignored)
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── vitest.e2e.config.ts
├── lefthook.yml
├── .nvmrc                     # lts/*
├── .gitignore
├── LICENSE                    # AGPL-3.0-or-later
├── DESIGN.md                  # this document
└── README.md                  # user-facing docs
```

---

## 18. Deferred to post-v0.1.0

These were considered and explicitly excluded from v0.1.0 scope:

- **Sessions** (`browse`, `inspect`, `find`, `act`, `close`, `list`) — replaced by inline `--actions`; add only if inline actions prove insufficient
- **MCP surface** — add after CLI schema is stable
- **Batch extraction** (multiple URLs per invocation) — add if browser launch cost proves to be a real pain point
- **`distill schema` subcommand** — `--help --json` is enough until a consumer demands more
- **Helper commands** (`+obsidian`, `+summary`, etc.) — earned by real agent workflows
- **Configuration file** — env vars cover v0.1.0; add if users ask
- **Homebrew / single binary / Docker image** — npm-only for now
- **Live fetch tests** — flaky, ethical concerns; stick to offline fixtures
- **Rich field masking query language** (JSONPath / XPath) — additive groups suffice
- **Multiple archetypes beyond article-blog/docs/news** — add as the corpus grows
- **Arbitrary JS `eval` action** — bounded action set only
- **Request coalescing in cache** — SQLite + atomic writes suffice for v0.1.0

---

## 19. Known risks to address during implementation

- **Extraction quality is the wedge.** If the block-based pipeline doesn't actually beat Defuddle on the benchmark corpus, the entire "we're better" thesis collapses. The eval harness exists specifically to catch this early.
- **Playwright in containers** can fail cryptically (missing libs). `distill doctor` must translate these errors to actionable install hints.
- **Markdown fidelity** — tables, code blocks, nested lists, math, footnotes. These are the common failure points in extraction tools. The block representation should preserve enough structure to render them correctly.
- **Agent mistakes with `--actions`** — agents will pass brittle selectors. Rich action traces + clear `ACTION_SELECTOR_NOT_FOUND` errors with `retry_with` suggestions are the recovery loop.
- **Cache + cookies interaction** — the "never cache authenticated" rule has to be a unit test, not a comment.

---

*End of design spec. Implementation begins from here.*
