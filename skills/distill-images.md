---
name: distill-images
description: When to use --download-images, content-addressing behavior, and cross-run deduplication.
applies_to: distill
---

# Image handling in distill

## When to use `--download-images`

Use `--download-images <dir>` when images need to be **available locally**:

- **Human consumption** — generating reports, documents, or presentations
  where images must render offline
- **Offline use** — saving pages for later reading without network access
- **Obsidian vaults** — embedding images in notes with local references
  (`--download-images-format wikilinks` for Obsidian syntax)

**Do not** use `--download-images` when:

- An agent or LLM will consume the output — URLs in the `+images` field
  are sufficient; downloading wastes bandwidth and disk
- You only need image metadata (alt text, dimensions) — use
  `--fields +images` without downloading
- The images are decorative and irrelevant to the content

## Content-addressing behavior

Downloaded images use content-addressed filenames: `<md5>.<ext>`.

The MD5 is computed from three 15KB chunks (start, middle, end) of the
image data, making it fast for large files while still unique.

The extension is determined by:

1. Magic-byte sniffing (authoritative)
2. URL pathname extension (fallback)
3. SVG detection if magic bytes are inconclusive
4. Skipped with a warning if none resolve

**Same URL, same content = same local file.** If the same image appears
on multiple pages, it is stored once.

## Cross-run deduplication

Because filenames are content-addressed, repeated runs of distill on
the same (or overlapping) pages will not re-download images that already
exist in the output directory. This makes incremental crawling efficient:

```bash
# First run downloads all images
distill extract <url1> --fields +images --download-images ./images

# Second run skips images already in ./images
distill extract <url2> --fields +images --download-images ./images
```

`content.markdown` references are rewritten to local paths. If a
download fails, the original URL is kept and a warning is added to
the `warnings` array.
