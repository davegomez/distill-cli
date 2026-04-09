import { describe, expect, it } from 'vitest';
import { DistillError, ErrorCode } from '#/schema/errors.ts';
import { validateUrl } from '#/security/url.ts';

/** Assert that a call throws a DistillError with the given code. */
function expectError(fn: () => unknown, code: ErrorCode): DistillError {
    try {
        fn();
        expect.unreachable('Expected DistillError to be thrown');
    } catch (err) {
        expect(err).toBeInstanceOf(DistillError);
        expect((err as DistillError).code).toBe(code);
        return err as DistillError;
    }
}

describe('validateUrl', () => {
    describe('valid URLs', () => {
        it('accepts http:// URLs', () => {
            const url = validateUrl('http://example.com/page');
            expect(url.hostname).toBe('example.com');
            expect(url.protocol).toBe('http:');
        });

        it('accepts https:// URLs', () => {
            const url = validateUrl('https://example.com/page?q=1#frag');
            expect(url.hostname).toBe('example.com');
            expect(url.protocol).toBe('https:');
        });

        it('accepts URLs with ports', () => {
            const url = validateUrl('https://example.com:8080/path');
            expect(url.port).toBe('8080');
        });

        it('accepts URLs with auth info', () => {
            const url = validateUrl('https://user:pass@example.com/');
            expect(url.username).toBe('user');
        });
    });

    describe('malformed URLs → INVALID_URL', () => {
        it('rejects empty string', () => {
            expectError(() => validateUrl(''), ErrorCode.INVALID_URL);
        });

        it('rejects garbage string', () => {
            expectError(() => validateUrl('not a url'), ErrorCode.INVALID_URL);
        });

        it('rejects missing scheme', () => {
            expectError(
                () => validateUrl('example.com'),
                ErrorCode.INVALID_URL,
            );
        });
    });

    describe('forbidden schemes → INVALID_SCHEME', () => {
        it('rejects file://', () => {
            expectError(
                () => validateUrl('file:///etc/passwd'),
                ErrorCode.INVALID_SCHEME,
            );
        });

        it('rejects javascript:', () => {
            expectError(
                () => validateUrl('javascript:alert(1)'),
                ErrorCode.INVALID_SCHEME,
            );
        });

        it('rejects data:', () => {
            expectError(
                () => validateUrl('data:text/html,<h1>hi</h1>'),
                ErrorCode.INVALID_SCHEME,
            );
        });

        it('rejects ftp://', () => {
            expectError(
                () => validateUrl('ftp://files.example.com/pub'),
                ErrorCode.INVALID_SCHEME,
            );
        });
    });

    describe('URL length → INVALID_URL', () => {
        it('rejects URLs over 2048 characters', () => {
            const long = `https://example.com/${'a'.repeat(2048)}`;
            expectError(() => validateUrl(long), ErrorCode.INVALID_URL);
        });

        it('accepts URLs at exactly 2048 characters', () => {
            const padding = 2048 - 'https://example.com/'.length;
            const exact = `https://example.com/${'a'.repeat(padding)}`;
            expect(exact.length).toBe(2048);
            const url = validateUrl(exact);
            expect(url.hostname).toBe('example.com');
        });
    });

    describe('control characters → INVALID_URL', () => {
        it('rejects URLs with null byte', () => {
            expectError(
                () => validateUrl('https://example.com/\x00'),
                ErrorCode.INVALID_URL,
            );
        });

        it('rejects URLs with tab', () => {
            expectError(
                () => validateUrl('https://example.com/\t'),
                ErrorCode.INVALID_URL,
            );
        });

        it('rejects URLs with newline', () => {
            expectError(
                () => validateUrl('https://example.com/\n'),
                ErrorCode.INVALID_URL,
            );
        });

        it('rejects URLs with carriage return', () => {
            expectError(
                () => validateUrl('https://example.com/\r'),
                ErrorCode.INVALID_URL,
            );
        });
    });

    describe('private network blocking → PRIVATE_NETWORK_BLOCKED', () => {
        it('rejects 127.0.0.1 (loopback)', () => {
            expectError(
                () => validateUrl('http://127.0.0.1/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects 127.x.x.x range', () => {
            expectError(
                () => validateUrl('http://127.255.0.1/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects 10.x.x.x', () => {
            expectError(
                () => validateUrl('http://10.0.0.1/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects 10.255.255.255', () => {
            expectError(
                () => validateUrl('http://10.255.255.255/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects 192.168.x.x', () => {
            expectError(
                () => validateUrl('http://192.168.1.1/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects 172.16.x.x', () => {
            expectError(
                () => validateUrl('http://172.16.0.1/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects 172.31.x.x', () => {
            expectError(
                () => validateUrl('http://172.31.255.255/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('allows 172.15.x.x (not private)', () => {
            const url = validateUrl('http://172.15.0.1/');
            expect(url.hostname).toBe('172.15.0.1');
        });

        it('allows 172.32.x.x (not private)', () => {
            const url = validateUrl('http://172.32.0.1/');
            expect(url.hostname).toBe('172.32.0.1');
        });

        it('rejects 169.254.x.x (link-local)', () => {
            expectError(
                () => validateUrl('http://169.254.1.1/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects 0.0.0.0', () => {
            expectError(
                () => validateUrl('http://0.0.0.0/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects IPv6 loopback ::1', () => {
            expectError(
                () => validateUrl('http://[::1]/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects IPv6 unique-local fc00::', () => {
            expectError(
                () => validateUrl('http://[fc00::1]/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects IPv6 unique-local fd00::', () => {
            expectError(
                () => validateUrl('http://[fd00::1]/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects IPv6 link-local fe80::', () => {
            expectError(
                () => validateUrl('http://[fe80::1]/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });

        it('rejects IPv6 unspecified ::', () => {
            expectError(
                () => validateUrl('http://[::]/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
        });
    });

    describe('allowPrivateNetwork option', () => {
        it('allows 127.0.0.1 when allowPrivateNetwork is true', () => {
            const url = validateUrl('http://127.0.0.1/', {
                allowPrivateNetwork: true,
            });
            expect(url.hostname).toBe('127.0.0.1');
        });

        it('allows 10.x.x.x when allowPrivateNetwork is true', () => {
            const url = validateUrl('http://10.0.0.1/', {
                allowPrivateNetwork: true,
            });
            expect(url.hostname).toBe('10.0.0.1');
        });

        it('allows 192.168.x.x when allowPrivateNetwork is true', () => {
            const url = validateUrl('http://192.168.1.1/', {
                allowPrivateNetwork: true,
            });
            expect(url.hostname).toBe('192.168.1.1');
        });

        it('allows ::1 when allowPrivateNetwork is true', () => {
            const url = validateUrl('http://[::1]/', {
                allowPrivateNetwork: true,
            });
            expect(url.hostname).toBe('[::1]');
        });
    });

    describe('error shape', () => {
        it('INVALID_URL has exit_code 3', () => {
            const err = expectError(
                () => validateUrl('garbage'),
                ErrorCode.INVALID_URL,
            );
            expect(err.exit_code).toBe(3);
        });

        it('INVALID_SCHEME has exit_code 3', () => {
            const err = expectError(
                () => validateUrl('ftp://x.com'),
                ErrorCode.INVALID_SCHEME,
            );
            expect(err.exit_code).toBe(3);
        });

        it('PRIVATE_NETWORK_BLOCKED has exit_code 3', () => {
            const err = expectError(
                () => validateUrl('http://127.0.0.1/'),
                ErrorCode.PRIVATE_NETWORK_BLOCKED,
            );
            expect(err.exit_code).toBe(3);
        });
    });
});
