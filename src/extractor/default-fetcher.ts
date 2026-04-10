import {
    type CachedFetchOptions,
    cachedFetch,
} from '#/extractor/cached-fetch.ts';
import type {
    FetchRequest,
    FetchResult,
    PageFetcher,
} from '#/extractor/pipeline.ts';
import { renderWithPlaywright } from '#/extractor/render.ts';
import { loadCookiesFile } from '#/security/cookies.ts';

/** Production PageFetcher that delegates to cachedFetch or renderWithPlaywright. */
export const defaultPageFetcher: PageFetcher = {
    async fetch(url: URL, request: FetchRequest): Promise<FetchResult> {
        if (request.render) {
            const cookies = request.cookies
                ? await loadCookiesFile(request.cookies)
                : undefined;

            const renderResult = await renderWithPlaywright(url.href, {
                headers: request.headers,
                cookies: cookies?.map((c) => ({
                    name: c.name,
                    value: c.value,
                    domain: c.domain,
                    path: c.path,
                })),
                userAgent: request.userAgent,
                timeout: request.timeout,
                actions: request.actions,
            });

            return {
                html: renderResult.html,
                finalUrl: renderResult.finalUrl,
                httpStatus: renderResult.status ?? 200,
                fromCache: false,
                actionTrace: renderResult.actionTrace ?? [],
            };
        }

        const fetchOpts: CachedFetchOptions = {
            headers: request.headers,
            userAgent: request.userAgent,
            timeout: request.timeout,
            maxSize: request.maxSize,
            retries: request.retries,
            noCache: request.noCache,
            refresh: request.refresh,
        };

        const fetchResult = await cachedFetch(url.href, fetchOpts);

        return {
            html: fetchResult.body.toString('utf-8'),
            finalUrl: fetchResult.finalUrl,
            httpStatus: fetchResult.status,
            fromCache: fetchResult._meta.from_cache,
            actionTrace: [],
        };
    },
};
