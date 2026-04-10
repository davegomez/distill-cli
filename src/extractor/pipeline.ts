import type { parseHTML } from 'linkedom';
import type { ActionTraceEntry } from '#/extractor/actions.ts';
import type { Block } from '#/extractor/blocks.ts';
import type { Action } from '#/schema/input.ts';

export type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

// ---------------------------------------------------------------------------
// Shared pipeline types
// ---------------------------------------------------------------------------

/** Extraction strategy used to identify content. */
export type Strategy = 'explicit' | 'selector' | 'heuristic';

/** Result of the strategy selection phase. */
export interface ExtractionResult {
    strategy: Strategy;
    selector: string | null;
    blocks: Block[];
    tried: string[];
}

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

/** Strategy selection function: explicit → selector-chain → heuristic. */
export type SelectStrategy = (
    document: LinkedomDocument,
    selector?: string,
) => ExtractionResult;

/** Optional dependencies injected into the extraction pipeline. */
export interface ExtractOptions {
    fetcher?: PageFetcher;
    selectStrategy?: SelectStrategy;
}
