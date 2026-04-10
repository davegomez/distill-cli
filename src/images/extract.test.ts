import { describe, expect, it } from 'vitest';
import type { Block } from '#/extractor/blocks.ts';
import { extractImageMetadata } from '#/images/extract.ts';

function makeBlock(imageRefs: Array<{ alt: string; src: string }>): Block {
    return {
        id: 'b1',
        text: '',
        tagPath: ['body', 'div'],
        headingLevel: null,
        linkDensity: 0,
        wordCount: 0,
        imageRefs,
        visibility: 'visible',
        childBlockIds: [],
    };
}

describe('extractImageMetadata', () => {
    const base = 'https://example.com/articles/page.html';

    it('resolves relative URLs against base', () => {
        const blocks = [makeBlock([{ alt: 'photo', src: '../img/photo.jpg' }])];
        const result = extractImageMetadata(blocks, base);
        expect(result).toEqual([
            { alt: 'photo', src: 'https://example.com/img/photo.jpg' },
        ]);
    });

    it('resolves protocol-relative URLs to https', () => {
        const blocks = [
            makeBlock([{ alt: 'logo', src: '//cdn.example.com/logo.png' }]),
        ];
        const result = extractImageMetadata(blocks, base);
        expect(result).toEqual([
            { alt: 'logo', src: 'https://cdn.example.com/logo.png' },
        ]);
    });

    it('passes through absolute URLs unchanged', () => {
        const blocks = [
            makeBlock([
                { alt: 'banner', src: 'https://other.com/banner.webp' },
            ]),
        ];
        const result = extractImageMetadata(blocks, base);
        expect(result).toEqual([
            { alt: 'banner', src: 'https://other.com/banner.webp' },
        ]);
    });

    it('filters out data: URIs', () => {
        const blocks = [
            makeBlock([
                {
                    alt: 'pixel',
                    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
                },
                { alt: 'real', src: '/img/real.jpg' },
            ]),
        ];
        const result = extractImageMetadata(blocks, base);
        expect(result).toEqual([
            { alt: 'real', src: 'https://example.com/img/real.jpg' },
        ]);
    });

    it('deduplicates images by resolved URL', () => {
        const blocks = [
            makeBlock([
                { alt: 'first', src: '/img/hero.jpg' },
                { alt: 'second', src: '/img/hero.jpg' },
            ]),
            makeBlock([
                { alt: 'third', src: 'https://example.com/img/hero.jpg' },
            ]),
        ];
        const result = extractImageMetadata(blocks, base);
        expect(result).toEqual([
            { alt: 'first', src: 'https://example.com/img/hero.jpg' },
        ]);
    });

    it('preserves empty alt as empty string', () => {
        const blocks = [makeBlock([{ alt: '', src: '/img/decorative.svg' }])];
        const result = extractImageMetadata(blocks, base);
        expect(result).toEqual([
            { alt: '', src: 'https://example.com/img/decorative.svg' },
        ]);
    });

    it('returns empty array for blocks with no images', () => {
        const blocks = [makeBlock([])];
        const result = extractImageMetadata(blocks, base);
        expect(result).toEqual([]);
    });

    it('preserves order from block traversal', () => {
        const blocks = [
            makeBlock([{ alt: 'a', src: '/1.jpg' }]),
            makeBlock([{ alt: 'b', src: '/2.jpg' }]),
            makeBlock([{ alt: 'c', src: '/3.jpg' }]),
        ];
        const result = extractImageMetadata(blocks, base);
        expect(result.map((i) => i.alt)).toEqual(['a', 'b', 'c']);
    });
});
