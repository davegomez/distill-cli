import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type CacheEntry, HttpCache } from '#/cache/sqlite.ts';
import {
    globToLike,
    parseDuration,
    runCacheClear,
    runCacheList,
} from '#/commands/cache.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDb(): string {
    const dir = mkdtempSync(join(tmpdir(), 'distill-cache-cmd-test-'));
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

/** Seed the cache at the given path with entries and return the path. */
function seedCache(
    dbPath: string,
    entries: Array<{
        key: string;
        entry: Omit<CacheEntry, 'key' | 'expires_at'>;
    }>,
): void {
    const cache = new HttpCache(dbPath);
    cache.migrate();
    for (const { key, entry } of entries) {
        cache.set(key, entry);
    }
    cache.close();
}

// ---------------------------------------------------------------------------
// parseDuration
// ---------------------------------------------------------------------------

describe('parseDuration', () => {
    it('parses seconds', () => {
        expect(parseDuration('30s')).toBe(30_000);
    });

    it('parses minutes', () => {
        expect(parseDuration('5m')).toBe(300_000);
    });

    it('parses hours', () => {
        expect(parseDuration('1h')).toBe(3_600_000);
    });

    it('parses days', () => {
        expect(parseDuration('7d')).toBe(604_800_000);
    });

    it('parses weeks', () => {
        expect(parseDuration('2w')).toBe(1_209_600_000);
    });

    it('throws on invalid input', () => {
        expect(() => parseDuration('abc')).toThrow('Invalid duration');
    });

    it('throws on missing unit', () => {
        expect(() => parseDuration('100')).toThrow('Invalid duration');
    });
});

// ---------------------------------------------------------------------------
// globToLike
// ---------------------------------------------------------------------------

describe('globToLike', () => {
    it('converts * to %', () => {
        expect(globToLike('*example*')).toBe('%example%');
    });

    it('converts ? to _', () => {
        expect(globToLike('a?b')).toBe('a_b');
    });

    it('escapes literal % and _', () => {
        expect(globToLike('100%_done')).toBe('100\\%\\_done');
    });

    it('passes through normal characters', () => {
        expect(globToLike('https://example.com/path')).toBe(
            'https://example.com/path',
        );
    });
});

// ---------------------------------------------------------------------------
// runCacheList
// ---------------------------------------------------------------------------

describe('runCacheList', () => {
    let dbPath: string;

    beforeEach(() => {
        dbPath = makeTmpDb();
    });

    it('returns expected summary shape', () => {
        seedCache(dbPath, [
            {
                key: 'k1',
                entry: makeEntry({ url: 'https://a.com' }),
            },
            {
                key: 'k2',
                entry: makeEntry({ url: 'https://b.com', status: 404 }),
            },
        ]);

        const entries = runCacheList({ dbPath });
        expect(entries).toHaveLength(2);

        for (const entry of entries) {
            expect(entry).toHaveProperty('key');
            expect(entry).toHaveProperty('url');
            expect(entry).toHaveProperty('fetched_at');
            expect(entry).toHaveProperty('expires_at');
            expect(entry).toHaveProperty('size_bytes');
            expect(entry).toHaveProperty('status');
        }

        const a = entries.find((e) => e.key === 'k1');
        expect(a?.url).toBe('https://a.com');
        expect(a?.status).toBe(200);
        expect(a?.size_bytes).toBeGreaterThan(0);
    });

    it('returns empty array when cache is empty', () => {
        const entries = runCacheList({ dbPath });
        expect(entries).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// runCacheClear
// ---------------------------------------------------------------------------

describe('runCacheClear', () => {
    let dbPath: string;

    beforeEach(() => {
        dbPath = makeTmpDb();
    });

    it('clears all entries when no filters', () => {
        seedCache(dbPath, [
            { key: 'k1', entry: makeEntry() },
            { key: 'k2', entry: makeEntry() },
        ]);

        const result = runCacheClear({ dbPath });
        expect(result.removed).toBe(2);
        expect(runCacheList({ dbPath })).toEqual([]);
    });

    it('--older-than removes old entries, preserves new', () => {
        const oldTime = Date.now() - 2 * 86_400_000; // 2 days ago
        seedCache(dbPath, [
            {
                key: 'old',
                entry: makeEntry({ fetched_at: oldTime }),
            },
            {
                key: 'new',
                entry: makeEntry({ fetched_at: Date.now() }),
            },
        ]);

        const result = runCacheClear({ dbPath, olderThan: '1d' });
        expect(result.removed).toBe(1);

        const remaining = runCacheList({ dbPath });
        expect(remaining).toHaveLength(1);
        expect(remaining[0].key).toBe('new');
    });

    it('--url glob removes matching entries', () => {
        seedCache(dbPath, [
            {
                key: 'k1',
                entry: makeEntry({ url: 'https://example.com/page1' }),
            },
            {
                key: 'k2',
                entry: makeEntry({ url: 'https://example.com/page2' }),
            },
            {
                key: 'k3',
                entry: makeEntry({ url: 'https://other.com/page' }),
            },
        ]);

        const result = runCacheClear({ dbPath, url: '*example.com*' });
        expect(result.removed).toBe(2);

        const remaining = runCacheList({ dbPath });
        expect(remaining).toHaveLength(1);
        expect(remaining[0].url).toBe('https://other.com/page');
    });

    it('combines --older-than and --url filters', () => {
        const oldTime = Date.now() - 2 * 86_400_000;
        seedCache(dbPath, [
            {
                key: 'old-match',
                entry: makeEntry({
                    url: 'https://example.com/a',
                    fetched_at: oldTime,
                }),
            },
            {
                key: 'new-match',
                entry: makeEntry({
                    url: 'https://example.com/b',
                    fetched_at: Date.now(),
                }),
            },
            {
                key: 'old-nomatch',
                entry: makeEntry({
                    url: 'https://other.com/c',
                    fetched_at: oldTime,
                }),
            },
        ]);

        const result = runCacheClear({
            dbPath,
            olderThan: '1d',
            url: '*example.com*',
        });
        // Only the old + matching entry is removed
        expect(result.removed).toBe(1);

        const remaining = runCacheList({ dbPath });
        expect(remaining).toHaveLength(2);
        const keys = remaining.map((e) => e.key).sort();
        expect(keys).toEqual(['new-match', 'old-nomatch']);
    });
});
