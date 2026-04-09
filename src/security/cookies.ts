import { open } from 'node:fs/promises';
import { invalidCookiesFile } from '#/schema/errors.ts';

export interface Cookie {
    domain: string;
    path: string;
    name: string;
    value: string;
    expires?: number;
    secure?: boolean;
    httpOnly?: boolean;
}

const REDACT_PATTERN = /^(cookie|authorization|x-api-key|x-auth)/i;

/**
 * Load and parse a Netscape-format cookies file per DESIGN.md §9.3.
 *
 * Validates file permissions (must be 0600 or stricter on Unix) and
 * parses the cookie jar into structured Cookie objects.
 */
export async function loadCookiesFile(path: string): Promise<Cookie[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
        handle = await open(path, 'r');
    } catch {
        throw invalidCookiesFile(
            path,
            'File does not exist or is not readable.',
        );
    }

    try {
        // Check file permissions on Unix
        if (process.platform !== 'win32') {
            const stats = await handle.stat();
            const mode = stats.mode & 0o777;
            if (mode & 0o077) {
                throw invalidCookiesFile(
                    path,
                    `File permissions are too broad (${`0${mode.toString(8)}`}). Run: chmod 600 ${path}`,
                );
            }
        }

        const content = await handle.readFile('utf-8');
        return parseCookieJar(content, path);
    } finally {
        await handle.close();
    }
}

/**
 * Parse Netscape cookie jar format.
 *
 * Each non-comment, non-empty line has 7 tab-separated fields:
 * domain, flag, path, secure, expires, name, value
 */
function parseCookieJar(content: string, filePath: string): Cookie[] {
    const cookies: Cookie[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        // Lines starting with # are comments, except #HttpOnly_ which is a cookie flag
        if (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_'))
            continue;

        const fields = trimmed.split('\t');
        if (fields.length < 7) {
            throw invalidCookiesFile(
                filePath,
                `Malformed cookie line: expected 7 tab-separated fields, got ${fields.length}.`,
            );
        }

        const [domain, , cookiePath, secure, expires, name, value] = fields;

        const expiresNum = Number(expires);
        if (Number.isNaN(expiresNum)) {
            throw invalidCookiesFile(
                filePath,
                `Invalid expires value: "${expires}".`,
            );
        }

        const cookie: Cookie = {
            domain,
            path: cookiePath,
            name,
            value,
        };

        if (expiresNum > 0) cookie.expires = expiresNum;
        if (secure.toUpperCase() === 'TRUE') cookie.secure = true;

        // httpOnly is indicated by a #HttpOnly_ prefix on the domain
        if (domain.startsWith('#HttpOnly_')) {
            cookie.httpOnly = true;
            cookie.domain = domain.slice('#HttpOnly_'.length);
        }

        cookies.push(cookie);
    }

    return cookies;
}

/**
 * Return a copy of the headers with sensitive values redacted.
 * Headers matching /^(cookie|authorization|x-api-key|x-auth)/i are replaced with "<redacted>".
 */
export function redactHeaders(
    headers: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        result[key] = REDACT_PATTERN.test(key) ? '<redacted>' : value;
    }
    return result;
}

/**
 * Recursively redact sensitive header patterns in any nested object.
 * Returns a deep copy with matching keys replaced by "<redacted>".
 */
export function redactForErrors(received: unknown): unknown {
    if (received === null || received === undefined) return received;
    if (typeof received !== 'object') return received;

    if (Array.isArray(received)) {
        return received.map(redactForErrors);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
        received as Record<string, unknown>,
    )) {
        if (REDACT_PATTERN.test(key) && typeof value === 'string') {
            result[key] = '<redacted>';
        } else {
            result[key] = redactForErrors(value);
        }
    }
    return result;
}
