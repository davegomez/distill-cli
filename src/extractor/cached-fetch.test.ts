import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { HttpCache } from '#/cache/sqlite.ts';
import { cachedFetch } from '#/extractor/cached-fetch.ts';

// ---------------------------------------------------------------------------
// Test HTTP server
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;
let fetchCount: number;

beforeAll(
    () =>
        new Promise<void>((resolve) => {
            server = createServer((req, res) => {
                fetchCount++;
                const path = req.url ?? '/';

                switch (path) {
                    case '/ok':
                        res.writeHead(200, { 'content-type': 'text/html' });
                        res.end('<h1>Hello</h1>');
                        break;

                    case '/short-cache':
                        res.writeHead(200, {
                            'content-type': 'text/html',
                            'cache-control': 'max-age=60',
                        });
                        res.end('<h1>Short cache</h1>');
                        break;

                    default:
                        res.writeHead(200, { 'content-type': 'text/plain' });
                        res.end(`response for ${path}`);
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
// Per-test cache setup
// ---------------------------------------------------------------------------

let cache: HttpCache;

function makeTmpDb(): string {
    const dir = mkdtempSync(join(tmpdir(), 'distill-cached-fetch-test-'));
    return join(dir, 'test-cache.sqlite');
}

beforeEach(() => {
    fetchCount = 0;
    cache = new HttpCache(makeTmpDb());
    cache.migrate();
});

afterEach(() => {
    cache.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cachedFetch', () => {
    it('cache miss → fetch → cache hit on second call', async () => {
        const first = await cachedFetch(`${baseUrl}/ok`, {}, cache);
        expect(first._meta.from_cache).toBe(false);
        expect(first.status).toBe(200);
        expect(first.body.toString()).toBe('<h1>Hello</h1>');
        expect(fetchCount).toBe(1);

        const second = await cachedFetch(`${baseUrl}/ok`, {}, cache);
        expect(second._meta.from_cache).toBe(true);
        expect(second.body.toString()).toBe('<h1>Hello</h1>');
        expect(fetchCount).toBe(1); // no additional network request
    });

    it('never caches authenticated responses — cookies present', async () => {
        // First call with cookies — should fetch and NOT write to cache
        const first = await cachedFetch(
            `${baseUrl}/ok`,
            { cookies: 'session=abc' },
            cache,
        );
        expect(first._meta.from_cache).toBe(false);
        expect(fetchCount).toBe(1);

        // Second call with cookies — should fetch again, NOT read from cache
        const second = await cachedFetch(
            `${baseUrl}/ok`,
            { cookies: 'session=abc' },
            cache,
        );
        expect(second._meta.from_cache).toBe(false);
        expect(fetchCount).toBe(2);

        // Verify nothing was written to cache
        const entries = cache.list();
        expect(entries).toHaveLength(0);
    });

    it('never caches authenticated responses — Authorization header present', async () => {
        // First call with Authorization header — should NOT write to cache
        const first = await cachedFetch(
            `${baseUrl}/ok`,
            { headers: { Authorization: 'Bearer token123' } },
            cache,
        );
        expect(first._meta.from_cache).toBe(false);
        expect(fetchCount).toBe(1);

        // Second call — should NOT read from cache
        const second = await cachedFetch(
            `${baseUrl}/ok`,
            { headers: { Authorization: 'Bearer token123' } },
            cache,
        );
        expect(second._meta.from_cache).toBe(false);
        expect(fetchCount).toBe(2);

        // Verify nothing was written to cache
        const entries = cache.list();
        expect(entries).toHaveLength(0);
    });

    it('never caches when authorization header uses different casing', async () => {
        const result = await cachedFetch(
            `${baseUrl}/ok`,
            { headers: { authorization: 'Basic creds' } },
            cache,
        );
        expect(result._meta.from_cache).toBe(false);

        // Verify nothing was written
        expect(cache.list()).toHaveLength(0);
    });

    it('--no-cache bypasses read but still writes', async () => {
        // Seed the cache with a normal request
        await cachedFetch(`${baseUrl}/ok`, {}, cache);
        expect(fetchCount).toBe(1);

        // noCache skips reading from cache, fetches fresh, and writes
        const result = await cachedFetch(
            `${baseUrl}/ok`,
            { noCache: true },
            cache,
        );
        expect(result._meta.from_cache).toBe(false);
        expect(fetchCount).toBe(2);

        // Cache should still have an entry (updated by the noCache call)
        expect(cache.list()).toHaveLength(1);

        // A normal read should now hit cache
        const cached = await cachedFetch(`${baseUrl}/ok`, {}, cache);
        expect(cached._meta.from_cache).toBe(true);
        expect(fetchCount).toBe(2);
    });

    it('--refresh forces fetch and updates cache', async () => {
        // Seed the cache
        await cachedFetch(`${baseUrl}/ok`, {}, cache);
        expect(fetchCount).toBe(1);

        // refresh forces a new fetch and writes to cache
        const result = await cachedFetch(
            `${baseUrl}/ok`,
            { refresh: true },
            cache,
        );
        expect(result._meta.from_cache).toBe(false);
        expect(fetchCount).toBe(2);

        // Cache entry was updated — next read hits cache
        const cached = await cachedFetch(`${baseUrl}/ok`, {}, cache);
        expect(cached._meta.from_cache).toBe(true);
        expect(fetchCount).toBe(2);
    });

    it('expired entries trigger refetch', async () => {
        // Write an entry with a very short TTL
        await cachedFetch(`${baseUrl}/ok`, { maxAge: 1 }, cache);
        expect(fetchCount).toBe(1);

        // Wait for the entry to expire
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should miss the cache and refetch
        const result = await cachedFetch(`${baseUrl}/ok`, {}, cache);
        expect(result._meta.from_cache).toBe(false);
        expect(fetchCount).toBe(2);
    });

    it('Cache-Control: max-age=60 shortens TTL below default', async () => {
        // The /short-cache endpoint returns Cache-Control: max-age=60
        const result = await cachedFetch(`${baseUrl}/short-cache`, {}, cache);
        expect(result._meta.from_cache).toBe(false);

        // Verify the entry exists and has a TTL around 60s (not the default 1h)
        const entries = cache.list();
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        const ttlMs = entry.expires_at - entry.fetched_at;
        // Should be 60_000 ms (60s), not 3_600_000 ms (1h)
        expect(ttlMs).toBeLessThanOrEqual(60_000);
        expect(ttlMs).toBeGreaterThan(0);
    });

    it('works without a cache instance (passthrough to fetchRaw)', async () => {
        const result = await cachedFetch(`${baseUrl}/ok`);
        expect(result._meta.from_cache).toBe(false);
        expect(result.status).toBe(200);
    });
});
