import { HttpCache, resolveCachePath } from '#/cache/sqlite.ts';

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

const DURATION_UNITS: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
};

/** Parse a human duration string like "1h", "7d", "30m" into milliseconds. */
export function parseDuration(input: string): number {
    const match = /^(\d+)\s*(s|m|h|d|w)$/.exec(input.trim());
    if (!match) {
        throw new Error(
            `Invalid duration: "${input}". Use format like "1h", "7d", "30m".`,
        );
    }
    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    return value * DURATION_UNITS[unit];
}

// ---------------------------------------------------------------------------
// Glob → SQL LIKE conversion
// ---------------------------------------------------------------------------

/** Convert a simple glob pattern (* and ?) to a SQL LIKE pattern. */
export function globToLike(glob: string): string {
    let result = '';
    for (const ch of glob) {
        if (ch === '*') result += '%';
        else if (ch === '?') result += '_';
        else if (ch === '%') result += '\\%';
        else if (ch === '_') result += '\\_';
        else result += ch;
    }
    return result;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheListEntry {
    key: string;
    url: string;
    fetched_at: number;
    expires_at: number;
    size_bytes: number;
    status: number;
}

export interface CacheListOptions {
    dbPath?: string;
}

export interface CacheClearOptions {
    olderThan?: string;
    url?: string;
    dbPath?: string;
}

export interface CacheClearResult {
    removed: number;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Return a JSON-friendly summary of all cache entries. */
export function runCacheList(opts: CacheListOptions = {}): CacheListEntry[] {
    const cache = new HttpCache(opts.dbPath ?? resolveCachePath());
    cache.migrate();
    try {
        const entries = cache.list();
        return entries.map((e) => ({
            key: e.key,
            url: e.url,
            fetched_at: e.fetched_at,
            expires_at: e.expires_at,
            size_bytes: e.size,
            status: e.status,
        }));
    } finally {
        cache.close();
    }
}

/** Prune cache entries matching the given filters. */
export function runCacheClear(opts: CacheClearOptions = {}): CacheClearResult {
    const cache = new HttpCache(opts.dbPath ?? resolveCachePath());
    cache.migrate();
    try {
        const clearOpts: { olderThan?: number; urlPattern?: string } = {};

        if (opts.olderThan) {
            const ms = parseDuration(opts.olderThan);
            clearOpts.olderThan = Date.now() - ms;
        }

        if (opts.url) {
            clearOpts.urlPattern = globToLike(opts.url);
        }

        const removed = cache.clear(clearOpts);
        return { removed };
    } finally {
        cache.close();
    }
}
