import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { classifyArchetype } from '#/extractor/archetype.ts';
import type { Block } from '#/extractor/blocks.ts';

function makeBlock(overrides: Partial<Block> = {}): Block {
    return {
        id: 'test:0',
        text: '',
        tagPath: ['html', 'body', 'p'],
        headingLevel: null,
        linkDensity: 0,
        wordCount: 10,
        imageRefs: [],
        visibility: 'visible',
        childBlockIds: [],
        ...overrides,
    };
}

function doc(html: string) {
    return parseHTML(
        `<!DOCTYPE html><html><head></head><body>${html}</body></html>`,
    ).document;
}

describe('classifyArchetype', () => {
    it('returns "docs" when URL contains /docs/', () => {
        const result = classifyArchetype(
            doc('<p>Hello</p>'),
            new URL('https://example.com/docs/getting-started'),
            [makeBlock()],
        );
        expect(result).toBe('docs');
    });

    it('returns "docs" when URL contains /api/', () => {
        const result = classifyArchetype(
            doc('<p>Hello</p>'),
            new URL('https://example.com/api/v2/users'),
            [makeBlock()],
        );
        expect(result).toBe('docs');
    });

    it('returns "docs" when URL contains /documentation/', () => {
        const result = classifyArchetype(
            doc('<p>Hello</p>'),
            new URL('https://example.com/documentation/intro'),
            [makeBlock()],
        );
        expect(result).toBe('docs');
    });

    it('returns "docs" when URL contains /reference/', () => {
        const result = classifyArchetype(
            doc('<p>Hello</p>'),
            new URL('https://example.com/reference/types'),
            [makeBlock()],
        );
        expect(result).toBe('docs');
    });

    it('returns "docs" when aside has many links (TOC pattern)', () => {
        const html = `
			<aside>
				<a href="#a">A</a><a href="#b">B</a><a href="#c">C</a>
				<a href="#d">D</a><a href="#e">E</a>
			</aside>
			<p>Content</p>
		`;
        const result = classifyArchetype(
            doc(html),
            new URL('https://example.com/guide'),
            [makeBlock()],
        );
        expect(result).toBe('docs');
    });

    it('returns "docs" when code blocks dominate', () => {
        const codeBlocks = Array.from({ length: 4 }, (_, i) =>
            makeBlock({
                id: `code:${i}`,
                tagPath: ['html', 'body', 'pre', 'code'],
                wordCount: 5,
            }),
        );
        const proseBlock = makeBlock({ id: 'prose:0', wordCount: 20 });
        const result = classifyArchetype(
            doc('<p>Hello</p>'),
            new URL('https://example.com/tutorial'),
            [...codeBlocks, proseBlock],
        );
        expect(result).toBe('docs');
    });

    it('returns "news" when JSON-LD contains NewsArticle', () => {
        const html = `
			<script type="application/ld+json">
				{"@type": "NewsArticle", "headline": "Breaking news"}
			</script>
			<p>Story content</p>
		`;
        const result = classifyArchetype(
            doc(html),
            new URL('https://example.com/story/123'),
            [makeBlock()],
        );
        expect(result).toBe('news');
    });

    it('returns "news" when JSON-LD has NewsArticle in array', () => {
        const html = `
			<script type="application/ld+json">
				[{"@type": "WebPage"}, {"@type": "NewsArticle", "headline": "Breaking"}]
			</script>
		`;
        const result = classifyArchetype(
            doc(html),
            new URL('https://example.com/story/456'),
            [makeBlock()],
        );
        expect(result).toBe('news');
    });

    it('returns "news" for og:type article with recent publish date', () => {
        const recentDate = new Date(
            Date.now() - 2 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const html = `
			<meta property="og:type" content="article">
			<meta property="article:published_time" content="${recentDate}">
			<p>Story</p>
		`;
        const result = classifyArchetype(
            doc(html),
            new URL('https://example.com/article/recent'),
            [makeBlock()],
        );
        expect(result).toBe('news');
    });

    it('returns "article-blog" for og:type article with old publish date', () => {
        const oldDate = new Date('2020-01-01').toISOString();
        const html = `
			<meta property="og:type" content="article">
			<meta property="article:published_time" content="${oldDate}">
			<p>Old post</p>
		`;
        const result = classifyArchetype(
            doc(html),
            new URL('https://example.com/blog/old-post'),
            [makeBlock()],
        );
        expect(result).toBe('article-blog');
    });

    it('returns "article-blog" as default fallback', () => {
        const result = classifyArchetype(
            doc('<p>Just a regular page</p>'),
            new URL('https://example.com/about'),
            [makeBlock()],
        );
        expect(result).toBe('article-blog');
    });

    it('ignores malformed JSON-LD gracefully', () => {
        const html = `
			<script type="application/ld+json">{not valid json</script>
			<p>Content</p>
		`;
        const result = classifyArchetype(
            doc(html),
            new URL('https://example.com/page'),
            [makeBlock()],
        );
        expect(result).toBe('article-blog');
    });
});
