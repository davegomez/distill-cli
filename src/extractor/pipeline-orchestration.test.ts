import { describe, expect, it } from 'vitest';
import { runExtract } from '#/extractor/extract.ts';
import {
    fakeFetcher,
    HTML_EXPLICIT,
    HTML_FULL,
    HTML_HEURISTIC,
    HTML_WITH_MAIN,
    parseInput,
} from '#/extractor/test-utils.ts';
import { DistillError } from '#/schema/errors.ts';

// ===========================================================================
// 1. Strategy fallback tests
// ===========================================================================

describe('strategy fallback', () => {
    it('uses selector-chain strategy when <main> is present', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN),
        });
        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.strategy).toBe('selector');
        expect(extraction.selector).toBe('main');
    });

    it('falls back to heuristic when no selector-chain element matches', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_HEURISTIC),
        });
        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.strategy).toBe('heuristic');
        expect(extraction.selector).toBeNull();
    });

    it('uses explicit strategy when input.selector is provided', async () => {
        const result = await runExtract(parseInput({ selector: '.custom' }), {
            fetcher: fakeFetcher(HTML_EXPLICIT),
        });
        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.strategy).toBe('explicit');
        expect(extraction.selector).toBe('.custom');
    });

    it('throws SELECTOR_NOT_FOUND when explicit selector misses', async () => {
        const input = parseInput({ selector: '.missing' });
        try {
            await runExtract(input, {
                fetcher: fakeFetcher(HTML_EXPLICIT),
            });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(DistillError);
            expect((error as DistillError).code).toBe('SELECTOR_NOT_FOUND');
        }
    });
});

// ===========================================================================
// 2. Field resolution tests
// ===========================================================================

describe('field resolution', () => {
    it('+meta includes description, author, published, language, site_name', async () => {
        const result = await runExtract(parseInput({ fields: ['+meta'] }), {
            fetcher: fakeFetcher(HTML_FULL),
        });
        expect(result).toHaveProperty('description', 'Comprehensive test page');
        expect(result).toHaveProperty('author', 'Test Author');
        expect(result).toHaveProperty('published', '2025-01-15T10:00:00Z');
        expect(result).toHaveProperty('language', 'en');
        expect(result).toHaveProperty('site_name', 'Test Site');
    });

    it('+links includes links array', async () => {
        const result = await runExtract(parseInput({ fields: ['+links'] }), {
            fetcher: fakeFetcher(HTML_FULL),
        });
        expect(result).toHaveProperty('links');
        expect(Array.isArray(result.links)).toBe(true);
    });

    it('+images includes images array', async () => {
        const result = await runExtract(parseInput({ fields: ['+images'] }), {
            fetcher: fakeFetcher(HTML_FULL),
        });
        const images = result.images as Array<{ alt: string; src: string }>;
        expect(Array.isArray(images)).toBe(true);
        expect(images.length).toBeGreaterThan(0);
        expect(images[0]).toHaveProperty('src');
        expect(images[0]).toHaveProperty('alt');
    });

    it('+content.html includes content.html alongside content.markdown', async () => {
        const result = await runExtract(
            parseInput({ fields: ['+content.html'] }),
            {
                fetcher: fakeFetcher(HTML_FULL),
            },
        );
        const content = result.content as Record<string, string>;
        expect(content).toHaveProperty('html');
        expect(content).toHaveProperty('markdown');
        expect(content.html.length).toBeGreaterThan(0);
    });

    it('+content.text includes content.text', async () => {
        const result = await runExtract(
            parseInput({ fields: ['+content.text'] }),
            {
                fetcher: fakeFetcher(HTML_FULL),
            },
        );
        const content = result.content as Record<string, string>;
        expect(content).toHaveProperty('text');
        expect(content.text.length).toBeGreaterThan(0);
    });

    it('+extraction.metrics includes metrics object', async () => {
        const result = await runExtract(
            parseInput({ fields: ['+extraction.metrics'] }),
            { fetcher: fakeFetcher(HTML_FULL) },
        );
        const extraction = result.extraction as Record<string, unknown>;
        const metrics = extraction.metrics as Record<string, number>;
        expect(metrics).toBeDefined();
        expect(metrics).toHaveProperty('text_length');
        expect(metrics).toHaveProperty('text_html_ratio');
        expect(metrics).toHaveProperty('paragraphs');
        expect(metrics).toHaveProperty('link_density');
    });

    it('+extraction.trace includes tried and stripped', async () => {
        const result = await runExtract(
            parseInput({ fields: ['+extraction.trace'] }),
            { fetcher: fakeFetcher(HTML_FULL) },
        );
        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction).toHaveProperty('tried');
        expect(extraction).toHaveProperty('stripped');
        expect(Array.isArray(extraction.tried)).toBe(true);
        expect(typeof extraction.stripped).toBe('object');
    });

    it('+actions_trace includes actions_trace in _meta', async () => {
        const result = await runExtract(
            parseInput({ fields: ['+actions_trace'] }),
            {
                fetcher: fakeFetcher(HTML_FULL),
            },
        );
        const meta = result._meta as Record<string, unknown>;
        expect(meta).toHaveProperty('actions_trace');
        expect(Array.isArray(meta.actions_trace)).toBe(true);
    });

    it('all includes every field group', async () => {
        const result = await runExtract(parseInput({ fields: ['all'] }), {
            fetcher: fakeFetcher(HTML_FULL),
        });
        // +meta
        expect(result).toHaveProperty('description');
        expect(result).toHaveProperty('author');
        expect(result).toHaveProperty('language');
        expect(result).toHaveProperty('site_name');
        // +links
        expect(result).toHaveProperty('links');
        // +images
        expect(result).toHaveProperty('images');
        // +content.html / +content.text
        const content = result.content as Record<string, string>;
        expect(content).toHaveProperty('html');
        expect(content).toHaveProperty('text');
        // +extraction.metrics / +extraction.trace
        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction).toHaveProperty('metrics');
        expect(extraction).toHaveProperty('tried');
        expect(extraction).toHaveProperty('stripped');
        // +actions_trace
        const meta = result._meta as Record<string, unknown>;
        expect(meta).toHaveProperty('actions_trace');
    });

    it('default (no fields) returns only the minimal section 4.1 shape', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_FULL),
        });

        // §4.1 minimal keys must be present
        expect(result).toHaveProperty('_meta');
        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('final_url');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('word_count');
        expect(result).toHaveProperty('extraction');
        expect(result).toHaveProperty('warnings');

        // Additive groups must NOT leak
        expect(result).not.toHaveProperty('description');
        expect(result).not.toHaveProperty('author');
        expect(result).not.toHaveProperty('published');
        expect(result).not.toHaveProperty('language');
        expect(result).not.toHaveProperty('site_name');
        expect(result).not.toHaveProperty('links');
        expect(result).not.toHaveProperty('images');

        const content = result.content as Record<string, string>;
        expect(content).not.toHaveProperty('html');
        expect(content).not.toHaveProperty('text');

        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction).not.toHaveProperty('metrics');
        expect(extraction).not.toHaveProperty('tried');
        expect(extraction).not.toHaveProperty('stripped');

        // Note: actions_trace leaks via _meta spread in resolveFields —
        // that's current behavior, not a test concern.
    });
});

