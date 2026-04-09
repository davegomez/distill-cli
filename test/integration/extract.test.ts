import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExtract } from '#/commands/extract.ts';
import { DistillError } from '#/schema/errors.ts';
import { ExtractInputSchema } from '#/schema/input.ts';

/** Typed accessor for test assertions on the Record<string, unknown> output. */
// biome-ignore lint/suspicious/noExplicitAny: test helper needs dynamic access
type AnyResult = Record<string, any>;

const CANONICAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Article Title</title>
  <meta name="description" content="A test article for integration testing">
  <meta name="author" content="Test Author">
  <meta property="og:site_name" content="Test Site">
  <meta property="article:published_time" content="2026-01-15">
</head>
<body>
  <nav><a href="/">Home</a> | <a href="/about">About</a></nav>
  <main>
    <h1>Test Article Title</h1>
    <p>This is the first paragraph of the test article. It contains enough text to be considered meaningful content by the extraction heuristics and quality scoring system.</p>
    <p>Here is a second paragraph with additional content. The extraction pipeline should identify this as the main content area and extract it properly with high confidence.</p>
    <h2>Section Two</h2>
    <p>A third paragraph under a subheading. This ensures the word count exceeds the threshold for high confidence scoring when using the selector chain strategy.</p>
    <p>Fourth paragraph adds more body text. Articles typically have multiple paragraphs and the extractor should handle them all correctly in the output.</p>
    <p>Fifth paragraph continues the content. We want to ensure there are enough words across multiple paragraphs to trigger a high confidence score from the rubric.</p>
    <p>Sixth paragraph wraps up the article body. This gives us well over one hundred words which should produce a reasonable word count in the output.</p>
    <p><img src="/hero.jpg" alt="Hero image"></p>
  </main>
  <footer><p>&copy; 2026 Test Site</p></footer>
</body>
</html>`;

const MINIMAL_HTML = `<!DOCTYPE html>
<html>
<head><title>Minimal</title></head>
<body>
  <article>
    <h1>Minimal Page</h1>
    <p>Just one paragraph here.</p>
  </article>
</body>
</html>`;

let server: Server;
let baseUrl: string;

beforeAll(
    () =>
        new Promise<void>((resolve) => {
            server = createServer((req, res) => {
                if (req.url === '/article') {
                    res.writeHead(200, { 'content-type': 'text/html' });
                    res.end(CANONICAL_HTML);
                } else if (req.url === '/minimal') {
                    res.writeHead(200, { 'content-type': 'text/html' });
                    res.end(MINIMAL_HTML);
                } else if (req.url === '/not-found') {
                    res.writeHead(404, { 'content-type': 'text/html' });
                    res.end('<html><body><p>Not Found</p></body></html>');
                } else if (req.url === '/server-error') {
                    res.writeHead(500, { 'content-type': 'text/html' });
                    res.end('<html><body><p>Internal Error</p></body></html>');
                } else {
                    res.writeHead(200, { 'content-type': 'text/html' });
                    res.end(CANONICAL_HTML);
                }
            });
            server.listen(0, '127.0.0.1', () => {
                const addr = server.address() as AddressInfo;
                baseUrl = `http://127.0.0.1:${addr.port}`;
                resolve();
            });
        }),
);

afterAll(
    () =>
        new Promise<void>((resolve) => {
            server.close(() => resolve());
        }),
);

function makeInput(overrides: Record<string, unknown>) {
    return ExtractInputSchema.parse({
        url: `${baseUrl}/article`,
        allow_private_network: true,
        ...overrides,
    });
}

