import type { parseHTML } from 'linkedom';
import type { Block } from '#/extractor/blocks.ts';

type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

export type Archetype = 'article-blog' | 'docs' | 'news';

/**
 * Best-effort page archetype classifier.
 * Informative only — does not change extraction behavior in v0.1.0.
 */
export function classifyArchetype(
    document: LinkedomDocument,
    url: URL,
    blocks: Block[],
): Archetype {
    if (isDocs(url, document, blocks)) return 'docs';
    if (isNews(document)) return 'news';
    return 'article-blog';
}

const DOCS_PATH_SEGMENTS = [
    '/docs/',
    '/documentation/',
    '/api/',
    '/reference/',
];

function isDocs(
    url: URL,
    document: LinkedomDocument,
    blocks: Block[],
): boolean {
    const path = url.pathname.toLowerCase();
    if (DOCS_PATH_SEGMENTS.some((seg) => path.includes(seg))) return true;

    // Aside element containing links (table of contents pattern)
    const asides = document.querySelectorAll('aside');
    for (const aside of asides) {
        const links = aside.querySelectorAll('a');
        if (links.length >= 5) return true;
    }

    // High ratio of code blocks to total blocks
    const codeBlocks = blocks.filter((b) =>
        b.tagPath.some((tag) => tag === 'pre' || tag === 'code'),
    );
    const totalWords = blocks.reduce((sum, b) => sum + b.wordCount, 0);
    if (
        codeBlocks.length >= 3 &&
        totalWords > 0 &&
        codeBlocks.length / blocks.length > 0.3
    ) {
        return true;
    }

    return false;
}

function isNews(document: LinkedomDocument): boolean {
    // Check for schema.org NewsArticle in JSON-LD
    const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
    );
    for (const script of scripts) {
        const text = script.textContent ?? '';
        try {
            const data = JSON.parse(text);
            if (hasNewsArticleType(data)) return true;
        } catch {
            // Malformed JSON-LD — skip
        }
    }

    // og:type "article" + recent publish date
    const ogType = document
        .querySelector('meta[property="og:type"]')
        ?.getAttribute('content');
    if (ogType === 'article') {
        const dateStr =
            document
                .querySelector('meta[property="article:published_time"]')
                ?.getAttribute('content') ??
            document.querySelector('time[datetime]')?.getAttribute('datetime');
        if (dateStr) {
            const published = new Date(dateStr);
            if (!Number.isNaN(published.getTime())) {
                const daysSince =
                    (Date.now() - published.getTime()) / (1000 * 60 * 60 * 24);
                if (daysSince <= 7) return true;
            }
        }
    }

    return false;
}

function hasNewsArticleType(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;
    if (Array.isArray(data)) return data.some(hasNewsArticleType);
    const obj = data as Record<string, unknown>;
    const type = obj['@type'];
    if (type === 'NewsArticle') return true;
    if (Array.isArray(type) && type.includes('NewsArticle')) return true;
    return false;
}
