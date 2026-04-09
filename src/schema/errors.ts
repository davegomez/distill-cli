import { z } from 'zod';

// §10.2 — Error code catalog, grouped by exit code
export const ErrorCode = {
    // Exit 1 — extraction
    CONTENT_EMPTY: 'CONTENT_EMPTY',
    SELECTOR_NOT_FOUND: 'SELECTOR_NOT_FOUND',
    EXTRACTION_LOW_QUALITY: 'EXTRACTION_LOW_QUALITY',
    ALL_STRATEGIES_FAILED: 'ALL_STRATEGIES_FAILED',

    // Exit 2 — network/auth
    DNS_FAILURE: 'DNS_FAILURE',
    CONNECTION_REFUSED: 'CONNECTION_REFUSED',
    TIMEOUT: 'TIMEOUT',
    HTTP_4XX: 'HTTP_4XX',
    HTTP_5XX: 'HTTP_5XX',
    BOT_BLOCKED: 'BOT_BLOCKED',
    TLS_ERROR: 'TLS_ERROR',
    TOO_LARGE: 'TOO_LARGE',

    // Exit 3 — validation
    INVALID_URL: 'INVALID_URL',
    INVALID_SCHEME: 'INVALID_SCHEME',
    PRIVATE_NETWORK_BLOCKED: 'PRIVATE_NETWORK_BLOCKED',
    INVALID_PATH: 'INVALID_PATH',
    INVALID_COOKIES_FILE: 'INVALID_COOKIES_FILE',
    INVALID_INPUT_JSON: 'INVALID_INPUT_JSON',
    INVALID_SELECTOR: 'INVALID_SELECTOR',
    INVALID_ACTIONS: 'INVALID_ACTIONS',

    // Exit 4 — action
    ACTION_SELECTOR_NOT_FOUND: 'ACTION_SELECTOR_NOT_FOUND',
    ACTION_TIMEOUT: 'ACTION_TIMEOUT',
    ACTION_INTERCEPTED: 'ACTION_INTERCEPTED',
    ACTION_INVALID: 'ACTION_INVALID',

    // Exit 5 — internal/setup
    BROWSER_NOT_INSTALLED: 'BROWSER_NOT_INSTALLED',
    BROWSER_LAUNCH_FAILED: 'BROWSER_LAUNCH_FAILED',
    CACHE_CORRUPTION: 'CACHE_CORRUPTION',
    UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// §10.1 — Every error code maps to its exit code
export const ERROR_CODE_EXIT_CODES: Record<ErrorCode, number> = {
    // Exit 1 — extraction
    CONTENT_EMPTY: 1,
    SELECTOR_NOT_FOUND: 1,
    EXTRACTION_LOW_QUALITY: 1,
    ALL_STRATEGIES_FAILED: 1,

    // Exit 2 — network/auth
    DNS_FAILURE: 2,
    CONNECTION_REFUSED: 2,
    TIMEOUT: 2,
    HTTP_4XX: 2,
    HTTP_5XX: 2,
    BOT_BLOCKED: 2,
    TLS_ERROR: 2,
    TOO_LARGE: 2,

    // Exit 3 — validation
    INVALID_URL: 3,
    INVALID_SCHEME: 3,
    PRIVATE_NETWORK_BLOCKED: 3,
    INVALID_PATH: 3,
    INVALID_COOKIES_FILE: 3,
    INVALID_INPUT_JSON: 3,
    INVALID_SELECTOR: 3,
    INVALID_ACTIONS: 3,

    // Exit 4 — action
    ACTION_SELECTOR_NOT_FOUND: 4,
    ACTION_TIMEOUT: 4,
    ACTION_INTERCEPTED: 4,
    ACTION_INVALID: 4,

    // Exit 5 — internal/setup
    BROWSER_NOT_INSTALLED: 5,
    BROWSER_LAUNCH_FAILED: 5,
    CACHE_CORRUPTION: 5,
    UNKNOWN: 5,
};

// §4.4 — retryable is true only for strict transient errors
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
    ErrorCode.CONNECTION_REFUSED,
    ErrorCode.TIMEOUT,
    ErrorCode.HTTP_5XX,
]);

