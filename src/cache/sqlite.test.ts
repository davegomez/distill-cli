import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type CacheEntry,
    cacheKey,
    HttpCache,
    resolveCacheDir,
    resolveCachePath,
} from '#/cache/sqlite.ts';

function makeTmpDb(): string {
    const dir = mkdtempSync(join(tmpdir(), 'distill-cache-test-'));
    return join(dir, 'test-cache.sqlite');
}

function makeEntry(
    overrides?: Partial<Omit<CacheEntry, 'key' | 'expires_at'>>,
): Omit<CacheEntry, 'key' | 'expires_at'> {
    return {
        url: 'https://example.com',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('<h1>Hello</h1>'),
        fetched_at: Date.now(),
        content_type: 'text/html',
        ...overrides,
    };
}

describe('HttpCache', () => {
    let cache: HttpCache;
    let dbPath: string;

    beforeEach(() => {
        dbPath = makeTmpDb();
        cache = new HttpCache(dbPath);
        cache.migrate();
    });

    afterEach(() => {
        cache.close();
    });

    describe('migrate()', () => {
        it('creates the cache table', () => {
            const db = new DatabaseSync(dbPath);
            const row = db
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='cache'",
                )
                .get() as { name: string } | undefined;
            db.close();
            expect(row).toBeDefined();
            expect(row?.name).toBe('cache');
        });

        it('is idempotent', () => {
            expect(() => cache.migrate()).not.toThrow();
        });
    });

    describe('set/get round-trip', () => {
        it('stores and retrieves an entry', () => {
            const entry = makeEntry();
            cache.set('key1', entry);
            const result = cache.get('key1');
            expect(result).toBeDefined();
            expect(result?.key).toBe('key1');
            expect(result?.status).toBe(200);
            expect(result?.headers).toEqual({ 'content-type': 'text/html' });
            expect(result?.body.toString()).toBe('<h1>Hello</h1>');
            expect(result?.content_type).toBe('text/html');
        });

        it('returns undefined for missing key', () => {
            expect(cache.get('nonexistent')).toBeUndefined();
        });

        it('overwrites existing entry on same key', () => {
            cache.set('key1', makeEntry({ status: 200 }));
            cache.set('key1', makeEntry({ status: 304 }));
            const result = cache.get('key1');
            expect(result?.status).toBe(304);
        });
    });

    describe('TTL / expiration', () => {
        it('does not return expired entries', () => {
            const entry = makeEntry({ fetched_at: Date.now() - 120_000 });
            cache.set('expired', entry, 60_000); // TTL 60s, but fetched 120s ago
            expect(cache.get('expired')).toBeUndefined();
        });

        it('returns entries within TTL', () => {
            const entry = makeEntry({ fetched_at: Date.now() });
            cache.set('fresh', entry, 60_000);
            expect(cache.get('fresh')).toBeDefined();
        });

        it('respects shorter Cache-Control max-age over provided TTL', () => {
            const entry = makeEntry({
                fetched_at: Date.now() - 5_000,
                headers: { 'cache-control': 'max-age=2' },
            });
            // TTL is 1 hour, but Cache-Control says 2s and it was fetched 5s ago
            cache.set('cc-short', entry);
            expect(cache.get('cc-short')).toBeUndefined();
        });

        it('uses default TTL when no Cache-Control present', () => {
            const entry = makeEntry({ fetched_at: Date.now() });
            cache.set('default-ttl', entry);
            const result = cache.get('default-ttl');
            expect(result).toBeDefined();
            // expires_at should be ~1 hour from fetched_at
            expect(result?.expires_at).toBeGreaterThan(Date.now() + 3_500_000);
        });
    });

    describe('delete(pattern)', () => {
        it('removes matching keys', () => {
            cache.set('url:https://a.com', makeEntry());
            cache.set('url:https://b.com', makeEntry());
            cache.set('other:key', makeEntry());

            const deleted = cache.delete('url:%');
            expect(deleted).toBe(2);
            expect(cache.get('url:https://a.com')).toBeUndefined();
            expect(cache.get('url:https://b.com')).toBeUndefined();
            expect(cache.get('other:key')).toBeDefined();
        });

        it('returns 0 when no keys match', () => {
            expect(cache.delete('nope%')).toBe(0);
        });
    });

    describe('list()', () => {
        it('returns summary of all entries', () => {
            cache.set('k1', makeEntry({ content_type: 'text/html' }));
            cache.set('k2', makeEntry({ content_type: 'application/json' }));
            const entries = cache.list();
            expect(entries).toHaveLength(2);
            expect(entries[0].key).toBeDefined();
            expect(entries[0].size).toBeGreaterThan(0);
            expect(entries[0].content_type).toBeDefined();
        });

        it('filters by key pattern', () => {
            cache.set('a:1', makeEntry());
            cache.set('b:2', makeEntry());
            const entries = cache.list('a:%');
            expect(entries).toHaveLength(1);
            expect(entries[0].key).toBe('a:1');
        });

        it('returns empty array when no entries', () => {
            expect(cache.list()).toEqual([]);
        });
    });

    describe('clear()', () => {
        it('removes all entries when no options', () => {
            cache.set('k1', makeEntry());
            cache.set('k2', makeEntry());
            const cleared = cache.clear();
            expect(cleared).toBe(2);
            expect(cache.list()).toEqual([]);
        });

        it('prunes entries older than threshold with olderThan', () => {
            const old = makeEntry({ fetched_at: Date.now() - 100_000 });
            const recent = makeEntry({ fetched_at: Date.now() });
            cache.set('old', old);
            cache.set('recent', recent);

            const cleared = cache.clear({ olderThan: Date.now() - 50_000 });
            expect(cleared).toBe(1);
            expect(cache.get('old')).toBeUndefined();
            expect(cache.get('recent')).toBeDefined();
        });
    });

    describe('WAL mode / concurrent writers', () => {
        it('two Database instances writing concurrently do not corrupt', () => {
            const cache2 = new HttpCache(dbPath);
            cache2.migrate();

            // Write from both caches concurrently
            for (let i = 0; i < 50; i++) {
                cache.set(`c1-${i}`, makeEntry({ status: 200 + i }));
                cache2.set(`c2-${i}`, makeEntry({ status: 300 + i }));
            }

            // Verify all entries are present
            const entries = cache.list();
            expect(entries).toHaveLength(100);

            // Verify data integrity
            const c1Entry = cache.get('c1-0');
            expect(c1Entry).toBeDefined();
            expect(c1Entry?.status).toBe(200);

            const c2Entry = cache.get('c2-0');
            expect(c2Entry).toBeDefined();
            expect(c2Entry?.status).toBe(300);

            cache2.close();
        });
    });
});

