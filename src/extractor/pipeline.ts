import type { ActionTraceEntry } from '#/extractor/actions.ts';
import type { Action } from '#/schema/input.ts';

// ---------------------------------------------------------------------------
// Port interfaces — the I/O seam for the extraction pipeline
// ---------------------------------------------------------------------------

/** Fetch-relevant options extracted from ExtractInput. */
export interface FetchRequest {
    render: boolean;
    headers?: Record<string, string>;
    cookies?: string;
    userAgent?: string;
    timeout: number;
    maxSize: number;
    retries: number;
    noCache: boolean;
    refresh: boolean;
    actions?: Action[];
}

/** Unified result from either the HTTP fetch or Playwright render path. */
export interface FetchResult {
    html: string;
    finalUrl: string;
    httpStatus: number;
    fromCache: boolean;
    actionTrace: ActionTraceEntry[];
}

/** The single I/O boundary for the extraction pipeline. */
export interface PageFetcher {
    fetch(url: URL, request: FetchRequest): Promise<FetchResult>;
}

/** Optional dependencies injected into the extraction pipeline. */
export interface ExtractOptions {
    fetcher?: PageFetcher;
}
