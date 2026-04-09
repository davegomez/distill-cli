import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchRaw } from '#/extractor/fetch.ts';
import { ErrorCode } from '#/schema/errors.ts';

// ---------------------------------------------------------------------------
// Test HTTP server — routes exercise every code path in fetchRaw
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

/** Track how many times each endpoint has been hit (for retry assertions). */
const hitCounts = new Map<string, number>();

function hits(path: string): number {
    return hitCounts.get(path) ?? 0;
}

beforeAll(
    () =>
        new Promise<void>((resolve) => {
            server = createServer((req, res) => {
                const path = req.url ?? '/';
                hitCounts.set(path, (hitCounts.get(path) ?? 0) + 1);

                switch (path) {
                    case '/ok':
                        res.writeHead(200, { 'content-type': 'text/html' });
                        res.end('<h1>Hello</h1>');
                        break;

                    case '/not-found':
                        res.writeHead(404, { 'content-type': 'text/plain' });
                        res.end('Not Found');
                        break;

                    case '/server-error': {
                        // Always returns 503 — caller retries then eventually gives up
                        res.writeHead(503, { 'content-type': 'text/plain' });
                        res.end('Service Unavailable');
                        break;
                    }

                    case '/rate-limit': {
                        const count = hits('/rate-limit');
                        if (count <= 2) {
                            res.writeHead(429, {
                                'content-type': 'text/plain',
                                'retry-after': '0',
                            });
                            res.end('Too Many Requests');
                        } else {
                            res.writeHead(200, {
                                'content-type': 'text/plain',
                            });
                            res.end('OK after retry');
                        }
                        break;
                    }

                    case '/redirect':
                        res.writeHead(301, { location: `${baseUrl}/ok` });
                        res.end();
                        break;

                    case '/bot-block-cf':
                        res.writeHead(403, {
                            'content-type': 'text/html',
                            'cf-ray': '12345abc',
                        });
                        res.end('<html><body>Access Denied</body></html>');
                        break;

                    case '/bot-block-body':
                        res.writeHead(403, { 'content-type': 'text/html' });
                        res.end(
                            '<html><body>Attention Required! Please verify you are not a robot.</body></html>',
                        );
                        break;

                    case '/large': {
                        res.writeHead(200, {
                            'content-type': 'application/octet-stream',
                        });
                        // Write 2 KB chunks indefinitely — the client will abort once maxSize is exceeded
                        const chunk = Buffer.alloc(2048, 0x41);
                        const write = () => {
                            let ok = true;
                            while (ok) {
                                ok = res.write(chunk);
                            }
                            // If backpressure, wait for drain
                            res.once('drain', write);
                        };
                        res.on('close', () => {
                            /* connection closed by client — stop writing */
                        });
                        write();
                        break;
                    }

                    case '/slow':
                        // Never responds — used for timeout tests
                        // Intentionally left hanging; server.close() will clean up.
                        break;

                    case '/echo-headers':
                        res.writeHead(200, {
                            'content-type': 'application/json',
                        });
                        res.end(JSON.stringify(req.headers));
                        break;

                    default:
                        res.writeHead(404);
                        res.end();
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchRaw', () => {
    it('200 OK returns body and headers', async () => {
        const result = await fetchRaw(`${baseUrl}/ok`);

        expect(result.status).toBe(200);
        expect(result.body.toString()).toBe('<h1>Hello</h1>');
        expect(result.contentType).toBe('text/html');
        expect(result.finalUrl).toBe(`${baseUrl}/ok`);
        expect(result.headers['content-type']).toBe('text/html');
    });

    it('404 throws HTTP_4XX', async () => {
        try {
            await fetchRaw(`${baseUrl}/not-found`);
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.HTTP_4XX,
            });
        }
    });

    it('503 is retried then eventually throws HTTP_5XX', async () => {
        hitCounts.set('/server-error', 0);

        try {
            await fetchRaw(`${baseUrl}/server-error`, { retries: 2 });
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.HTTP_5XX,
            });
        }

        // 1 initial + 2 retries = 3 total requests
        expect(hits('/server-error')).toBe(3);
    });

    it('429 with Retry-After is respected and retried', async () => {
        hitCounts.set('/rate-limit', 0);

        const result = await fetchRaw(`${baseUrl}/rate-limit`, { retries: 2 });

        expect(result.status).toBe(200);
        expect(result.body.toString()).toBe('OK after retry');
        // First 2 attempts get 429, third succeeds
        expect(hits('/rate-limit')).toBe(3);
    });

    it('AbortController timeout throws TIMEOUT', async () => {
        try {
            await fetchRaw(`${baseUrl}/slow`, { timeout: 100, retries: 0 });
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.TIMEOUT,
            });
        }
    });

    it('max size exceeded throws TOO_LARGE', async () => {
        try {
            await fetchRaw(`${baseUrl}/large`, {
                maxSize: 1024,
                retries: 0,
            });
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.TOO_LARGE,
            });
        }
    });

    it('redirects are followed and final_url is set correctly', async () => {
        const result = await fetchRaw(`${baseUrl}/redirect`);

        expect(result.status).toBe(200);
        expect(result.finalUrl).toBe(`${baseUrl}/ok`);
        expect(result.body.toString()).toBe('<h1>Hello</h1>');
    });

    it('403 with cf-ray header throws BOT_BLOCKED with retry_with', async () => {
        try {
            await fetchRaw(`${baseUrl}/bot-block-cf`, { retries: 0 });
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.BOT_BLOCKED,
                retry_with: ['--render', '--cookies', '--user-agent'],
            });
        }
    });

    it('403 with bot-block body patterns throws BOT_BLOCKED', async () => {
        try {
            await fetchRaw(`${baseUrl}/bot-block-body`, { retries: 0 });
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.BOT_BLOCKED,
            });
        }
    });

    it('sends default User-Agent when none provided', async () => {
        const result = await fetchRaw(`${baseUrl}/echo-headers`);
        const headers = JSON.parse(result.body.toString());

        expect(headers['user-agent']).toMatch(/Chrome\/\d+/);
    });

    it('sends custom User-Agent when provided', async () => {
        const result = await fetchRaw(`${baseUrl}/echo-headers`, {
            userAgent: 'CustomBot/1.0',
        });
        const headers = JSON.parse(result.body.toString());

        expect(headers['user-agent']).toBe('CustomBot/1.0');
    });

    it('sends custom headers', async () => {
        const result = await fetchRaw(`${baseUrl}/echo-headers`, {
            headers: { 'x-custom': 'test-value' },
        });
        const headers = JSON.parse(result.body.toString());

        expect(headers['x-custom']).toBe('test-value');
    });

    it('sends cookies when provided', async () => {
        const result = await fetchRaw(`${baseUrl}/echo-headers`, {
            cookies: 'session=abc123',
        });
        const headers = JSON.parse(result.body.toString());

        expect(headers.cookie).toBe('session=abc123');
    });

    it('DNS failure maps to DNS_FAILURE', async () => {
        try {
            await fetchRaw(
                'http://this-domain-definitely-does-not-exist.invalid',
                {
                    timeout: 5_000,
                    retries: 0,
                },
            );
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                name: 'DistillError',
                code: ErrorCode.DNS_FAILURE,
            });
        }
    });
});