// §4.4 — Zod schema for the error shape in JSON output
export const DistillErrorSchema = z.object({
    code: z.enum([
        'CONTENT_EMPTY',
        'SELECTOR_NOT_FOUND',
        'EXTRACTION_LOW_QUALITY',
        'ALL_STRATEGIES_FAILED',
        'DNS_FAILURE',
        'CONNECTION_REFUSED',
        'TIMEOUT',
        'HTTP_4XX',
        'HTTP_5XX',
        'BOT_BLOCKED',
        'TLS_ERROR',
        'TOO_LARGE',
        'INVALID_URL',
        'INVALID_SCHEME',
        'PRIVATE_NETWORK_BLOCKED',
        'INVALID_PATH',
        'INVALID_COOKIES_FILE',
        'INVALID_INPUT_JSON',
        'INVALID_SELECTOR',
        'INVALID_ACTIONS',
        'ACTION_SELECTOR_NOT_FOUND',
        'ACTION_TIMEOUT',
        'ACTION_INTERCEPTED',
        'ACTION_INVALID',
        'BROWSER_NOT_INSTALLED',
        'BROWSER_LAUNCH_FAILED',
        'CACHE_CORRUPTION',
        'UNKNOWN',
    ]),
    message: z.string(),
    hint: z.string().optional(),
    retryable: z.boolean(),
    retry_with: z.array(z.string()),
    received: z.unknown().optional(),
});

export class DistillError extends Error {
    readonly code: ErrorCode;
    readonly hint: string | undefined;
    readonly retryable: boolean;
    readonly retry_with: string[];
    readonly received: unknown;
    readonly exit_code: number;

    constructor(opts: {
        code: ErrorCode;
        message: string;
        hint?: string;
        retryable?: boolean;
        retry_with?: string[];
        received?: unknown;
    }) {
        super(opts.message);
        this.name = 'DistillError';
        this.code = opts.code;
        this.hint = opts.hint;
        this.retryable = opts.retryable ?? RETRYABLE_CODES.has(opts.code);
        this.retry_with = opts.retry_with ?? [];
        this.received = opts.received;
        this.exit_code = ERROR_CODE_EXIT_CODES[opts.code];
    }

    /** Serialize to the §4.4 JSON error shape. */
    toJSON(): z.infer<typeof DistillErrorSchema> {
        return {
            code: this.code,
            message: this.message,
            hint: this.hint,
            retryable: this.retryable,
            retry_with: this.retry_with,
            received: this.received,
        };
    }
}

// --- Helper constructors ---

export function invalidUrl(url: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.INVALID_URL,
        message: `Invalid URL: ${url}`,
        hint: hint ?? 'Provide a fully-qualified http or https URL.',
        received: { url },
    });
}

export function invalidScheme(url: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.INVALID_SCHEME,
        message: `Unsupported URL scheme: ${url}`,
        hint: hint ?? 'Only http and https URLs are supported.',
        received: { url },
    });
}

export function privateNetworkBlocked(
    url: string,
    hint?: string,
): DistillError {
    return new DistillError({
        code: ErrorCode.PRIVATE_NETWORK_BLOCKED,
        message: `Private/internal network address blocked: ${url}`,
        hint:
            hint ??
            'distill does not fetch private or internal network addresses.',
        received: { url },
    });
}

export function botBlocked(status: number, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.BOT_BLOCKED,
        message: `Target responded with ${status} (bot block detected).`,
        hint:
            hint ?? 'Try --render, or provide --cookies, or set --user-agent.',
        retry_with: ['--render', '--cookies', '--user-agent'],
        received: { status },
    });
}

export function timeout(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.TIMEOUT,
        message: 'Request timed out.',
        hint: hint ?? 'Try increasing --timeout or use --render.',
        retry_with: ['--timeout', '--render'],
    });
}

export function http4xx(status: number, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.HTTP_4XX,
        message: `HTTP ${status} response.`,
        hint,
        received: { status },
    });
}

export function http5xx(status: number, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.HTTP_5XX,
        message: `HTTP ${status} server error.`,
        hint: hint ?? 'Server error — retrying may help.',
        retry_with: ['--timeout'],
        received: { status },
    });
}

export function dnsFailure(hostname: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.DNS_FAILURE,
        message: `DNS lookup failed for ${hostname}.`,
        hint: hint ?? 'Check that the hostname is correct.',
        received: { hostname },
    });
}

export function connectionRefused(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.CONNECTION_REFUSED,
        message: 'Connection refused by target.',
        hint: hint ?? 'The server may be down — retrying may help.',
    });
}

