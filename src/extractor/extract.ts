import { parseHTML } from 'linkedom';
import { classifyArchetype } from '#/extractor/archetype.ts';
import type { Block } from '#/extractor/blocks.ts';
import { domToBlocks } from '#/extractor/blocks.ts';
import { computeConfidence, computeMetrics } from '#/extractor/confidence.ts';
import { defaultPageFetcher } from '#/extractor/default-fetcher.ts';
import { type FullExtractResult, resolveFields } from '#/extractor/fields.ts';
import { renderHtml } from '#/extractor/html.ts';
import { renderMarkdown } from '#/extractor/markdown.ts';
import type {
    ExtractionResult,
    ExtractOptions,
    FetchRequest,
    FetchResult,
} from '#/extractor/pipeline.ts';
import { extractWithHeuristic } from '#/extractor/strategies/heuristic.ts';
import { extractWithSelectorChain } from '#/extractor/strategies/selector-chain.ts';
import { stripChrome } from '#/extractor/strip-chrome.ts';
import { renderText } from '#/extractor/text.ts';
import { wrapContentFields } from '#/extractor/wrap-content.ts';
import {
    contentEmpty,
    DistillError,
    selectorNotFound,
    unknownError,
} from '#/schema/errors.ts';
import type { ExtractInput } from '#/schema/input.ts';
import { validateUrl } from '#/security/url.ts';

/** Parse "K: V" header strings into a Record. */
function parseHeaders(
    headerList: string[] | undefined,
): Record<string, string> | undefined {
    if (!headerList || headerList.length === 0) return undefined;
    const result: Record<string, string> = {};
    for (const h of headerList) {
        const idx = h.indexOf(':');
        if (idx > 0) {
            result[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
        }
    }
    return result;
}

/** Parse a size string like "50MB" into bytes. */
function parseSize(size: string): number {
    const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!match) return 50 * 1024 * 1024; // default 50MB
    const value = Number.parseFloat(match[1]);
    switch (match[2].toUpperCase()) {
        case 'B':
            return value;
        case 'KB':
            return value * 1024;
        case 'MB':
            return value * 1024 * 1024;
        case 'GB':
            return value * 1024 * 1024 * 1024;
        default:
            return 50 * 1024 * 1024;
    }
}

/** Map ExtractInput to the narrow FetchRequest the fetcher needs. */
export function toFetchRequest(input: ExtractInput): FetchRequest {
    return {
        render: input.render,
        headers: parseHeaders(input.header),
        cookies: input.cookies,
        userAgent: input.user_agent,
        timeout: input.timeout,
        maxSize: parseSize(input.max_size),
        retries: input.retries,
        noCache: input.no_cache,
        refresh: input.refresh,
        actions: input.actions,
    };
}

/** Get the title from a parsed document. */
function extractTitle(
    document: ReturnType<typeof parseHTML>['document'],
): string {
    return document.querySelector('title')?.textContent?.trim() ?? '';
}

/** Count words across all visible blocks. */
function countWords(blocks: Block[]): number {
    return blocks
        .filter((b) => b.visibility === 'visible')
        .reduce((sum, b) => sum + b.wordCount, 0);
}

/** Extract page metadata from <meta> and <html> tags for the +meta group. */
function extractPageMeta(document: ReturnType<typeof parseHTML>['document']): {
    description: string | null;
    author: string | null;
    published: string | null;
    language: string | null;
    site_name: string | null;
} {
    const metaContent = (name: string): string | null => {
        const el =
            document.querySelector(`meta[name="${name}"]`) ??
            document.querySelector(`meta[property="${name}"]`);
        return el?.getAttribute('content')?.trim() || null;
    };

    return {
        description:
            metaContent('description') ?? metaContent('og:description'),
        author: metaContent('author'),
        published:
            metaContent('article:published_time') ??
            metaContent('date') ??
            metaContent('DC.date.issued'),
        language:
            document.documentElement?.getAttribute('lang')?.trim() || null,
        site_name: metaContent('og:site_name'),
    };
}

/** Collect unique images from extraction blocks for the +images group. */
function extractImages(
    blocks: Block[],
): Array<{ alt: string; src: string; local_path?: string }> {
    const seen = new Set<string>();
    const images: Array<{ alt: string; src: string }> = [];
    for (const block of blocks) {
        for (const img of block.imageRefs) {
            if (!seen.has(img.src)) {
                seen.add(img.src);
                images.push({ alt: img.alt, src: img.src });
            }
        }
    }
    return images;
}