describe('HttpCache constructor error handling', () => {
    it('closes db handle on initialization error', () => {
        const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close');
        const execSpy = vi
            .spyOn(DatabaseSync.prototype, 'exec')
            .mockImplementation(() => {
                throw new Error('simulated PRAGMA failure');
            });

        const dbPath = makeTmpDb();
        expect(() => new HttpCache(dbPath)).toThrow('simulated PRAGMA failure');
        expect(closeSpy).toHaveBeenCalledTimes(1);

        execSpy.mockRestore();
        closeSpy.mockRestore();
    });
});

describe('cacheKey()', () => {
    it('produces a hex string', () => {
        const key = cacheKey('https://example.com', {}, false);
        expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('different URLs produce different keys', () => {
        const k1 = cacheKey('https://a.com', {}, false);
        const k2 = cacheKey('https://b.com', {}, false);
        expect(k1).not.toBe(k2);
    });

    it('different headers produce different keys', () => {
        const k1 = cacheKey('https://a.com', { accept: 'text/html' }, false);
        const k2 = cacheKey(
            'https://a.com',
            { accept: 'application/json' },
            false,
        );
        expect(k1).not.toBe(k2);
    });

    it('hasAuth flag changes the key', () => {
        const k1 = cacheKey('https://a.com', {}, false);
        const k2 = cacheKey('https://a.com', {}, true);
        expect(k1).not.toBe(k2);
    });

    it('header order does not affect the key', () => {
        const k1 = cacheKey('https://a.com', { a: '1', b: '2' }, false);
        const k2 = cacheKey('https://a.com', { b: '2', a: '1' }, false);
        expect(k1).toBe(k2);
    });
});

describe('resolveCacheDir()', () => {
    it('returns a string path', () => {
        const dir = resolveCacheDir();
        expect(typeof dir).toBe('string');
        expect(dir).toContain('distill');
    });
});

describe('resolveCachePath()', () => {
    it('returns path ending in http-cache.sqlite', () => {
        const p = resolveCachePath();
        expect(p).toMatch(/http-cache\.sqlite$/);
    });
});