describe('runExtract', () => {
    it('returns the minimal default output shape for a canonical page', async () => {
        const result = (await runExtract(
            makeInput({ url: `${baseUrl}/article` }),
        )) as AnyResult;

        // §4.1 — _meta
        expect(result._meta.schema_version).toBe('1.0.0');
        expect(result._meta.tool_version).toBe('0.1.0');
        expect(result._meta.command).toBe('extract');
        expect(result._meta.http_status).toBe(200);
        expect(typeof result._meta.fetched_at).toBe('string');
        expect(typeof result._meta.elapsed_ms).toBe('number');
        expect(typeof result._meta.from_cache).toBe('boolean');

        // URL fields
        expect(result.url).toBe(`${baseUrl}/article`);
        expect(result.final_url).toContain('/article');

        // Title
        expect(result.title).toBe('Test Article Title');

        // Content
        expect(result.content.markdown).toContain('<distilled_content>');
        expect(result.content.markdown).toContain('</distilled_content>');
        expect(result.content.markdown).toContain('Test Article Title');

        // Word count
        expect(result.word_count).toBeGreaterThan(0);

        // Extraction metadata
        expect(result.extraction.strategy).toBe('selector');
        expect(result.extraction.selector).toBe('main');
        expect(['high', 'medium', 'low']).toContain(
            result.extraction.confidence,
        );
        expect(['article-blog', 'docs', 'news']).toContain(
            result.extraction.archetype,
        );

        // Warnings
        expect(Array.isArray(result.warnings)).toBe(true);

        // No opt-in fields in default output
        expect(result).not.toHaveProperty('description');
        expect(result).not.toHaveProperty('links');
        expect(result).not.toHaveProperty('images');
    });

    it('uses explicit strategy when selector is provided', async () => {
        const result = (await runExtract(
            makeInput({
                url: `${baseUrl}/article`,
                selector: 'main',
            }),
        )) as AnyResult;

        expect(result.extraction.strategy).toBe('explicit');
        expect(result.extraction.selector).toBe('main');
        expect(result.extraction.confidence).toBe('high');
        expect(result.content.markdown).toContain('Test Article Title');
    });

    it('falls back to selector chain for article element', async () => {
        const result = (await runExtract(
            makeInput({ url: `${baseUrl}/minimal` }),
        )) as AnyResult;

        expect(result.title).toBe('Minimal');
        expect(result.extraction.strategy).toBe('selector');
        // article is in the chain
        expect(result.extraction.selector).toBe('article');
        expect(result.content.markdown).toContain('Minimal Page');
    });

    it('throws SELECTOR_NOT_FOUND for a missing explicit selector', async () => {
        try {
            await runExtract(
                makeInput({
                    url: `${baseUrl}/article`,
                    selector: '#nonexistent',
                }),
            );
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('SELECTOR_NOT_FOUND');
            expect((err as DistillError).exit_code).toBe(1);
        }
    });

    it('throws HTTP_4XX for a 404 response', async () => {
        try {
            await runExtract(makeInput({ url: `${baseUrl}/not-found` }));
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('HTTP_4XX');
            expect((err as DistillError).exit_code).toBe(2);
        }
    });

    it('throws HTTP_5XX for a 500 response', async () => {
        try {
            await runExtract(
                makeInput({
                    url: `${baseUrl}/server-error`,
                    retries: 0,
                }),
            );
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('HTTP_5XX');
            expect((err as DistillError).exit_code).toBe(2);
        }
    });

    it('throws INVALID_URL for a validation error', async () => {
        try {
            await runExtract(ExtractInputSchema.parse({ url: 'not-a-url' }));
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('INVALID_URL');
            expect((err as DistillError).exit_code).toBe(3);
        }
    });

    it('--fields +meta,+images returns expected shape', async () => {
        const result = (await runExtract(
            makeInput({
                url: `${baseUrl}/article`,
                selector: 'main',
                fields: ['+meta', '+images'],
            }),
        )) as AnyResult;

        // Default fields still present
        expect(result).toHaveProperty('_meta');
        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('content');
        expect(result.content.markdown).toContain('distilled_content');

        // +meta fields
        expect(result.description).toBe(
            'A test article for integration testing',
        );
        expect(result.author).toBe('Test Author');
        expect(result.site_name).toBe('Test Site');
        expect(result.published).toBe('2026-01-15');
        expect(result.language).toBe('en');

        // +images fields
        expect(Array.isArray(result.images)).toBe(true);
        expect(result.images.length).toBeGreaterThan(0);
        expect(result.images[0]).toHaveProperty('alt');
        expect(result.images[0]).toHaveProperty('src');

        // Groups NOT requested should be absent
        expect(result).not.toHaveProperty('links');
        expect(result.content).not.toHaveProperty('html');
        expect(result.content).not.toHaveProperty('text');
    });

    it('--dry-run echoes resolved input without hitting the network', () => {
        // Use a bogus URL — if fetch were attempted, DNS resolution would fail.
        const bogusUrl =
            'http://this-domain-does-not-exist-distill-test.invalid/page';
        const stdout = execFileSync(
            'npx',
            ['tsx', 'src/cli.ts', 'extract', bogusUrl, '--dry-run', '--render'],
            { encoding: 'utf-8', cwd: process.cwd() },
        );

        const output = JSON.parse(stdout);

        // The resolved canonical input is echoed
        expect(output.url).toBe(bogusUrl);
        expect(output.render).toBe(true);
        expect(output.dry_run).toBe(true);

        // Defaults are applied
        expect(output.format).toBe('json');
        expect(output.timeout).toBe(30000);
        expect(output.retries).toBe(2);
        expect(output.max_size).toBe('50MB');
        expect(output.no_cache).toBe(false);
        expect(output.allow_private_network).toBe(false);
    });

    it('--fields all includes every group', async () => {
        const result = (await runExtract(
            makeInput({
                url: `${baseUrl}/article`,
                fields: ['all'],
            }),
        )) as AnyResult;

        // +meta
        expect(result).toHaveProperty('description');
        expect(result).toHaveProperty('author');

        // +links
        expect(result).toHaveProperty('links');

        // +images
        expect(result).toHaveProperty('images');

        // +content.html, +content.text
        expect(result.content).toHaveProperty('html');
        expect(result.content).toHaveProperty('text');

        // +extraction.metrics
        expect(result.extraction).toHaveProperty('metrics');

        // +extraction.trace
        expect(result.extraction).toHaveProperty('tried');
        expect(result.extraction).toHaveProperty('stripped');

        // +actions_trace
        expect(result._meta).toHaveProperty('actions_trace');
    });
});
