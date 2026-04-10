import { describe, expect, it } from 'vitest';
import { runExtract } from '#/extractor/extract.ts';
import {
    fakeFetcher,
    parseInput,
    throwingFetcher,
} from '#/extractor/test-utils.ts';
import {
    botBlocked,
    browserNotInstalled,
    DistillError,
    dnsFailure,
    timeout,
} from '#/schema/errors.ts';

describe('error propagation through pipeline', () => {
    it('propagates TIMEOUT with correct exit code and retryable flag', async () => {
        const input = parseInput();
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
        const input = parseInput();
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
        const input = parseInput();
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
        const input = parseInput();
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
        const input = parseInput();
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
        const input = parseInput();

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

// ---------------------------------------------------------------------------
// Extraction-phase errors that require HTML to flow through the pipeline
// ---------------------------------------------------------------------------

describe('extraction-phase errors through pipeline', () => {
    it('throws CONTENT_EMPTY when explicit selector matches but has no visible text', async () => {
        const html = `<html><head><title>Test</title></head><body>
            <div id="target">   \t\n   </div>
        </body></html>`;

        const input = parseInput({ selector: '#target' });

        await expect(
            runExtract(input, { fetcher: fakeFetcher(html) }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown).toBeInstanceOf(DistillError);
            expect(thrown.code).toBe('CONTENT_EMPTY');
            expect(thrown.exit_code).toBe(1);
            return true;
        });
    });

    it('throws ALL_STRATEGIES_FAILED when no selector-chain matches and heuristic scores below threshold', async () => {
        // No selector-chain targets (main, article, [role="main"], #content,
        // .post-content, .entry-content) and body content too short to score
        // above MIN_SCORE_THRESHOLD (20).
        const html = `<html><head><title>X</title></head><body>
            <div>hi</div>
        </body></html>`;

        const input = parseInput();

        await expect(
            runExtract(input, { fetcher: fakeFetcher(html) }),
        ).rejects.toSatisfy((thrown: DistillError) => {
            expect(thrown).toBeInstanceOf(DistillError);
            expect(thrown.code).toBe('ALL_STRATEGIES_FAILED');
            expect(thrown.exit_code).toBe(1);
            return true;
        });
    });
});
