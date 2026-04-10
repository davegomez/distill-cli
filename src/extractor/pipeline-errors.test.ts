import { describe, expect, it } from 'vitest';
import { runExtract } from '#/extractor/extract.ts';
import type { PageFetcher } from '#/extractor/pipeline.ts';
import {
    botBlocked,
    browserNotInstalled,
    DistillError,
    dnsFailure,
    timeout,
} from '#/schema/errors.ts';
import { ExtractInputSchema } from '#/schema/input.ts';

function makeInput(url = 'https://example.com/page') {
    return ExtractInputSchema.parse({ url });
}

/** Create a PageFetcher that always throws the given error. */
function throwingFetcher(error: unknown): PageFetcher {
    return {
        async fetch() {
            throw error;
        },
    };
}

describe('error propagation through pipeline', () => {
    it('propagates TIMEOUT with correct exit code and retryable flag', async () => {
        const input = makeInput();
        const err = timeout();

        await expect(
            runExtract(input, { fetcher: throwingFetcher(err) }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown).toBeInstanceOf(DistillError);
            expect(thrown.code).toBe('TIMEOUT');
            expect(thrown.exit_code).toBe(2);
            expect(thrown.retryable).toBe(true);
            return true;
        });
    });

    it('propagates BOT_BLOCKED with correct exit code', async () => {
        const input = makeInput();
        const err = botBlocked(403);

        await expect(
            runExtract(input, { fetcher: throwingFetcher(err) }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown.code).toBe('BOT_BLOCKED');
            expect(thrown.exit_code).toBe(2);
            expect(thrown.retryable).toBe(false);
            expect(thrown.retry_with).toContain('--render');
            return true;
        });
    });

    it('propagates DNS_FAILURE with correct exit code', async () => {
        const input = makeInput();
        const err = dnsFailure('example.com');

        await expect(
            runExtract(input, { fetcher: throwingFetcher(err) }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown.code).toBe('DNS_FAILURE');
            expect(thrown.exit_code).toBe(2);
            return true;
        });
    });

    it('propagates BROWSER_NOT_INSTALLED with correct exit code', async () => {
        const input = makeInput();
        const err = browserNotInstalled();

        await expect(
            runExtract(input, { fetcher: throwingFetcher(err) }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown.code).toBe('BROWSER_NOT_INSTALLED');
            expect(thrown.exit_code).toBe(5);
            return true;
        });
    });

    it('wraps raw Error into unknownError at the boundary', async () => {
        const input = makeInput();
        const rawError = new Error('something broke');

        await expect(
            runExtract(input, { fetcher: throwingFetcher(rawError) }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown).toBeInstanceOf(DistillError);
            expect(thrown.code).toBe('UNKNOWN');
            expect(thrown.exit_code).toBe(5);
            expect(thrown.message).toContain('something broke');
            return true;
        });
    });

    it('wraps non-Error thrown values into unknownError', async () => {
        const input = makeInput();

        await expect(
            runExtract(input, { fetcher: throwingFetcher('string error') }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown).toBeInstanceOf(DistillError);
            expect(thrown.code).toBe('UNKNOWN');
            expect(thrown.message).toContain('string error');
            return true;
        });
    });
});
