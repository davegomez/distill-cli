import type { Block } from '#/extractor/blocks.ts';

type Strategy = 'explicit' | 'selector' | 'heuristic';
type Confidence = 'high' | 'medium' | 'low';

/** Raw observables for the +extraction.metrics field group. */
export interface ExtractionMetrics {
    text_length: number;
    text_html_ratio: number;
    paragraphs: number;
    link_density: number;
}

/** Reserved for future rubric inputs (archetype, HTTP metadata, etc.). */
export interface ConfidenceContext {
    htmlLength?: number;
}

function visibleBlocks(blocks: Block[]): Block[] {
    return blocks.filter((b) => b.visibility === 'visible');
}

/** Weighted-average link density across visible blocks. */
function aggregateLinkDensity(blocks: Block[]): number {
    const visible = visibleBlocks(blocks);
    const totalTextLen = visible.reduce((sum, b) => sum + b.text.length, 0);
    if (totalTextLen === 0) return 0;
    return (
        visible.reduce((sum, b) => sum + b.linkDensity * b.text.length, 0) /
        totalTextLen
    );
}

/**
 * §6.1 — Confidence rubric.
 *
 * - high:   explicit selector, or selector chain + strong quality
 *           (word count > 500, link density < 0.3)
 * - medium: selector chain + moderate quality
 * - low:    heuristic fallback, or marginal quality metrics
 */
export function computeConfidence(
    strategy: Strategy,
    blocks: Block[],
    _context?: ConfidenceContext,
): Confidence {
    if (strategy === 'explicit') return 'high';
    if (strategy === 'heuristic') return 'low';

    // strategy === 'selector'
    const visible = visibleBlocks(blocks);
    const totalWords = visible.reduce((sum, b) => sum + b.wordCount, 0);
    const linkDensity = aggregateLinkDensity(blocks);

    if (totalWords > 500 && linkDensity < 0.3) return 'high';
    return 'medium';
}

/**
 * Compute raw extraction metrics from blocks.
 * `htmlLength` is needed for `text_html_ratio` — pass the byte length
 * of the source HTML that produced the blocks.
 */
export function computeMetrics(
    blocks: Block[],
    htmlLength = 0,
): ExtractionMetrics {
    const visible = visibleBlocks(blocks);
    const text_length = visible.reduce((sum, b) => sum + b.text.length, 0);
    const paragraphs = visible.filter(
        (b) => b.tagPath[b.tagPath.length - 1] === 'p',
    ).length;
    const link_density = aggregateLinkDensity(blocks);
    const text_html_ratio = htmlLength > 0 ? text_length / htmlLength : 0;

    return { text_length, text_html_ratio, paragraphs, link_density };
}
