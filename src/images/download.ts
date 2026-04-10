import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FetchRawOptions, FetchRawResult } from '#/extractor/fetch.ts';
import { generateFilename } from '#/images/filename.ts';

export interface DownloadImagesOptions {
    dir: string;
    maxSize: number;
    concurrency: number;
    fetchFn: (url: string, opts?: FetchRawOptions) => Promise<FetchRawResult>;
    format: 'markdown' | 'wikilinks';
}

export interface DownloadResult {
    src: string;
    local_path: string;
    filename: string;
    bytes: number;
}

export interface DownloadImagesResult {
    downloads: DownloadResult[];
    warnings: string[];
    pathMap: Map<string, string>;
}

/**
 * Download images concurrently with content-addressed filenames.
 * Failed downloads produce warnings rather than throwing.
 */
export async function downloadImages(
    images: Array<{ src: string }>,
    opts: DownloadImagesOptions,
): Promise<DownloadImagesResult> {
    const { dir, concurrency } = opts;
    await mkdir(dir, { recursive: true });

    const downloads: DownloadResult[] = [];
    const warnings: string[] = [];
    const pathMap = new Map<string, string>();

    const executing = new Set<Promise<void>>();

    for (const image of images) {
        const task = processImage(
            image.src,
            opts,
            downloads,
            warnings,
            pathMap,
        ).then(() => {
            executing.delete(task);
        });
        executing.add(task);

        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }

    await Promise.all(executing);
    return { downloads, warnings, pathMap };
}

async function processImage(
    src: string,
    opts: DownloadImagesOptions,
    downloads: DownloadResult[],
    warnings: string[],
    pathMap: Map<string, string>,
): Promise<void> {
    try {
        const result = await opts.fetchFn(src);

        if (result.body.length > opts.maxSize) {
            warnings.push(
                `Skipped ${src}: ${result.body.length} bytes` +
                    ` exceeds ${opts.maxSize} byte limit`,
            );
            return;
        }

        const filename = await generateFilename(result.body, src);
        if (!filename) {
            warnings.push(`Skipped ${src}: unable to determine file extension`);
            return;
        }

        const localPath = join(opts.dir, filename);

        if (!existsSync(localPath)) {
            await writeFile(localPath, result.body);
        }

        pathMap.set(src, opts.format === 'wikilinks' ? filename : localPath);
        downloads.push({
            src,
            local_path: localPath,
            filename,
            bytes: result.body.length,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to download ${src}: ${msg}`);
    }
}
