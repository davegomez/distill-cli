/**
 * Tests for the default PageFetcher wiring inside runExtract.
 *
 * These tests call runExtract WITHOUT an injected fetcher, exercising
 * the defaultPageFetcher that routes to cachedFetch or renderWithPlaywright.
 * Uses hoisted vi.mock (standard pattern) to stub the I/O modules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractInputSchema } from '#/schema/input.ts';

// Hoisted mocks — stable, no resetModules needed
vi.mock('#/extractor/render.ts', () => ({
    renderWithPlaywright: vi.fn(),
}));

vi.mock('#/extractor/cached-fetch.ts', () => ({
    cachedFetch: vi.fn(),
}));

// Must import AFTER vi.mock declarations
const { renderWithPlaywright } = await import('#/extractor/render.ts');
const { cachedFetch } = await import('#/extractor/cached-fetch.ts');
const { runExtract } = await import('#/commands/extract.ts');

const SIMPLE_HTML = `<!DOCTYPE html>
<html><head><title>Test</title></head>
<body><main><h1>Hello</h1><p>Content here with enough words.</p></main></body>
</html>`;

const mockRender = vi.mocked(renderWithPlaywright);
const mockFetch = vi.mocked(cachedFetch);

beforeEach(() => {
    mockRender.mockReset();
    mockFetch.mockReset();
});

describe('defaultPageFetcher — render path wiring', () => {
    it('calls renderWithPlaywright with correct options when render is true', async () => {
        mockRender.mockResolvedValue({
            finalUrl: 'https://example.com/page',
            html: SIMPLE_HTML,
            status: 200,
            actionTrace: [],
        });

        await runExtract(
            ExtractInputSchema.parse({
                url: 'https://example.com/page',
                render: true,
            }),
        );

        expect(mockRender).toHaveBeenCalledOnce();
        expect(mockRender).toHaveBeenCalledWith(
            'https://example.com/page',
            expect.objectContaining({ timeout: 30000 }),
        );
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('forwards actions to renderWithPlaywright', async () => {
        const actions = [
            { type: 'wait' as const, selector: 'h1' },
            { type: 'click' as const, selector: '.btn' },
        ];

        mockRender.mockResolvedValue({
            finalUrl: 'https://example.com/page',
            html: SIMPLE_HTML,
            status: 200,
            actionTrace: [
                {
                    index: 0,
                    type: 'wait',
                    result: 'ok' as const,
                    elapsed_ms: 5,
                },
            ],
        });

        await runExtract(
            ExtractInputSchema.parse({
                url: 'https://example.com/page',
                actions,
            }),
        );

        expect(mockRender).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ actions }),
        );
    });

    it('parses cookies file and maps to Playwright cookie format', async () => {
        // Create a temp cookie jar
        const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import(
            'node:fs'
        );
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');

        const tmpDir = mkdtempSync(join(tmpdir(), 'distill-fetcher-test-'));
        const cookiePath = join(tmpDir, 'cookies.txt');
        writeFileSync(
            cookiePath,
            '.example.com\tTRUE\t/\tFALSE\t0\tsession\tabc123\n',
        );
        chmodSync(cookiePath, 0o600);

        try {
            mockRender.mockResolvedValue({
                finalUrl: 'https://example.com/page',
                html: SIMPLE_HTML,
                status: 200,
            });

            await runExtract(
                ExtractInputSchema.parse({
                    url: 'https://example.com/page',
                    render: true,
                    cookies: cookiePath,
                }),
            );

            // Verify cookies were parsed and mapped to Playwright format
            expect(mockRender).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    cookies: expect.arrayContaining([
                        expect.objectContaining({
                            name: 'session',
                            value: 'abc123',
                            domain: '.example.com',
                            path: '/',
                        }),
                    ]),
                }),
            );
        } finally {
            rmSync(tmpDir, { recursive: true });
        }
    });
});

describe('defaultPageFetcher — fetch path wiring', () => {
    it('calls cachedFetch when render is false', async () => {
        mockFetch.mockResolvedValue({
            finalUrl: 'https://example.com/page',
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: Buffer.from(SIMPLE_HTML),
            contentType: 'text/html',
            _meta: { from_cache: false },
        });

        await runExtract(
            ExtractInputSchema.parse({
                url: 'https://example.com/page',
            }),
        );

        expect(mockFetch).toHaveBeenCalledOnce();
        expect(mockFetch).toHaveBeenCalledWith(
            'https://example.com/page',
            expect.objectContaining({
                timeout: 30000,
                retries: 2,
            }),
        );
        expect(mockRender).not.toHaveBeenCalled();
    });
});
