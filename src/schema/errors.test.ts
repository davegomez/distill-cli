import { describe, expect, it } from 'vitest';
import {
    botBlocked,
    connectionRefused,
    DistillError,
    DistillErrorSchema,
    ERROR_CODE_EXIT_CODES,
    ErrorCode,
    http5xx,
    invalidUrl,
    timeout,
} from '#/schema/errors.ts';

describe('ErrorCode', () => {
    it('has all 28 codes from §10.2', () => {
        const codes = Object.values(ErrorCode);
        expect(codes).toHaveLength(28);
    });

    it('every code has an exit code mapping', () => {
        for (const code of Object.values(ErrorCode)) {
            expect(ERROR_CODE_EXIT_CODES[code]).toBeDefined();
            expect(ERROR_CODE_EXIT_CODES[code]).toBeGreaterThanOrEqual(1);
            expect(ERROR_CODE_EXIT_CODES[code]).toBeLessThanOrEqual(5);
        }
    });

    it('maps extraction codes to exit 1', () => {
        expect(ERROR_CODE_EXIT_CODES.CONTENT_EMPTY).toBe(1);
        expect(ERROR_CODE_EXIT_CODES.SELECTOR_NOT_FOUND).toBe(1);
        expect(ERROR_CODE_EXIT_CODES.EXTRACTION_LOW_QUALITY).toBe(1);
        expect(ERROR_CODE_EXIT_CODES.ALL_STRATEGIES_FAILED).toBe(1);
    });

    it('maps network codes to exit 2', () => {
        expect(ERROR_CODE_EXIT_CODES.DNS_FAILURE).toBe(2);
        expect(ERROR_CODE_EXIT_CODES.TIMEOUT).toBe(2);
        expect(ERROR_CODE_EXIT_CODES.BOT_BLOCKED).toBe(2);
        expect(ERROR_CODE_EXIT_CODES.HTTP_5XX).toBe(2);
    });

    it('maps validation codes to exit 3', () => {
        expect(ERROR_CODE_EXIT_CODES.INVALID_URL).toBe(3);
        expect(ERROR_CODE_EXIT_CODES.INVALID_ACTIONS).toBe(3);
    });

    it('maps action codes to exit 4', () => {
        expect(ERROR_CODE_EXIT_CODES.ACTION_SELECTOR_NOT_FOUND).toBe(4);
        expect(ERROR_CODE_EXIT_CODES.ACTION_TIMEOUT).toBe(4);
    });

    it('maps internal codes to exit 5', () => {
        expect(ERROR_CODE_EXIT_CODES.BROWSER_NOT_INSTALLED).toBe(5);
        expect(ERROR_CODE_EXIT_CODES.UNKNOWN).toBe(5);
    });
});

describe('DistillError', () => {
    it('serializes to the §4.4 JSON error shape', () => {
        const err = new DistillError({
            code: ErrorCode.BOT_BLOCKED,
            message: 'Target responded with 403.',
            hint: 'Try --render.',
            retry_with: ['--render'],
            received: { url: 'https://example.com' },
        });

        const json = err.toJSON();
        const result = DistillErrorSchema.safeParse(json);
        expect(result.success).toBe(true);
        expect(json.code).toBe('BOT_BLOCKED');
        expect(json.message).toBe('Target responded with 403.');
        expect(json.hint).toBe('Try --render.');
        expect(json.retryable).toBe(false);
        expect(json.retry_with).toEqual(['--render']);
        expect(json.received).toEqual({
            url: 'https://example.com',
        });
    });

    it('derives exit_code from ERROR_CODE_EXIT_CODES', () => {
        const err = new DistillError({
            code: ErrorCode.INVALID_URL,
            message: 'bad url',
        });
        expect(err.exit_code).toBe(3);
    });

    it('defaults retryable based on RETRYABLE_CODES set', () => {
        const retryable = new DistillError({
            code: ErrorCode.TIMEOUT,
            message: 'timed out',
        });
        expect(retryable.retryable).toBe(true);

        const notRetryable = new DistillError({
            code: ErrorCode.BOT_BLOCKED,
            message: 'blocked',
        });
        expect(notRetryable.retryable).toBe(false);
    });

    it('allows overriding retryable', () => {
        const err = new DistillError({
            code: ErrorCode.TIMEOUT,
            message: 'timed out',
            retryable: false,
        });
        expect(err.retryable).toBe(false);
    });

    it('is an instance of Error', () => {
        const err = new DistillError({
            code: ErrorCode.UNKNOWN,
            message: 'oops',
        });
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('DistillError');
    });
});

describe('retryable semantics (§4.4)', () => {
    it('CONNECTION_REFUSED is retryable (transient)', () => {
        const err = connectionRefused();
        expect(err.retryable).toBe(true);
    });

    it('TIMEOUT is retryable (transient)', () => {
        const err = timeout();
        expect(err.retryable).toBe(true);
    });

    it('HTTP_5XX is retryable (transient)', () => {
        const err = http5xx(502);
        expect(err.retryable).toBe(true);
    });

    it('BOT_BLOCKED is NOT retryable', () => {
        const err = botBlocked(403);
        expect(err.retryable).toBe(false);
    });

    it('INVALID_URL is NOT retryable', () => {
        const err = invalidUrl('not-a-url');
        expect(err.retryable).toBe(false);
    });

    it('only CONNECTION_REFUSED, TIMEOUT, HTTP_5XX are retryable', () => {
        const retryableCodes: Set<string> = new Set([
            ErrorCode.CONNECTION_REFUSED,
            ErrorCode.TIMEOUT,
            ErrorCode.HTTP_5XX,
        ]);

        for (const code of Object.values(ErrorCode)) {
            const err = new DistillError({ code, message: 'test' });
            if (retryableCodes.has(code)) {
                expect(err.retryable).toBe(true);
            } else {
                expect(err.retryable).toBe(false);
            }
        }
    });
});

describe('helper constructors', () => {
    it('invalidUrl sets code, exit_code, received', () => {
        const err = invalidUrl('ftp://bad', 'Use https');
        expect(err.code).toBe(ErrorCode.INVALID_URL);
        expect(err.exit_code).toBe(3);
        expect(err.retryable).toBe(false);
        expect(err.received).toEqual({ url: 'ftp://bad' });
        expect(err.hint).toBe('Use https');
    });

    it('botBlocked sets retry_with per §4.4', () => {
        const err = botBlocked(403);
        expect(err.code).toBe(ErrorCode.BOT_BLOCKED);
        expect(err.exit_code).toBe(2);
        expect(err.retryable).toBe(false);
        expect(err.retry_with).toEqual([
            '--render',
            '--cookies',
            '--user-agent',
        ]);
        expect(err.received).toEqual({ status: 403 });
    });

    it('timeout sets retryable true and retry_with', () => {
        const err = timeout();
        expect(err.code).toBe(ErrorCode.TIMEOUT);
        expect(err.exit_code).toBe(2);
        expect(err.retryable).toBe(true);
        expect(err.retry_with).toEqual(['--timeout', '--render']);
    });

    it('all helpers produce valid schema output', () => {
        const helpers = [
            invalidUrl('x'),
            botBlocked(403),
            timeout(),
            connectionRefused(),
            http5xx(500),
        ];
        for (const err of helpers) {
            const result = DistillErrorSchema.safeParse(err.toJSON());
            expect(result.success).toBe(true);
        }
    });
});
