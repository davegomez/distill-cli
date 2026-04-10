import { describe, expect, it } from 'vitest';
import { runExtract } from '#/extractor/extract.ts';
import { fakeFetcher, parseInput } from '#/extractor/test-utils.ts';

const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Test Article</title>
    <meta name="description" content="A test article for pipeline testing">
    <meta name="author" content="Test Author">
</head>
<body>
    <main>
        <h1>Hello World</h1>
        <p>This is a test paragraph with enough words to pass quality thresholds for the extraction pipeline confidence scoring.</p>
        <p>Another paragraph here to ensure we have sufficient content for the heuristic to consider this real article content.</p>
    </main>
</body>
</html>`;

describe('extraction pipeline with injected fetcher', () => {
    it('extracts content from canned HTML end-to-end', async () => {
        const input = parseInput();

        const result = await runExtract(input, {
            fetcher: fakeFetcher(ARTICLE_HTML),
        });

        // Strategy: selector-chain should match <main>
        const extraction = result.extraction as Record<string, unknown>;
        expect(extraction.strategy).toBe('selector');
        expect(extraction.selector).toBe('main');

        // Content: markdown should contain the article text
        const content = result.content as Record<string, string>;
        expect(content.markdown).toContain('Hello World');
        expect(content.markdown).toContain('test paragraph');

        // Title extracted from <title>
        expect(result.title).toBe('Test Article');

        // Word count should be positive
        expect(result.word_count).toBeGreaterThan(0);

        // _meta shape
        const meta = result._meta as Record<string, unknown>;
        expect(meta.schema_version).toBe('1.0.0');
        expect(meta.command).toBe('extract');
        expect(meta.from_cache).toBe(false);

        // Content wrapping (§9.5)
        expect(content.markdown).toContain('<distilled_content>');
    });
});