export function tlsError(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.TLS_ERROR,
        message: 'TLS handshake failed.',
        hint: hint ?? 'Check the certificate or try a different URL.',
    });
}

export function tooLarge(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.TOO_LARGE,
        message: 'Response body exceeds size limit.',
        hint: hint ?? 'The page is too large to process.',
    });
}

export function contentEmpty(selector: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.CONTENT_EMPTY,
        message: `Selector "${selector}" matched but produced no text.`,
        hint:
            hint ??
            'Try a different --selector or use --render for JS-heavy pages.',
        retry_with: ['--selector', '--render'],
        received: { selector },
    });
}

export function selectorNotFound(
    selector: string,
    hint?: string,
): DistillError {
    return new DistillError({
        code: ErrorCode.SELECTOR_NOT_FOUND,
        message: `Selector "${selector}" did not match any element.`,
        hint:
            hint ??
            'Check the selector or try --render for JS-rendered content.',
        retry_with: ['--selector', '--render'],
        received: { selector },
    });
}

export function allStrategiesFailed(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.ALL_STRATEGIES_FAILED,
        message: 'All extraction strategies produced no content.',
        hint: hint ?? 'Try --render, a specific --selector, or check the URL.',
        retry_with: ['--render', '--selector'],
    });
}

export function extractionLowQuality(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.EXTRACTION_LOW_QUALITY,
        message: 'Extraction fell back to heuristic with low confidence.',
        hint: hint ?? 'Try a specific --selector or --render.',
        retry_with: ['--selector', '--render'],
    });
}

export function invalidInputJson(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.INVALID_INPUT_JSON,
        message: 'The --input JSON is malformed or invalid.',
        hint: hint ?? 'Check the JSON syntax and required fields.',
    });
}

export function invalidSelector(selector: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.INVALID_SELECTOR,
        message: `Invalid CSS selector: "${selector}".`,
        hint: hint ?? 'Provide a valid CSS selector.',
        received: { selector },
    });
}

export function invalidActions(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.INVALID_ACTIONS,
        message: 'The --actions JSON is malformed or invalid.',
        hint: hint ?? 'Check the actions array syntax and required fields.',
    });
}

export function invalidPath(path: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.INVALID_PATH,
        message: `Invalid file path: "${path}".`,
        hint: hint ?? 'Check the path exists and is readable.',
        received: { path },
    });
}

export function invalidCookiesFile(path: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.INVALID_COOKIES_FILE,
        message: `Invalid cookies file: "${path}".`,
        hint: hint ?? 'Provide a valid Netscape-format cookies file.',
        received: { path },
    });
}

export function actionSelectorNotFound(
    selector: string,
    hint?: string,
): DistillError {
    return new DistillError({
        code: ErrorCode.ACTION_SELECTOR_NOT_FOUND,
        message: `Action selector "${selector}" not found.`,
        hint: hint ?? 'Check the selector or mark the action as optional.',
        received: { selector },
    });
}

export function actionTimeout(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.ACTION_TIMEOUT,
        message: 'Browser action timed out.',
        hint:
            hint ??
            'Increase the action wait time or simplify the action chain.',
    });
}

export function actionIntercepted(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.ACTION_INTERCEPTED,
        message: 'Browser action was intercepted.',
        hint:
            hint ??
            'A dialog or overlay may have blocked the action. Use a dismiss action first.',
    });
}

export function actionInvalid(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.ACTION_INVALID,
        message: 'Invalid action definition.',
        hint: hint ?? 'Check the action type and required fields.',
    });
}

export function browserNotInstalled(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.BROWSER_NOT_INSTALLED,
        message: 'Playwright browser is not installed.',
        hint: hint ?? 'Run "distill setup" to install browsers.',
        retry_with: ['distill setup'],
    });
}

export function browserLaunchFailed(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.BROWSER_LAUNCH_FAILED,
        message: 'Failed to launch browser.',
        hint: hint ?? 'Run "distill setup" or check system dependencies.',
    });
}

export function cacheCorruption(hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.CACHE_CORRUPTION,
        message: 'Cache database is corrupted.',
        hint: hint ?? 'Run "distill cache clear" to reset the cache.',
    });
}

export function unknownError(message: string, hint?: string): DistillError {
    return new DistillError({
        code: ErrorCode.UNKNOWN,
        message,
        hint,
    });
}
