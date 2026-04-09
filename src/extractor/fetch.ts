import {
    botBlocked,
    connectionRefused,
    type DistillError,
    dnsFailure,
    http4xx,
    http5xx,
    timeout as timeoutError,
    tlsError,
    tooLarge,
    unknownError,
} from '#/schema/errors.ts';

/** Realistic Chrome UA — used unless caller overrides via opts.userAgent. */
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Ceiling for a single Retry-After delay. */
const MAX_RETRY_DELAY_MS = 30_000;

/** Body patterns that suggest a bot-block page (checked on 403/429). */
const BOT_BLOCK_BODY_PATTERNS: readonly RegExp[] = [
    /access denied/i,
    /attention required/i,
    /cloudflare/i,
    /just a moment/i,
    /please verify/i,
    /captcha/i,
    /are you a robot/i,
    /bot detection/i,
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FetchRawOptions {
    headers?: Record<string, string>;
    cookies?: string;
    userAgent?: string;
    /** Request timeout in ms (default 30 000). */
    timeout?: number;
    /** Max response body in bytes (default 50 MB). */
    maxSize?: number;
    /** Network retries on 429/503 (default 2). */
    retries?: number;
}

export interface FetchRawResult {
    finalUrl: string;
    status: number;
    headers: Record<string, string>;
    body: Buffer;
    contentType: string;
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

export async function fetchRaw(
    url: string,
    opts: FetchRawOptions = {},
): Promise<FetchRawResult> {
    const {
        headers: customHeaders = {},
        cookies,
        userAgent = DEFAULT_USER_AGENT,
        timeout = 30_000,
        maxSize = 50 * 1024 * 1024,
        retries = 2,
    } = opts;

    const reqHeaders: Record<string, string> = {
        'user-agent': userAgent,
        ...customHeaders,
    };
    if (cookies) {
        reqHeaders.cookie = cookies;
    }

    let lastError: DistillError | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                headers: reqHeaders,
                signal: controller.signal,
                redirect: 'follow',
            });
            clearTimeout(timer);

            // --- Retryable statuses (429 / 503) --------------------------------
            if (
                (response.status === 429 || response.status === 503) &&
                attempt < retries
            ) {
                const retryAfter = parseRetryAfter(
                    response.headers.get('retry-after'),
                );
                const delay = Math.min(retryAfter ?? 1_000, MAX_RETRY_DELAY_MS);
                // Consume the body so the connection is freed.
                await response.arrayBuffer();
                await sleep(delay);
                lastError =
                    response.status === 503 ? http5xx(503) : http4xx(429);
                continue;
            }

            // --- Bot-block detection (403 / 429) --------------------------------
            if (response.status === 403 || response.status === 429) {
                const hasCfRay = response.headers.has('cf-ray');
                const bodyBuf = await readBodyWithLimit(response, maxSize);
                const snippet = bodyBuf.toString('utf-8').slice(0, 4096);
                const hasBotPattern = BOT_BLOCK_BODY_PATTERNS.some((p) =>
                    p.test(snippet),
                );

                if (hasCfRay || hasBotPattern) {
                    throw botBlocked(response.status);
                }
                throw http4xx(response.status);
            }

            // --- Other 4xx -------------------------------------------------------
            if (response.status >= 400 && response.status < 500) {
                await response.arrayBuffer();
                throw http4xx(response.status);
            }

            // --- 5xx (non-503 on last attempt already fell through above) --------
            if (response.status >= 500) {
                await response.arrayBuffer();
                throw http5xx(response.status);
            }

            // --- Success ---------------------------------------------------------
            const body = await readBodyWithLimit(response, maxSize);
            const contentType =
                response.headers.get('content-type') ??
                'application/octet-stream';

            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            return {
                finalUrl: response.url,
                status: response.status,
                headers: responseHeaders,
                body,
                contentType,
            };
        } catch (err) {
            clearTimeout(timer);

            if (isDistillError(err)) throw err;
            throw mapNetworkError(err);
        }
    }

    // All retries exhausted — throw the last recorded error.
    // biome-ignore lint/style/noNonNullAssertion: lastError is always set when loop runs more than once
    throw lastError!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the response body in chunks, enforcing a byte-size ceiling. */
async function readBodyWithLimit(
    response: Response,
    maxSize: number,
): Promise<Buffer> {
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.byteLength;
        if (totalSize > maxSize) {
            await reader.cancel();
            throw tooLarge(
                `Response body exceeds the ${formatBytes(maxSize)} size limit.`,
            );
        }
        chunks.push(value);
    }

    return Buffer.concat(chunks);
}

/**
 * Parse a `Retry-After` header value.
 * Accepts seconds (integer) or an HTTP-date.
 * Returns delay in milliseconds, or undefined if unparseable.
 */
function parseRetryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1_000;
    }

    // HTTP-date format
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
    }
    return undefined;
}

/** Classify an unknown fetch error into a DistillError. */
function mapNetworkError(err: unknown): DistillError {
    // AbortError (timeout)
    if (err instanceof DOMException && err.name === 'AbortError') {
        return timeoutError();
    }
    if (err instanceof Error && err.name === 'AbortError') {
        return timeoutError();
    }

    if (err instanceof Error) {
        // undici wraps the real cause inside TypeError
        const cause = (err as { cause?: Error }).cause;
        const target = cause ?? err;
        const msg = target.message?.toLowerCase() ?? '';
        const code = (target as NodeJS.ErrnoException).code ?? '';

        if (code === 'ENOTFOUND' || msg.includes('getaddrinfo enotfound')) {
            const hostname = extractHostname(msg);
            return dnsFailure(hostname);
        }
        if (code === 'ECONNREFUSED' || msg.includes('econnrefused')) {
            return connectionRefused();
        }
        if (isTlsRelated(code, msg)) {
            return tlsError();
        }
    }

    return unknownError(err instanceof Error ? err.message : String(err));
}

function extractHostname(msg: string): string {
    const match = msg.match(/getaddrinfo\s+\w+\s+(\S+)/);
    return match?.[1] ?? 'unknown';
}

function isTlsRelated(code: string, msg: string): boolean {
    const tlsCodes = [
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'CERT_HAS_EXPIRED',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'ERR_TLS_HANDSHAKE',
    ];
    if (tlsCodes.includes(code)) return true;
    return /\b(ssl|tls|certificate)\b/.test(msg);
}

function isDistillError(
    err: unknown,
): err is import('#/schema/errors.ts').DistillError {
    return err instanceof Error && err.name === 'DistillError';
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} bytes`;
}