/**
 * Run the full extract pipeline per DESIGN.md §6.
 *
 * Steps: validate URL → fetch → parse HTML → strip chrome →
 * strategy selection → block extraction → archetype → confidence →
 * render views → build full result → resolve fields.
 */
export async function runExtract(
    input: ExtractInput,
    options?: ExtractOptions,
): Promise<Record<string, unknown>> {
    const startTime = Date.now();

    // 1. Validate URL
    const url = validateUrl(input.url, {
        allowPrivateNetwork: input.allow_private_network,
    });

    // 2. Fetch (raw HTTP) or render (Playwright) via PageFetcher
    const fetcher = options?.fetcher ?? defaultPageFetcher;
    const request = toFetchRequest(input);
    let fetchResult: FetchResult;
    try {
        fetchResult = await fetcher.fetch(url, request);
    } catch (err) {
        if (err instanceof DistillError) throw err;
        throw unknownError(err instanceof Error ? err.message : String(err));
    }

    const { html, finalUrl, httpStatus, fromCache, actionTrace } = fetchResult;

    // 3. Parse HTML via linkedom
    const { document } = parseHTML(html);

    // 4. Strip chrome (mutates document in place)
    const stripResult = stripChrome(document);

    // 5. Extraction strategy
    let extraction: ExtractionResult;

    if (input.selector) {
        // Explicit strategy — use the provided selector
        const el = document.querySelector(input.selector);
        if (!el) {
            throw selectorNotFound(input.selector);
        }
        const blocks = domToBlocks(`<html><body>${el.innerHTML}</body></html>`);
        const visibleText = blocks
            .filter((b) => b.visibility === 'visible')
            .reduce((sum, b) => sum + b.text.length, 0);
        if (visibleText === 0) {
            throw contentEmpty(input.selector);
        }
        extraction = {
            strategy: 'explicit',
            selector: input.selector,
            blocks,
            tried: [input.selector],
        };
    } else {
        // Selector chain, then heuristic fallback
        const chainResult = extractWithSelectorChain(document);
        if (chainResult) {
            extraction = { ...chainResult, tried: [chainResult.selector] };
        } else {
            const heuristicResult = extractWithHeuristic(document);
            extraction = { ...heuristicResult, tried: [] };
        }
    }

    // 6. Classify archetype
    const archetype = classifyArchetype(document, url, extraction.blocks);

    // 7. Compute confidence
    const confidence = computeConfidence(
        extraction.strategy,
        extraction.blocks,
    );

    // 8. Render all content views
    const markdown = renderMarkdown(extraction.blocks);
    const contentHtml = renderHtml(extraction.blocks);
    const contentText = renderText(extraction.blocks);

    // 9. Compute metrics for +extraction.metrics
    const metrics = computeMetrics(extraction.blocks, html.length);

    // 10. Extract page metadata for +meta
    const meta = extractPageMeta(document);

    // 11. Extract images for +images (links deferred to block-level extraction)
    const images = extractImages(extraction.blocks);

    // 12. Build full result
    const elapsedMs = Date.now() - startTime;

    const fullResult: FullExtractResult = {
        _meta: {
            schema_version: '1.0.0',
            tool_version: '0.1.0',
            command: 'extract',
            fetched_at: new Date().toISOString(),
            elapsed_ms: elapsedMs,
            http_status: httpStatus,
            from_cache: fromCache,
            actions_trace: actionTrace,
        },
        url: input.url,
        final_url: finalUrl,
        title: extractTitle(document),
        content: {
            markdown,
            html: contentHtml,
            text: contentText,
        },
        word_count: countWords(extraction.blocks),
        extraction: {
            strategy: extraction.strategy,
            selector: extraction.selector,
            confidence,
            archetype,
            metrics,
            tried: extraction.tried,
            stripped: stripResult.stripped,
        },
        warnings: [],
        description: meta.description,
        author: meta.author,
        published: meta.published,
        language: meta.language,
        site_name: meta.site_name,
        links: [],
        images,
    };

    // 13. Resolve field groups (§4.2)
    const resolved = resolveFields(input.fields ?? [], fullResult);

    // 14. §9.5 — Wrap content fields for prompt injection defense
    return wrapContentFields(resolved, input.raw_content);
}
