import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeActions } from '#/extractor/actions.ts';
import { ErrorCode } from '#/schema/errors.ts';
import type { Action } from '#/schema/input.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPage(overrides: Record<string, unknown> = {}): Page {
    const roleClick = vi.fn().mockResolvedValue(undefined);
    const scrollIntoView = vi.fn().mockResolvedValue(undefined);

    return {
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        keyboard: {
            press: vi.fn().mockResolvedValue(undefined),
        },
        getByRole: vi.fn().mockReturnValue({ click: roleClick }),
        locator: vi.fn().mockReturnValue({
            scrollIntoViewIfNeeded: scrollIntoView,
        }),
        ...overrides,
    } as unknown as Page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeActions', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('records timing and result in trace', async () => {
        const page = createMockPage();
        const actions: Action[] = [
            { type: 'click', selector: '.btn' },
            { type: 'press', key: 'Enter' },
        ];

        const { trace } = await executeActions(page, actions);

        expect(trace).toHaveLength(2);
        expect(trace[0]).toMatchObject({
            index: 0,
            type: 'click',
            result: 'ok',
        });
        expect(trace[0].elapsed_ms).toBeGreaterThanOrEqual(0);
        expect(trace[1]).toMatchObject({
            index: 1,
            type: 'press',
            result: 'ok',
        });
        expect(trace[1].elapsed_ms).toBeGreaterThanOrEqual(0);
    });

    it('caps wait ms at 10s', async () => {
        vi.useFakeTimers();
        const page = createMockPage();
        // Bypass schema .max(10000) to test the runtime cap
        const actions = [{ type: 'wait' as const, ms: 15_000 }] as Action[];

        const promise = executeActions(page, actions);
        // Capped to 10s — advancing 10s should resolve the wait
        await vi.advanceTimersByTimeAsync(10_000);
        const { trace } = await promise;

        expect(trace).toHaveLength(1);
        expect(trace[0]).toMatchObject({
            index: 0,
            type: 'wait',
            result: 'ok',
        });
    });

    it('throws ACTION_SELECTOR_NOT_FOUND for failed non-optional action', async () => {
        const page = createMockPage({
            click: vi.fn().mockRejectedValue(new Error('Element not found')),
        });
        const actions: Action[] = [{ type: 'click', selector: '.missing' }];

        await expect(executeActions(page, actions)).rejects.toMatchObject({
            name: 'DistillError',
            code: ErrorCode.ACTION_SELECTOR_NOT_FOUND,
        });
    });

    it('throws ACTION_TIMEOUT for timeout errors', async () => {
        const page = createMockPage({
            waitForSelector: vi
                .fn()
                .mockRejectedValue(new Error('Timeout 30000ms exceeded')),
        });
        const actions: Action[] = [{ type: 'wait', selector: '.slow' }];

        await expect(executeActions(page, actions)).rejects.toMatchObject({
            name: 'DistillError',
            code: ErrorCode.ACTION_TIMEOUT,
        });
    });

    it('throws ACTION_INTERCEPTED for intercepted actions', async () => {
        const page = createMockPage({
            click: vi
                .fn()
                .mockRejectedValue(
                    new Error('Element intercept pointer events'),
                ),
        });
        const actions: Action[] = [{ type: 'click', selector: '.covered' }];

        await expect(executeActions(page, actions)).rejects.toMatchObject({
            name: 'DistillError',
            code: ErrorCode.ACTION_INTERCEPTED,
        });
    });

    it('skips optional action gracefully on failure', async () => {
        const page = createMockPage({
            click: vi.fn().mockRejectedValue(new Error('Not found')),
        });
        const actions: Action[] = [
            { type: 'click', selector: '.maybe', optional: true },
        ];

        const { trace } = await executeActions(page, actions);

        expect(trace).toHaveLength(1);
        expect(trace[0]).toMatchObject({
            index: 0,
            type: 'click',
            result: 'skipped',
            error: 'Not found',
        });
    });

    it('continues execution after optional failure', async () => {
        const clickFn = vi
            .fn()
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce(undefined);
        const page = createMockPage({ click: clickFn });
        const actions: Action[] = [
            { type: 'click', selector: '.maybe', optional: true },
            { type: 'click', selector: '.exists' },
        ];

        const { trace } = await executeActions(page, actions);

        expect(trace).toHaveLength(2);
        expect(trace[0].result).toBe('skipped');
        expect(trace[1].result).toBe('ok');
    });

    it('throws ACTION_INVALID for unknown action type', async () => {
        const page = createMockPage();
        const actions = [{ type: 'unknown' }] as unknown as Action[];

        await expect(executeActions(page, actions)).rejects.toMatchObject({
            name: 'DistillError',
            code: ErrorCode.ACTION_INVALID,
        });
    });

    it('dispatches role+name targeting via getByRole', async () => {
        const roleClick = vi.fn().mockResolvedValue(undefined);
        const getByRole = vi.fn().mockReturnValue({ click: roleClick });
        const page = createMockPage({ getByRole });

        const actions: Action[] = [
            { type: 'click', role: 'button', name: 'Show more' },
        ];

        const { trace } = await executeActions(page, actions);

        expect(getByRole).toHaveBeenCalledWith('button', {
            name: 'Show more',
        });
        expect(roleClick).toHaveBeenCalled();
        expect(trace[0]).toMatchObject({
            index: 0,
            type: 'click',
            result: 'ok',
        });
    });

    it('treats dismiss as best-effort regardless of optional flag', async () => {
        const page = createMockPage({
            click: vi.fn().mockRejectedValue(new Error('Banner not found')),
        });
        const actions: Action[] = [
            { type: 'dismiss', selector: '.cookie-banner .close' },
        ];

        const { trace } = await executeActions(page, actions);

        expect(trace).toHaveLength(1);
        expect(trace[0]).toMatchObject({
            index: 0,
            type: 'dismiss',
            result: 'skipped',
            error: 'Banner not found',
        });
    });

    it('passes wait with selector to page.waitForSelector with 30s ceiling', async () => {
        const page = createMockPage();
        const actions: Action[] = [{ type: 'wait', selector: 'article h1' }];

        await executeActions(page, actions);

        expect(
            page.waitForSelector as ReturnType<typeof vi.fn>,
        ).toHaveBeenCalledWith('article h1', { timeout: 30_000 });
    });

    it('maps wait for network-idle to Playwright networkidle', async () => {
        const page = createMockPage();
        const actions: Action[] = [{ type: 'wait', for: 'network-idle' }];

        await executeActions(page, actions);

        expect(
            page.waitForLoadState as ReturnType<typeof vi.fn>,
        ).toHaveBeenCalledWith('networkidle', { timeout: 30_000 });
    });
});