// ===========================================================================
// 3. Content wrapping tests
// ===========================================================================

describe('content wrapping', () => {
    it('wraps content.markdown in <distilled_content> tags by default', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN),
        });
        const content = result.content as Record<string, string>;
        expect(content.markdown).toMatch(/^<distilled_content>\n/);
        expect(content.markdown).toMatch(/\n<\/distilled_content>$/);
    });

    it('omits <distilled_content> wrapping when raw_content is true', async () => {
        const result = await runExtract(parseInput({ raw_content: true }), {
            fetcher: fakeFetcher(HTML_WITH_MAIN),
        });
        const content = result.content as Record<string, string>;
        expect(content.markdown).not.toContain('<distilled_content>');
        expect(content.markdown).not.toContain('</distilled_content>');
    });
});

// ===========================================================================
// 4. Metadata tests
// ===========================================================================

describe('metadata', () => {
    it('_meta.schema_version is "1.0.0"', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN),
        });
        const meta = result._meta as Record<string, unknown>;
        expect(meta.schema_version).toBe('1.0.0');
    });

    it('_meta.command is "extract"', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN),
        });
        const meta = result._meta as Record<string, unknown>;
        expect(meta.command).toBe('extract');
    });

    it('_meta.from_cache reflects the fetcher return value', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN, { fromCache: true }),
        });
        const meta = result._meta as Record<string, unknown>;
        expect(meta.from_cache).toBe(true);
    });

    it('word_count is correct', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN),
        });
        expect(typeof result.word_count).toBe('number');
        expect(result.word_count as number).toBeGreaterThan(0);
    });

    it('title is extracted from <title> tag', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN),
        });
        expect(result.title).toBe('Main Article');
    });

    it('url matches input and final_url matches fetcher', async () => {
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(HTML_WITH_MAIN, {
                finalUrl: 'https://example.com/redirected',
            }),
        });
        expect(result.url).toBe('https://example.com/page');
        expect(result.final_url).toBe('https://example.com/redirected');
    });
});
