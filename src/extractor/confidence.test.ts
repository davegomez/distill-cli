import { describe, expect, it } from 'vitest';
import type { Block } from '#/extractor/blocks.ts';
import { computeConfidence, computeMetrics } from '#/extractor/confidence.ts';

/** Helper to create a minimal visible Block with overrides. */
function makeBlock(overrides: Partial<Block> = {}): Block {
    return {
        id: 'test:0',
        text: '',
        tagPath: ['html', 'body', 'p'],
        headingLevel: null,
        linkDensity: 0,
        wordCount: 0,
        imageRefs: [],
        visibility: 'visible',
        childBlockIds: [],
        ...overrides,
    };
}

/** Build blocks that collectively hit a target word count and link density. */
function makeContentBlocks(wordCount: number, linkDensity: number): Block[] {
    const text = Array.from({ length: wordCount }, () => 'word').join(' ');
    return [
        makeBlock({
            text,
            wordCount,
            linkDensity,
        }),
    ];
}

describe('computeConfidence', () => {
    it('explicit strategy always returns high', () => {
        expect(computeConfidence('explicit', [])).toBe('high');
        expect(computeConfidence('explicit', [makeBlock()])).toBe('high');
    });

    it('selector strategy with 1000 words and low link density returns high', () => {
        const blocks = makeContentBlocks(1000, 0.05);
        expect(computeConfidence('selector', blocks)).toBe('high');
    });

    it('selector strategy with 300 words returns medium', () => {
        const blocks = makeContentBlocks(300, 0.1);
        expect(computeConfidence('selector', blocks)).toBe('medium');
    });

    it('selector strategy with high link density returns medium even with many words', () => {
        const blocks = makeContentBlocks(1000, 0.5);
        expect(computeConfidence('selector', blocks)).toBe('medium');
    });

    it('heuristic strategy always returns low', () => {
        expect(computeConfidence('heuristic', [])).toBe('low');
        expect(computeConfidence('heuristic', makeContentBlocks(2000, 0))).toBe(
            'low',
        );
    });

    it('ignores hidden blocks for quality assessment', () => {
        const blocks = [
            makeBlock({
                text: Array.from({ length: 600 }, () => 'word').join(' '),
                wordCount: 600,
                linkDensity: 0,
                visibility: 'hidden',
            }),
        ];
        // No visible words → medium (not high)
        expect(computeConfidence('selector', blocks)).toBe('medium');
    });
});

describe('computeMetrics', () => {
    it('returns correct counts for known block arrays', () => {
        const blocks: Block[] = [
            makeBlock({
                text: 'Hello world',
                wordCount: 2,
                linkDensity: 0.2,
                tagPath: ['html', 'body', 'p'],
            }),
            makeBlock({
                id: 'test:1',
                text: 'Another paragraph here',
                wordCount: 3,
                linkDensity: 0.1,
                tagPath: ['html', 'body', 'p'],
            }),
            makeBlock({
                id: 'test:2',
                text: 'A heading',
                wordCount: 2,
                linkDensity: 0,
                tagPath: ['html', 'body', 'h2'],
            }),
        ];

        const metrics = computeMetrics(blocks, 500);

        expect(metrics.text_length).toBe(
            'Hello world'.length +
                'Another paragraph here'.length +
                'A heading'.length,
        );
        expect(metrics.paragraphs).toBe(2);
        expect(metrics.text_html_ratio).toBeCloseTo(metrics.text_length / 500);
        expect(metrics.link_density).toBeGreaterThan(0);
        expect(metrics.link_density).toBeLessThan(0.2);
    });

    it('returns zero ratio when htmlLength is not provided', () => {
        const metrics = computeMetrics([makeBlock({ text: 'test' })]);
        expect(metrics.text_html_ratio).toBe(0);
    });

    it('excludes hidden blocks from metrics', () => {
        const blocks: Block[] = [
            makeBlock({ text: 'visible text', wordCount: 2 }),
            makeBlock({
                id: 'test:1',
                text: 'hidden text',
                wordCount: 2,
                visibility: 'hidden',
            }),
        ];

        const metrics = computeMetrics(blocks);
        expect(metrics.text_length).toBe('visible text'.length);
        expect(metrics.paragraphs).toBe(1);
    });

    it('handles empty block arrays', () => {
        const metrics = computeMetrics([]);
        expect(metrics.text_length).toBe(0);
        expect(metrics.text_html_ratio).toBe(0);
        expect(metrics.paragraphs).toBe(0);
        expect(metrics.link_density).toBe(0);
    });
});
