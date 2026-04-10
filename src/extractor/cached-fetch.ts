import { cacheKey, type HttpCache } from '#/cache/sqlite.ts';
import {
    type FetchRawOptions,
    type FetchRawResult,
    fetchRaw,
} from '#/extractor/fetch.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedFetchOptions extends FetchRawOptions {
    /** Skip reading from cache (still writes on miss). */
    noCache?: boolean;
    /** Force a fresh fetch and update the cache entry. */
    refresh?: boolean;
    /** Override the default TTL in milliseconds. */
    maxAge?: number;
}

export interface CachedFetchResult extends FetchRawResult {
    _meta: { from_cache: boolean };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the request carries authentication credentials. */
function isAuthenticated(opts: CachedFetchOptions): boolean {
    if (opts.cookies) return true;
    if (opts.headers) {
        for (const key of Object.keys(opts.headers)) {
            if (key.toLowerCase() === 'authorization') return true;
        }
    }
    return false;
}

/** Build the normalized header map used for the cache key (excludes volatile headers). */
function normalizeHeadersForKey(
    headers: Record<string, string> | undefined,
): Record<string, string> {
    if (!headers) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        const lower = k.toLowerCase();
        // Skip headers that don't affect response content
        if (
            lower === 'user-agent' ||
            lower === 'cookie' ||
            lower === 'authorization'
        )
            continue;
        result[lower] = v;
    }
    return result;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function cachedFetch(
    url: string,
    opts: CachedFetchOptions = {},
    cache?: HttpCache,
): Promise<CachedFetchResult> {
    // ── Auth bypass: never touch the cache for authenticated requests ──
    if (isAuthenticated(opts)) {
        const result = await fetchRaw(url, opts);
        return { ...result, _meta: { from_cache: false } };
    }

    // ── No cache instance provided — just fetch ──
    if (!cache) {
        const result = await fetchRaw(url, opts);
        return { ...result, _meta: { from_cache: false } };
    }

    const normalizedHeaders = normalizeHeadersForKey(opts.headers);
    const key = cacheKey(url, normalizedHeaders, false);

    // ── Try reading from cache (unless noCache or refresh) ──
    if (!opts.noCache && !opts.refresh) {
        const entry = cache.get(key);
        if (entry) {
            return {
                finalUrl: url,
                status: entry.status,
                headers: entry.headers,
                body: entry.body,
                contentType: entry.content_type,
                _meta: { from_cache: true },
            };
        }
    }

    // ── Cache miss / bypass / refresh — do the actual fetch ──
    const result = await fetchRaw(url, opts);

    cache.set(
        key,
        {
            url,
            status: result.status,
            headers: result.headers,
            body: result.body,
            fetched_at: Date.now(),
            content_type: result.contentType,
        },
        opts.maxAge,
    );

    return { ...result, _meta: { from_cache: false } };
}
