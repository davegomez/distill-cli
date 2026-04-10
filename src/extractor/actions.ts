import type { Page } from 'playwright';
import {
    actionIntercepted,
    actionInvalid,
    actionSelectorNotFound,
    actionTimeout,
    DistillError,
} from '#/schema/errors.ts';
import type { Action } from '#/schema/input.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActionTraceEntry {
    index: number;
    type: string;
    result: 'ok' | 'failed' | 'skipped';
    error?: string;
    elapsed_ms: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Implicit ceiling for all wait actions (§5.2). */
const WAIT_CEILING_MS = 30_000;

/** Hard cap for wait-with-ms (§5.2). */
const WAIT_MS_CAP = 10_000;

/** Map DSL `for` values to Playwright's waitForLoadState params. */
const LOAD_STATE_MAP: Record<
    string,
    'networkidle' | 'load' | 'domcontentloaded'
> = {
    'network-idle': 'networkidle',
    load: 'load',
    domcontentloaded: 'domcontentloaded',
};

// ---------------------------------------------------------------------------
// Core executor
// ---------------------------------------------------------------------------

/**
 * Execute an ordered list of browser actions against a Playwright page.
 * Returns a trace of each action's result for observability.
 *
 * Fail-fast: any non-optional action failure throws a DistillError.
 * Dismiss actions are always best-effort (§5.2).
 */
export async function executeActions(
    page: Page,
    actions: Action[],
): Promise<{ trace: ActionTraceEntry[] }> {
    const trace: ActionTraceEntry[] = [];

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const start = performance.now();

        try {
            await runAction(page, action);
            trace.push({
                index: i,
                type: action.type,
                result: 'ok',
                elapsed_ms: Math.round(performance.now() - start),
            });
        } catch (err) {
            const elapsed = Math.round(performance.now() - start);
            const message = err instanceof Error ? err.message : String(err);

            // Dismiss is always best-effort; optional actions skip gracefully
            if (action.type === 'dismiss' || action.optional) {
                trace.push({
                    index: i,
                    type: action.type,
                    result: 'skipped',
                    error: message,
                    elapsed_ms: elapsed,
                });
                continue;
            }

            trace.push({
                index: i,
                type: action.type,
                result: 'failed',
                error: message,
                elapsed_ms: elapsed,
            });

            if (err instanceof DistillError) {
                throw err;
            }
            throw classifyActionError(err, i, action);
        }
    }

    return { trace };
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

async function runAction(page: Page, action: Action): Promise<void> {
    switch (action.type) {
        case 'wait':
            return runWait(page, action);
        case 'click':
            return runClick(page, action);
        case 'scroll':
            return runScroll(page, action);
        case 'fill':
            await page.fill(action.selector, action.value);
            return;
        case 'press':
            await page.keyboard.press(action.key);
            return;
        case 'dismiss':
            return runDismiss(page, action);
        default:
            throw actionInvalid(
                `Unknown action type: "${(action as { type: string }).type}"`,
            );
    }
}

async function runWait(
    page: Page,
    action: Extract<Action, { type: 'wait' }>,
): Promise<void> {
    if ('selector' in action) {
        await page.waitForSelector(action.selector, {
            timeout: WAIT_CEILING_MS,
        });
        return;
    }
    if ('for' in action) {
        const state = LOAD_STATE_MAP[action.for];
        await page.waitForLoadState(state, { timeout: WAIT_CEILING_MS });
        return;
    }
    if ('ms' in action) {
        const ms = Math.min(action.ms, WAIT_MS_CAP);
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    }
}

async function runClick(
    page: Page,
    action: Extract<Action, { type: 'click' }>,
): Promise<void> {
    if ('selector' in action) {
        await page.click(action.selector);
        return;
    }
    // Playwright AriaRole is a non-exported string union; schema validates at boundary
    await page
        .getByRole(action.role as Parameters<Page['getByRole']>[0], {
            name: action.name,
        })
        .click();
}

async function runScroll(
    page: Page,
    action: Extract<Action, { type: 'scroll' }>,
): Promise<void> {
    if ('to' in action) {
        if (action.to === 'bottom') {
            // @ts-expect-error — runs in browser context; DOM globals exist at runtime
            await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        } else {
            // @ts-expect-error — runs in browser context; DOM globals exist at runtime
            await page.evaluate(() => scrollTo(0, 0));
        }
        return;
    }
    if ('selector' in action) {
        await page.locator(action.selector).scrollIntoViewIfNeeded();
    }
}

async function runDismiss(
    page: Page,
    action: Extract<Action, { type: 'dismiss' }>,
): Promise<void> {
    if ('selector' in action) {
        await page.click(action.selector);
        return;
    }
    await page
        .getByRole(action.role as Parameters<Page['getByRole']>[0], {
            name: action.name,
        })
        .click();
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function classifyActionError(
    err: unknown,
    index: number,
    action: Action,
): DistillError {
    const message = err instanceof Error ? err.message : String(err);
    const prefix = `Action ${index} (${action.type})`;

    if (/timeout/i.test(message)) {
        return actionTimeout(`${prefix} timed out`);
    }
    if (/intercept/i.test(message)) {
        return actionIntercepted(`${prefix} was intercepted`);
    }

    const selector =
        'selector' in action && action.selector
            ? action.selector
            : `[${action.type}]`;
    return actionSelectorNotFound(selector, `${prefix} failed: ${message}`);
}
