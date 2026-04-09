import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DistillError, ErrorCode } from '#/schema/errors.ts';
import {
    loadCookiesFile,
    redactForErrors,
    redactHeaders,
} from '#/security/cookies.ts';

function tmpPath(): string {
    return join(tmpdir(), `distill-cookies-test-${randomUUID()}`);
}

const VALID_COOKIE_JAR = [
    '# Netscape HTTP Cookie File',
    '.example.com\tTRUE\t/\tFALSE\t0\tsession_id\tabc123',
    '.example.com\tTRUE\t/secure\tTRUE\t1700000000\ttoken\txyz789',
].join('\n');

describe('loadCookiesFile', () => {
    const tempFiles: string[] = [];

    afterEach(async () => {
        for (const f of tempFiles) {
            await rm(f, { force: true });
        }
        tempFiles.length = 0;
    });

    it('loads a cookie file with mode 0600', async () => {
        const path = tmpPath();
        tempFiles.push(path);
        await writeFile(path, VALID_COOKIE_JAR, { mode: 0o600 });

        const cookies = await loadCookiesFile(path);

        expect(cookies).toHaveLength(2);
        expect(cookies[0]).toEqual({
            domain: '.example.com',
            path: '/',
            name: 'session_id',
            value: 'abc123',
        });
        expect(cookies[1]).toEqual({
            domain: '.example.com',
            path: '/secure',
            name: 'token',
            value: 'xyz789',
            expires: 1700000000,
            secure: true,
        });
    });

    it('throws INVALID_COOKIES_FILE for mode 0644', async () => {
        const path = tmpPath();
        tempFiles.push(path);
        await writeFile(path, VALID_COOKIE_JAR, { mode: 0o644 });

        try {
            await loadCookiesFile(path);
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe(
                ErrorCode.INVALID_COOKIES_FILE,
            );
            expect((err as DistillError).hint).toContain('chmod 600');
        }
    });

    it('throws INVALID_COOKIES_FILE for mode 0640', async () => {
        const path = tmpPath();
        tempFiles.push(path);
        await writeFile(path, VALID_COOKIE_JAR, { mode: 0o640 });

        try {
            await loadCookiesFile(path);
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe(
                ErrorCode.INVALID_COOKIES_FILE,
            );
        }
    });

    it('accepts mode 0400 (stricter than 0600)', async () => {
        const path = tmpPath();
        tempFiles.push(path);
        await writeFile(path, VALID_COOKIE_JAR, { mode: 0o400 });

        const cookies = await loadCookiesFile(path);
        expect(cookies).toHaveLength(2);
    });

    it('throws INVALID_COOKIES_FILE for malformed cookie jar', async () => {
        const path = tmpPath();
        tempFiles.push(path);
        const malformed = 'not\ta\tvalid\tcookie';
        await writeFile(path, malformed, { mode: 0o600 });

        try {
            await loadCookiesFile(path);
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe(
                ErrorCode.INVALID_COOKIES_FILE,
            );
            expect((err as DistillError).hint).toContain('tab-separated');
        }
    });

    it('throws INVALID_COOKIES_FILE for non-existent file', async () => {
        try {
            await loadCookiesFile(`/tmp/does-not-exist-${randomUUID()}`);
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe(
                ErrorCode.INVALID_COOKIES_FILE,
            );
        }
    });

    it('parses #HttpOnly_ prefix as httpOnly flag', async () => {
        const path = tmpPath();
        tempFiles.push(path);
        const jar = '#HttpOnly_.example.com\tTRUE\t/\tFALSE\t0\tsid\tabc';
        await writeFile(path, jar, { mode: 0o600 });

        const cookies = await loadCookiesFile(path);
        expect(cookies[0]).toEqual({
            domain: '.example.com',
            path: '/',
            name: 'sid',
            value: 'abc',
            httpOnly: true,
        });
    });

    it('skips blank lines and comment lines', async () => {
        const path = tmpPath();
        tempFiles.push(path);
        const jar = [
            '# Comment',
            '',
            '  ',
            '# Another comment',
            '.example.com\tTRUE\t/\tFALSE\t0\tname\tvalue',
        ].join('\n');
        await writeFile(path, jar, { mode: 0o600 });

        const cookies = await loadCookiesFile(path);
        expect(cookies).toHaveLength(1);
    });
});

describe('redactHeaders', () => {
    it('redacts Cookie header', () => {
        const result = redactHeaders({ Cookie: 'session=abc123' });
        expect(result.Cookie).toBe('<redacted>');
    });

    it('redacts Authorization header', () => {
        const result = redactHeaders({ Authorization: 'Bearer token' });
        expect(result.Authorization).toBe('<redacted>');
    });

    it('redacts X-API-Key header', () => {
        const result = redactHeaders({ 'X-API-Key': 'secret-key' });
        expect(result['X-API-Key']).toBe('<redacted>');
    });

    it('redacts X-Auth-Token header', () => {
        const result = redactHeaders({ 'X-Auth-Token': 'token123' });
        expect(result['X-Auth-Token']).toBe('<redacted>');
    });

    it('redacts case-insensitively', () => {
        const result = redactHeaders({
            cookie: 'val',
            AUTHORIZATION: 'val',
            'x-api-key': 'val',
            'x-auth-custom': 'val',
        });
        expect(result.cookie).toBe('<redacted>');
        expect(result.AUTHORIZATION).toBe('<redacted>');
        expect(result['x-api-key']).toBe('<redacted>');
        expect(result['x-auth-custom']).toBe('<redacted>');
    });

    it('preserves non-sensitive headers verbatim', () => {
        const result = redactHeaders({
            'Content-Type': 'application/json',
            Accept: 'text/html',
            'User-Agent': 'distill/1.0',
        });
        expect(result['Content-Type']).toBe('application/json');
        expect(result.Accept).toBe('text/html');
        expect(result['User-Agent']).toBe('distill/1.0');
    });

    it('returns a new object (does not mutate input)', () => {
        const input = { Cookie: 'secret', Accept: 'text/html' };
        const result = redactHeaders(input);
        expect(result).not.toBe(input);
        expect(input.Cookie).toBe('secret');
    });
});

describe('redactForErrors', () => {
    it('redacts sensitive keys in a flat object', () => {
        const result = redactForErrors({
            cookie: 'secret',
            authorization: 'Bearer x',
            url: 'https://example.com',
        });
        expect(result).toEqual({
            cookie: '<redacted>',
            authorization: '<redacted>',
            url: 'https://example.com',
        });
    });

    it('recursively redacts in nested objects', () => {
        const result = redactForErrors({
            request: {
                headers: {
                    Authorization: 'Bearer token',
                    'Content-Type': 'text/html',
                },
            },
        });
        expect(result).toEqual({
            request: {
                headers: {
                    Authorization: '<redacted>',
                    'Content-Type': 'text/html',
                },
            },
        });
    });

    it('handles arrays', () => {
        const result = redactForErrors([
            { cookie: 'val1' },
            { 'x-api-key': 'val2', other: 'keep' },
        ]);
        expect(result).toEqual([
            { cookie: '<redacted>' },
            { 'x-api-key': '<redacted>', other: 'keep' },
        ]);
    });

    it('passes through primitives unchanged', () => {
        expect(redactForErrors('hello')).toBe('hello');
        expect(redactForErrors(42)).toBe(42);
        expect(redactForErrors(true)).toBe(true);
        expect(redactForErrors(null)).toBe(null);
        expect(redactForErrors(undefined)).toBe(undefined);
    });
});
