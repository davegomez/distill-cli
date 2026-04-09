import { chromium } from 'playwright';
import { type ActionTraceEntry, executeActions } from '#/extractor/actions.ts';
import { browserLaunchFailed, browserNotInstalled } from '#/schema/errors.ts';
import type { Action } from '#/schema/input.ts';

/** Realistic Chrome UA — used unless caller overrides via opts.userAgent. */
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Common missing system libs that cause Chromium launch failures on Linux. */
const KNOWN_MISSING_LIBS = [
    'libnss3',
    'libnssutil3',
    'libnspr4',
    'libatk-bridge-2.0',
    'libatk-1.0',
    'libcups',
    'libdrm',
    'libdbus-1',
    'libxkbcommon',
    'libatspi',
    'libXcomposite',
    'libXdamage',
    'libXrandr',
    'libgbm',
    'libpango-1.0',
    'libcairo',
    'libasound',
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderOptions {
    /** Custom headers to set on the browser context. */
    headers?: Record<string, string>;
    /** Cookie string in "name=value; name2=value2" format for context cookies. */
    cookies?: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
    }>;
    /** Override User-Agent string. */
    userAgent?: string;
    /** Navigation timeout in ms (default 30 000). */
    timeout?: number;
    /** Browser actions to execute after page load and before content extraction. */
    actions?: Action[];
}

export interface RenderResult {
    finalUrl: string;
    html: string;
    /** Trace of executed actions (present only when actions were provided). */
    actionTrace?: ActionTraceEntry[];
}

// ---------------------------------------------------------------------------
// Core render
// ---------------------------------------------------------------------------

/**
 * Launch Playwright Chromium, navigate to `url`, wait for network idle,
 * and return the fully-rendered DOM as HTML.
 */
export async function renderWithPlaywright(
    url: string,
    opts: RenderOptions = {},
): Promise<RenderResult> {
    const {
        headers,
        cookies,
        userAgent = DEFAULT_USER_AGENT,
        timeout = 30_000,
        actions,
    } = opts;

    const launchArgs: string[] = [];

    // On root + Linux, Chromium requires --no-sandbox
    if (process.platform === 'linux' && process.getuid?.() === 0) {
        launchArgs.push('--no-sandbox');
    }

    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

    try {
        browser = await chromium.launch({ args: launchArgs });
    } catch (err) {
        throw classifyLaunchError(err);
    }

    try {
        const context = await browser.newContext({
            userAgent,
            extraHTTPHeaders: headers,
        });

        if (cookies && cookies.length > 0) {
            await context.addCookies(cookies);
        }

        const page = await context.newPage();
        const response = await page.goto(url, {
            waitUntil: 'networkidle',
            timeout,
        });

        // Execute actions after page load, before content extraction (§5)
        let actionTrace: ActionTraceEntry[] | undefined;
        if (actions && actions.length > 0) {
            const result = await executeActions(page, actions);
            actionTrace = result.trace;
        }

        const finalUrl = response?.url() ?? page.url();
        const html = await page.content();

        await context.close();

        return { finalUrl, html, actionTrace };
    } finally {
        await browser.close();
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a Playwright browser launch error into the appropriate
 * DistillError (BROWSER_NOT_INSTALLED or BROWSER_LAUNCH_FAILED).
 */
function classifyLaunchError(
    err: unknown,
): ReturnType<typeof browserNotInstalled> {
    const message = err instanceof Error ? err.message : String(err);

    // Playwright throws this when the chromium binary hasn't been downloaded
    if (/executable doesn't exist/i.test(message)) {
        return browserNotInstalled('Run: distill setup (\u2248450MB download)');
    }

    // Missing system libraries — extract names for a helpful hint
    const missingLibs = KNOWN_MISSING_LIBS.filter((lib) =>
        message.includes(lib),
    );

    if (missingLibs.length > 0) {
        return browserLaunchFailed(
            `Missing system libraries: ${missingLibs.join(', ')}. Install them with your package manager (e.g. apt install ${missingLibs.map((l) => `${l}-dev`).join(' ')}).`,
        );
    }

    return browserLaunchFailed(
        message ||
            'Unknown browser launch error. Run "distill doctor" for diagnostics.',
    );
}
