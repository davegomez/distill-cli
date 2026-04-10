import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
    key: string;
    url: string;
    status: number;
    headers: Record<string, string>;
    body: Buffer;
    fetched_at: number;
    expires_at: number;
    content_type: string;
}

export interface CacheEntrySummary {
    key: string;
    url: string;
    status: number;
    content_type: string;
    size: number;
    fetched_at: number;
    expires_at: number;
}

export interface ClearOptions {
    olderThan?: number;
    urlPattern?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Cache directory resolution
// ---------------------------------------------------------------------------

export function resolveCacheDir(): string {
    if (platform() === 'darwin') {
        return join(homedir(), 'Library', 'Caches', 'distill');
    }
    const xdg = process.env.XDG_CACHE_HOME;
    return join(xdg || join(homedir(), '.cache'), 'distill');
}

export function resolveCachePath(): string {
    return join(resolveCacheDir(), 'http-cache.sqlite');
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

export function cacheKey(
    url: string,
    normalizedHeaders: Record<string, string>,
    hasAuth: boolean,
): string {
    const h = createHash('sha256');
    h.update(url);
    const sortedKeys = Object.keys(normalizedHeaders).sort();
    for (const k of sortedKeys) {
        h.update(`${k}:${normalizedHeaders[k]}`);
    }
    h.update(hasAuth ? '1' : '0');
    return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Parse Cache-Control max-age
// ---------------------------------------------------------------------------

function parseMaxAge(headers: Record<string, string>): number | undefined {
    const cc = headers['cache-control'];
    if (!cc) return undefined;
    const match = /max-age=(\d+)/.exec(cc);
    if (!match) return undefined;
    const seconds = Number.parseInt(match[1], 10);
    if (Number.isNaN(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
}

// ---------------------------------------------------------------------------
// Cache class
// ---------------------------------------------------------------------------

export class HttpCache {
    private db: DatabaseSync;

    constructor(dbPath?: string) {
        const path = dbPath ?? resolveCachePath();
        const dir = join(path, '..');
        mkdirSync(dir, { recursive: true });
        this.db = new DatabaseSync(path);
        try {
            this.db.exec('PRAGMA journal_mode=WAL');
        } catch (err) {
            this.db.close();
            throw err;
        }
    }

    /** Create the cache schema if it doesn't exist. */
    migrate(): void {
        this.db.exec(`
			CREATE TABLE IF NOT EXISTS cache (
				key TEXT PRIMARY KEY,
				url TEXT NOT NULL DEFAULT '',
				status INTEGER NOT NULL,
				headers TEXT NOT NULL,
				body BLOB NOT NULL,
				fetched_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				content_type TEXT NOT NULL
			)
		`);
        // Add url column to pre-existing tables that lack it.
        try {
            this.db.exec(
                "ALTER TABLE cache ADD COLUMN url TEXT NOT NULL DEFAULT ''",
            );
        } catch {
            // Column already exists — ignore.
        }
    }

    /** Retrieve a cached entry. Returns undefined if missing or expired. */
    get(key: string): CacheEntry | undefined {
        const stmt = this.db.prepare(
            'SELECT key, url, status, headers, body, fetched_at, expires_at, content_type FROM cache WHERE key = ?',
        );
        const row = stmt.get(key) as
            | {
                  key: string;
                  url: string;
                  status: number;
                  headers: string;
                  body: Uint8Array;
                  fetched_at: number;
                  expires_at: number;
                  content_type: string;
              }
            | undefined;
        if (!row) return undefined;

        const now = Date.now();
        if (row.expires_at <= now) return undefined;

        return {
            key: row.key,
            url: row.url,
            status: row.status,
            headers: JSON.parse(row.headers) as Record<string, string>,
            body: Buffer.from(row.body),
            fetched_at: row.fetched_at,
            expires_at: row.expires_at,
            content_type: row.content_type,
        };
    }

    /** Store a cache entry with a TTL in milliseconds. */
    set(
        key: string,
        entry: Omit<CacheEntry, 'key' | 'expires_at'>,
        ttl?: number,
    ): void {
        const maxAge = parseMaxAge(entry.headers);
        const effectiveTtl = Math.min(
            ttl ?? DEFAULT_TTL_MS,
            maxAge ?? DEFAULT_TTL_MS,
        );
        const now = Date.now();
        const expiresAt = entry.fetched_at + effectiveTtl;

        const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO cache (key, url, status, headers, body, fetched_at, expires_at, content_type)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
        stmt.run(
            key,
            entry.url,
            entry.status,
            JSON.stringify(entry.headers),
            entry.body,
            entry.fetched_at || now,
            expiresAt,
            entry.content_type,
        );
    }

    /** Delete entries whose keys match a SQL LIKE pattern. */
    delete(pattern: string): number {
        const stmt = this.db.prepare('DELETE FROM cache WHERE key LIKE ?');
        const result = stmt.run(pattern);
        return Number(result.changes);
    }

    /** Return a summary of all cached entries, optionally filtered by key pattern. */
    list(filter?: string): CacheEntrySummary[] {
        const query = filter
            ? 'SELECT key, url, status, content_type, length(body) as size, fetched_at, expires_at FROM cache WHERE key LIKE ?'
            : 'SELECT key, url, status, content_type, length(body) as size, fetched_at, expires_at FROM cache';
        const stmt = this.db.prepare(query);
        const rows = (filter ? stmt.all(filter) : stmt.all()) as Array<{
            key: string;
            url: string;
            status: number;
            content_type: string;
            size: number;
            fetched_at: number;
            expires_at: number;
        }>;
        return rows.map((r) => ({
            key: r.key,
            url: r.url,
            status: r.status,
            content_type: r.content_type,
            size: r.size,
            fetched_at: r.fetched_at,
            expires_at: r.expires_at,
        }));
    }

    /** Clear entries. Supports filtering by age and/or URL pattern (SQL LIKE). */
    clear(opts?: ClearOptions): number {
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (opts?.olderThan != null) {
            conditions.push('fetched_at < ?');
            params.push(opts.olderThan);
        }
        if (opts?.urlPattern) {
            conditions.push('url LIKE ?');
            params.push(opts.urlPattern);
        }

        const where =
            conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
        const stmt = this.db.prepare(`DELETE FROM cache${where}`);
        const result = stmt.run(...params);
        return Number(result.changes);
    }

    /** Close the database connection. */
    close(): void {
        this.db.close();
    }
}
