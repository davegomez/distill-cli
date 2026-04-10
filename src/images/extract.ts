import type { Block } from '#/extractor/blocks.ts';

export interface ImageMetadata {
    alt: string;
    src: string;
}

/**
 * Extract deduplicated image metadata from blocks, resolving all URLs
 * to absolute form. Filters out data: URIs and preserves traversal order.
 */
export function extractImageMetadata(
    blocks: Block[],
    baseUrl: string,
): ImageMetadata[] {
    const seen = new Set<string>();
    const result: ImageMetadata[] = [];

    for (const block of blocks) {
        for (const ref of block.imageRefs) {
            const resolved = resolveImageUrl(ref.src, baseUrl);
            if (resolved === null) continue;
            if (seen.has(resolved)) continue;
            seen.add(resolved);
            result.push({ alt: ref.alt, src: resolved });
        }
    }

    return result;
}

function resolveImageUrl(src: string, baseUrl: string): string | null {
    if (src.startsWith('data:')) return null;

    // Protocol-relative URLs: resolve to https
    if (src.startsWith('//')) {
        return `https:${src}`;
    }

    try {
        return new URL(src, baseUrl).href;
    } catch {
        return null;
    }
}
