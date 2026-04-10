import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { ErrorCode } from '#/schema/errors.ts';

// ---------------------------------------------------------------------------
// Unit tests (always run) — mock Playwright to test error classification
// ---------------------------------------------------------------------------

describe('renderWithPlaywright — error classification', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('throws BROWSER_NOT_INSTALLED when executable is missing', async () => {
        vi.doMock('playwright', () => ({
            chromium: {
                launch: vi
                    .fn()
                    .mockRejectedValue(
                        new Error(
                            "browserType.launch: Executable doesn't exist at /home/.cache/ms-playwright/chromium-1234/chrome-linux/chrome",
                        ),
                    ),
            },
        }));

        const { renderWithPlaywright } = await import('#/extractor/render.ts');

        try {
            await renderWithPlaywright('https://example.com');
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.BROWSER_NOT_INSTALLED,
                retry_with: ['distill setup'],
            });
        }
    });

    it('throws BROWSER_LAUNCH_FAILED with lib hints on missing system libs', async () => {
        vi.doMock('playwright', () => ({
            chromium: {
                launch: vi
                    .fn()
                    .mockRejectedValue(
                        new Error(
                            'browserType.launch: Host system is missing dependencies: libnss3, libatk-bridge-2.0',
                        ),
                    ),
            },
        }));

        const { renderWithPlaywright } = await import('#/extractor/render.ts');

        try {
            await renderWithPlaywright('https://example.com');
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.BROWSER_LAUNCH_FAILED,
            });
            const hint = (err as { hint: string }).hint;
            expect(hint).toContain('libnss3');
            expect(hint).toContain('libatk-bridge-2.0');
        }
    });

    it('throws BROWSER_LAUNCH_FAILED for unknown launch errors', async () => {
        vi.doMock('playwright', () => ({
            chromium: {
                launch: vi
                    .fn()
                    .mockRejectedValue(new Error('Something went very wrong')),
            },
        }));

        const { renderWithPlaywright } = await import('#/extractor/render.ts');

        try {
            await renderWithPlaywright('https://example.com');
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.BROWSER_LAUNCH_FAILED,
            });
        }
    });
});

// ---------------------------------------------------------------------------
// E2E tests (require DISTILL_E2E=1 and an installed browser)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.DISTILL_E2E)(
    'renderWithPlaywright — E2E (real browser)',
    () => {
        let server: Server;
        let baseUrl: string;

        beforeAll(
            () =>
                new Promise<void>((resolve) => {
                    server = createServer((req, res) => {
                        const path = req.url ?? '/';

                        if (path === '/static') {
                            res.writeHead(200, {
                                'content-type': 'text/html',
                            });
                            res.end(
                                '<html><head><title>Static</title></head><body><h1>Hello</h1></body></html>',
                            );
                            return;
                        }

                        if (path === '/js-rendered') {
                            res.writeHead(200, {
                                'content-type': 'text/html',
                            });
                            res.end(`<html><head><title>JS</title></head><body>
								<div id="root"></div>
								<script>document.getElementById('root').textContent = 'Rendered by JS';</script>
							</body></html>`);
                            return;
                        }

                        if (path === '/redirect') {
                            res.writeHead(302, {
                                location: '/static',
                            });
                            res.end();
                            return;
                        }

                        res.writeHead(404);
                        res.end('Not Found');
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

        it('renders static HTML and returns content', async () => {
            const { renderWithPlaywright } = await import(
                '#/extractor/render.ts'
            );
            const result = await renderWithPlaywright(`${baseUrl}/static`);

            expect(result.html).toContain('<h1>Hello</h1>');
            expect(result.finalUrl).toBe(`${baseUrl}/static`);
        });

        it('renders JS-generated content', async () => {
            const { renderWithPlaywright } = await import(
                '#/extractor/render.ts'
            );
            const result = await renderWithPlaywright(`${baseUrl}/js-rendered`);

            expect(result.html).toContain('Rendered by JS');
        });

        it('follows redirects and reports the final URL', async () => {
            const { renderWithPlaywright } = await import(
                '#/extractor/render.ts'
            );
            const result = await renderWithPlaywright(`${baseUrl}/redirect`);

            expect(result.finalUrl).toBe(`${baseUrl}/static`);
            expect(result.html).toContain('<h1>Hello</h1>');
        });
    },
);
