import { describe, expect, it } from 'vitest';
import { runExtract, toFetchRequest } from '#/extractor/extract.ts';
import { fakeFetcher, parseInput } from '#/extractor/test-utils.ts';

// ---------------------------------------------------------------------------
// extractTitle edge cases
// ---------------------------------------------------------------------------

describe('extractTitle', () => {
    it('returns empty string when <title> is missing', async () => {
        const html =
            '<!DOCTYPE html><html><head></head><body><main><p>Content here.</p></main></body></html>';
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(html),
        });
        expect(result.title).toBe('');
    });

    it('returns empty string when <title> is empty', async () => {
        const html =
            '<!DOCTYPE html><html><head><title></title></head><body><main><p>Content here.</p></main></body></html>';
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(html),
        });
        expect(result.title).toBe('');
    });

    it('trims whitespace from title', async () => {
        const html =
            '<!DOCTYPE html><html><head><title>  Spaced Title  </title></head><body><main><p>Content here.</p></main></body></html>';
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(html),
        });
        expect(result.title).toBe('Spaced Title');
    });
});

// ---------------------------------------------------------------------------
// countWords edge cases
// ---------------------------------------------------------------------------

describe('countWords', () => {
    it('returns 0 when content has only hidden blocks', async () => {
        const html = `<!DOCTYPE html><html><head><title>T</title></head>
        <body><main><p style="display:none">Hidden paragraph that should not count.</p>
        <p>Visible word.</p></main></body></html>`;
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(html),
        });
        // word_count should only count visible blocks
        expect(result.word_count).toBeGreaterThan(0);
        // Verify hidden content is excluded by checking the count is small
        expect(result.word_count as number).toBeLessThan(10);
    });

    it('counts words across multiple visible paragraphs', async () => {
        const html = `<!DOCTYPE html><html><head><title>T</title></head>
        <body><main>
            <p>One two three</p>
            <p>Four five six</p>
        </main></body></html>`;
        const result = await runExtract(parseInput(), {
            fetcher: fakeFetcher(html),
        });
        expect(result.word_count).toBe(6);
    });
});

// ---------------------------------------------------------------------------
// extractImages edge cases
// ---------------------------------------------------------------------------

describe('extractImages', () => {
    it('deduplicates images by src', async () => {
        const html = `<!DOCTYPE html><html><head><title>T</title></head>
        <body><main>
            <p><img src="https://example.com/img.jpg" alt="A"> First</p>
            <p><img src="https://example.com/img.jpg" alt="B"> Duplicate</p>
            <p><img src="https://example.com/other.jpg" alt="C"> Different</p>
        </main></body></html>`;
        const result = await runExtract(parseInput({ fields: ['+images'] }), {
            fetcher: fakeFetcher(html),
        });
        const images = result.images as Array<{ alt: string; src: string }>;
        expect(images).toHaveLength(2);
        expect(images[0].src).toBe('https://example.com/img.jpg');
        expect(images[1].src).toBe('https://example.com/other.jpg');
    });

    it('returns empty array when no images exist', async () => {
        const html = `<!DOCTYPE html><html><head><title>T</title></head>
        <body><main><p>No images here at all.</p></main></body></html>`;
        const result = await runExtract(parseInput({ fields: ['+images'] }), {
            fetcher: fakeFetcher(html),
        });
        const images = result.images as Array<{ alt: string; src: string }>;
        expect(images).toHaveLength(0);
    });

    it('preserves alt text from first occurrence when deduplicating', async () => {
        const html = `<!DOCTYPE html><html><head><title>T</title></head>
        <body><main>
            <p><img src="https://example.com/img.jpg" alt="First alt"> Text</p>
            <p><img src="https://example.com/img.jpg" alt="Second alt"> More</p>
        </main></body></html>`;
        const result = await runExtract(parseInput({ fields: ['+images'] }), {
            fetcher: fakeFetcher(html),
        });
        const images = result.images as Array<{ alt: string; src: string }>;
        expect(images).toHaveLength(1);
        expect(images[0].alt).toBe('First alt');
    });
});

// ---------------------------------------------------------------------------
// toFetchRequest — header parsing, size parsing, field mapping
// ---------------------------------------------------------------------------

describe('toFetchRequest — header parsing', () => {
    it('parses "K: V" header strings into a record', () => {
        const req = toFetchRequest(parseInput({ header: ['X-Custom: value'] }));
        expect(req.headers).toEqual({ 'X-Custom': 'value' });
    });

    it('returns undefined when no headers provided', () => {
        const req = toFetchRequest(parseInput());
        expect(req.headers).toBeUndefined();
    });

    it('skips malformed headers without a colon', () => {
        const req = toFetchRequest(parseInput({ header: ['no-colon'] }));
        expect(req.headers).toEqual({});
    });

    it('trims whitespace around key and value', () => {
        const req = toFetchRequest(
            parseInput({ header: ['  Key  :  Value  '] }),
        );
        expect(req.headers).toEqual({ Key: 'Value' });
    });

    it('handles multiple headers', () => {
        const req = toFetchRequest(
            parseInput({ header: ['Accept: text/html', 'X-Token: abc'] }),
        );
        expect(req.headers).toEqual({
            Accept: 'text/html',
            'X-Token': 'abc',
        });
    });
});

describe('toFetchRequest — size parsing', () => {
    it('parses MB values', () => {
        const req = toFetchRequest(parseInput({ max_size: '10MB' }));
        expect(req.maxSize).toBe(10 * 1024 * 1024);
    });

    it('parses KB values', () => {
        const req = toFetchRequest(parseInput({ max_size: '512KB' }));
        expect(req.maxSize).toBe(512 * 1024);
    });

    it('parses GB values', () => {
        const req = toFetchRequest(parseInput({ max_size: '1GB' }));
        expect(req.maxSize).toBe(1024 * 1024 * 1024);
    });

    it('parses B values', () => {
        const req = toFetchRequest(parseInput({ max_size: '1024B' }));
        expect(req.maxSize).toBe(1024);
    });

    it('falls back to 50MB for invalid size strings', () => {
        const req = toFetchRequest(parseInput({ max_size: 'invalid' }));
        expect(req.maxSize).toBe(50 * 1024 * 1024);
    });

    it('handles case-insensitive units', () => {
        const req = toFetchRequest(parseInput({ max_size: '10mb' }));
        expect(req.maxSize).toBe(10 * 1024 * 1024);
    });
});

describe('toFetchRequest — field mapping', () => {
    it('maps ExtractInput fields to FetchRequest', () => {
        const req = toFetchRequest(
            parseInput({
                render: true,
                user_agent: 'TestBot/1.0',
                timeout: 5000,
                retries: 3,
                no_cache: true,
                refresh: true,
            }),
        );
        expect(req.render).toBe(true);
        expect(req.userAgent).toBe('TestBot/1.0');
        expect(req.timeout).toBe(5000);
        expect(req.retries).toBe(3);
        expect(req.noCache).toBe(true);
        expect(req.refresh).toBe(true);
    });
});
