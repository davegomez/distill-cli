import { describe, expect, it } from 'vitest';
import { DistillError } from '#/schema/errors.ts';
import { type FullExtractResult, resolveFields } from './fields.ts';

/** Build a complete FullExtractResult for testing. */
function makeFull(overrides?: Partial<FullExtractResult>): FullExtractResult {
    return {
        _meta: {
            schema_version: '1.0.0',
            tool_version: '0.1.0',
            command: 'extract',
            fetched_at: '2026-01-01T00:00:00.000Z',
            elapsed_ms: 42,
            http_status: 200,
            from_cache: false,
            actions_trace: [],
        },
        url: 'https://example.com',
        final_url: 'https://example.com',
        title: 'Example',
        content: {
            markdown: '# Example',
            html: '<article><h1>Example</h1></article>',
            text: 'Example',
        },
        word_count: 1,
        extraction: {
            strategy: 'selector',
            selector: 'main',
            confidence: 'high',
            archetype: 'article-blog',
            metrics: {
                text_length: 100,
                text_html_ratio: 0.5,
                paragraphs: 3,
                link_density: 0.1,
            },
            tried: ['main', 'article'],
            stripped: { nav: 2, footer: 1 },
        },
        warnings: [],
        description: 'An example page',
        author: 'Jane Doe',
        published: '2026-01-01',
        language: 'en',
        site_name: 'Example Site',
        links: [{ text: 'Home', href: '/' }],
        images: [{ alt: 'Logo', src: '/logo.png' }],
        ...overrides,
    };
}

describe('resolveFields', () => {
    it('returns only minimal default fields when no groups requested', () => {
        const result = resolveFields([], makeFull());

        // §4.1 default keys
        expect(result).toHaveProperty('_meta');
        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('final_url');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('word_count');
        expect(result).toHaveProperty('extraction');
        expect(result).toHaveProperty('warnings');

        // content only has markdown (raw — wrapping is applied post-resolve)
        expect(result.content).toEqual({
            markdown: '# Example',
        });

        // extraction only has base fields
        expect(result.extraction).toEqual({
            strategy: 'selector',
            selector: 'main',
            confidence: 'high',
            archetype: 'article-blog',
        });

        // No opt-in fields
        expect(result).not.toHaveProperty('description');
        expect(result).not.toHaveProperty('author');
        expect(result).not.toHaveProperty('links');
        expect(result).not.toHaveProperty('images');
    });

    it('+meta adds description/author/published/language/site_name', () => {
        const result = resolveFields(['+meta'], makeFull());

        expect(result.description).toBe('An example page');
        expect(result.author).toBe('Jane Doe');
        expect(result.published).toBe('2026-01-01');
        expect(result.language).toBe('en');
        expect(result.site_name).toBe('Example Site');

        // Other groups absent
        expect(result).not.toHaveProperty('links');
        expect(result).not.toHaveProperty('images');
    });

    it('+links adds links array', () => {
        const result = resolveFields(['+links'], makeFull());

        expect(result.links).toEqual([{ text: 'Home', href: '/' }]);
        expect(result).not.toHaveProperty('description');
    });

    it('+images adds images array', () => {
        const result = resolveFields(['+images'], makeFull());

        expect(result.images).toEqual([{ alt: 'Logo', src: '/logo.png' }]);
        expect(result).not.toHaveProperty('links');
    });

    it('+content.html adds content.html', () => {
        const result = resolveFields(['+content.html'], makeFull());

        const content = result.content as Record<string, unknown>;
        expect(content.html).toBe('<article><h1>Example</h1></article>');
        expect(content.markdown).toBeDefined();
        expect(content).not.toHaveProperty('text');
    });

    it('+content.text adds content.text', () => {
        const result = resolveFields(['+content.text'], makeFull());

        const content = result.content as Record<string, unknown>;
        expect(content.text).toBe('Example');
        expect(content.markdown).toBeDefined();
        expect(content).not.toHaveProperty('html');
    });

    it('+extraction.metrics adds extraction.metrics', () => {
        const result = resolveFields(['+extraction.metrics'], makeFull());

        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.metrics).toEqual({
            text_length: 100,
            text_html_ratio: 0.5,
            paragraphs: 3,
            link_density: 0.1,
        });
        expect(extraction).not.toHaveProperty('tried');
    });

    it('+extraction.trace adds extraction.tried and extraction.stripped', () => {
        const result = resolveFields(['+extraction.trace'], makeFull());

        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.tried).toEqual(['main', 'article']);
        expect(extraction.stripped).toEqual({ nav: 2, footer: 1 });
        expect(extraction).not.toHaveProperty('metrics');
    });

    it('+actions_trace adds _meta.actions_trace', () => {
        const trace = [
            {
                index: 0,
                type: 'click',
                result: 'ok',
                elapsed_ms: 10,
            },
        ];
        const result = resolveFields(
            ['+actions_trace'],
            makeFull({
                _meta: {
                    schema_version: '1.0.0',
                    tool_version: '0.1.0',
                    command: 'extract',
                    fetched_at: '2026-01-01T00:00:00.000Z',
                    elapsed_ms: 42,
                    http_status: 200,
                    from_cache: false,
                    actions_trace: trace,
                },
            }),
        );

        const meta = result._meta as Record<string, unknown>;
        expect(meta.actions_trace).toEqual(trace);
    });

    it('multiple groups combine additively', () => {
        const result = resolveFields(
            ['+meta', '+links', '+images', '+content.html'],
            makeFull(),
        );

        expect(result).toHaveProperty('description');
        expect(result).toHaveProperty('links');
        expect(result).toHaveProperty('images');
        expect((result.content as Record<string, unknown>).html).toBeDefined();

        // Still has defaults
        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('title');
    });

    it('`all` sentinel includes every group', () => {
        const result = resolveFields(['all'], makeFull());

        // +meta
        expect(result).toHaveProperty('description');
        expect(result).toHaveProperty('author');
        expect(result).toHaveProperty('language');

        // +links
        expect(result).toHaveProperty('links');

        // +images
        expect(result).toHaveProperty('images');

        // +content.html, +content.text
        const content = result.content as Record<string, unknown>;
        expect(content).toHaveProperty('html');
        expect(content).toHaveProperty('text');

        // +extraction.metrics, +extraction.trace
        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction).toHaveProperty('metrics');
        expect(extraction).toHaveProperty('tried');
        expect(extraction).toHaveProperty('stripped');

        // +actions_trace
        const meta = result._meta as Record<string, unknown>;
        expect(meta).toHaveProperty('actions_trace');
    });

    it('throws INVALID_INPUT_JSON for unknown group', () => {
        expect(() => resolveFields(['+bogus'], makeFull())).toThrow(
            DistillError,
        );

        try {
            resolveFields(['+bogus'], makeFull());
        } catch (err) {
            expect((err as DistillError).code).toBe('INVALID_INPUT_JSON');
        }
    });

    it('throws for unknown group even when mixed with valid groups', () => {
        expect(() => resolveFields(['+meta', '+nope'], makeFull())).toThrow(
            DistillError,
        );
    });

    it('+meta fields are null when absent in source', () => {
        const result = resolveFields(
            ['+meta'],
            makeFull({
                description: null,
                author: null,
                published: null,
                language: null,
                site_name: null,
            }),
        );

        expect(result.description).toBeNull();
        expect(result.author).toBeNull();
        expect(result.published).toBeNull();
        expect(result.language).toBeNull();
        expect(result.site_name).toBeNull();
    });
});
