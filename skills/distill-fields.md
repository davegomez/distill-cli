---
name: distill-fields
description: Which --fields combos fit common tasks — article summary, crawling, vision pipeline, full extraction.
applies_to: distill
---

# Choosing fields for distill

## Default output (no `--fields`)

Without `--fields`, distill returns:

- `url`, `title`
- `content.markdown`
- `extraction.strategy`, `extraction.confidence`
- `_meta` (schema version, tool version, timing)

This is enough for most summarization and reading tasks.

## Common `--fields` combinations

### Article summary (minimal)

```bash
distill extract <url>
```

No extra fields needed. The default `content.markdown` and `title`
are sufficient for summarizing articles.

### Crawling and link discovery (`+links`)

```bash
distill extract <url> --fields +links
```

Adds `links: [{text, href, rel?}]` — all links found in the content
area. Use this when building a crawl frontier, checking outbound
references, or extracting navigation structure.

### Vision pipeline (`+images`, `--download-images`)

```bash
distill extract <url> --fields +images --download-images ./images
```

Adds `images: [{alt, src, local_path}]`. Each image is downloaded to
the specified directory with content-addressed filenames. Use this for
pipelines that need to process or display images locally.

### Metadata extraction (`+meta`)

```bash
distill extract <url> --fields +meta
```

Adds `description`, `author`, `published`, `language`, `site_name`.
Use this when cataloging pages or building reference databases.

### Full extraction (`all`)

```bash
distill extract <url> --fields all
```

Returns every field group: `+meta`, `+links`, `+images`, `+content.html`,
`+content.text`, `+extraction.metrics`, `+extraction.trace`. Use this
for debugging extraction quality or when you need every available signal.

### Debugging extraction (`+extraction.metrics`, `+extraction.trace`)

```bash
distill extract <url> --fields +extraction.metrics,+extraction.trace
```

Adds text length, text-to-HTML ratio, paragraph count, link density,
and the list of strategies tried. Use this to understand why extraction
produced unexpected results.
