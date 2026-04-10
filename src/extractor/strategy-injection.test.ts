import { describe, expect, it } from 'vitest';
import { runExtract } from '#/extractor/extract.ts';
import type { ExtractionResult, SelectStrategy } from '#/extractor/pipeline.ts';
import { fakeFetcher, parseInput } from '#/extractor/test-utils.ts';

/** Minimal HTML — just enough for linkedom to parse and strip-chrome to run. */
const MINIMAL_HTML =
    '<html><head><title>Injected</title></head><body><p>Body text.</p></body></html>';

/** Create a fake strategy that returns predetermined blocks. */
function fakeStrategy(
    overrides: Partial<ExtractionResult> = {},
): SelectStrategy {
    return (_document, _selector?) => ({
        strategy: 'selector',
        selector: 'main',
        blocks: [
            {
                id: 'html/body/main/p:0',
                text: 'Injected content for testing.',
                tagPath: ['html', 'body', 'main', 'p'],
                headingLevel: null,
                linkDensity: 0,
                wordCount: 4,
                imageRefs: [],
                visibility: 'visible' as const,
                childBlockIds: [],
            },
        ],
        tried: ['main'],
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// Injection basics
// ---------------------------------------------------------------------------

describe('SelectStrategy injection via ExtractOptions', () => {
    it('uses injected strategy instead of default', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(MINIMAL_HTML),
            selectStrategy: fakeStrategy({
                strategy: 'explicit',
                selector: '.injected',
                tried: ['.injected'],
            }),
        });

        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.strategy).toBe('explicit');
        expect(extraction.selector).toBe('.injected');
    });

    it('computes archetype from injected blocks', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(MINIMAL_HTML),
            selectStrategy: fakeStrategy(),
        });

        const extraction = result.extraction as Record<string, unknown>;
        // Archetype is computed from blocks, URL, and document — not from strategy
        expect(['article-blog', 'docs', 'news']).toContain(
            extraction.archetype,
        );
    });

    it('computes confidence from injected strategy and blocks', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(MINIMAL_HTML),
            selectStrategy: fakeStrategy({ strategy: 'heuristic' }),
        });

        const extraction = result.extraction as Record<string, unknown>;
        // Heuristic strategy → low confidence
        expect(extraction.confidence).toBe('low');
    });

    it('resolves field groups with injected blocks', async () => {
        const result = await runExtract(
            parseInput({ fields: ['+extraction.metrics'] }),
            {
                fetcher: fakeFetcher(MINIMAL_HTML),
                selectStrategy: fakeStrategy(),
            },
        );

        const extraction = result.extraction as Record<string, unknown>;
        const metrics = extraction.metrics as Record<string, number>;
        expect(metrics).toBeDefined();
        expect(metrics.text_length).toBeGreaterThan(0);
    });

    it('wraps content from injected blocks', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(MINIMAL_HTML),
            selectStrategy: fakeStrategy(),
        });

        const content = result.content as Record<string, string>;
        expect(content.markdown).toMatch(/^<distilled_content>\n/);
        expect(content.markdown).toMatch(/\n<\/distilled_content>$/);
    });

    it('falls back to default selectStrategy when not injected', async () => {
        // HTML with <main> — default strategy should pick it up via selector chain
        const html =
            '<html><head><title>T</title></head><body><main><p>Real content here.</p></main></body></html>';
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(html),
        });

        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.strategy).toBe('selector');
        expect(extraction.selector).toBe('main');
    });
});
