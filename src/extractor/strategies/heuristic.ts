import type { parseHTML } from 'linkedom';
import { type Block, domToBlocks } from '#/extractor/blocks.ts';
import { allStrategiesFailed } from '#/schema/errors.ts';

type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

/**
 * Readability-style heuristic scoring fallback.
 *
 * This is intentionally naive — a basic scoring pass over body's direct
 * children, not a full Readability implementation. It scores candidates
 * by text length, paragraph count, heading count, link density, and
 * text-to-HTML ratio, then picks the highest-scoring subtree.
 *
 * Can be improved later with more sophisticated content detection.
 */

/**
 * Minimal DOM element interface — linkedom implements these but the
 * project does not include lib.dom types.
 */
interface DomElement {
    readonly tagName: string;
    readonly textContent: string | null;
    readonly innerHTML: string;
    readonly outerHTML: string;
    readonly children: ArrayLike<DomElement> & Iterable<DomElement>;
    getElementsByTagName(
        tag: string,
    ): ArrayLike<DomElement> & Iterable<DomElement>;
}

interface DomBody extends DomElement {
    readonly children: ArrayLike<DomElement> & Iterable<DomElement>;
}

export interface HeuristicResult {
    strategy: 'heuristic';
    selector: null;
    blocks: Block[];
}

/** Minimum score a candidate must reach to be considered content. */
const MIN_SCORE_THRESHOLD = 20;

interface CandidateScore {
    element: DomElement;
    score: number;
}

/** Count elements matching a tag name inside a subtree. */
function countTag(el: DomElement, tag: string): number {
    return el.getElementsByTagName(tag).length;
}

/** Count all paragraph elements (p tags) inside a subtree. */
function countParagraphs(el: DomElement): number {
    return countTag(el, 'p');
}

/** Count all heading elements (h1–h6) inside a subtree. */
function countHeadings(el: DomElement): number {
    let total = 0;
    for (let i = 1; i <= 6; i++) {
        total += countTag(el, `h${i}`);
    }
    return total;
}

/** Compute the ratio of link text to total text in a subtree. */
function computeLinkDensity(el: DomElement): number {
    const totalText = (el.textContent ?? '').length;
    if (totalText === 0) return 1;

    let linkText = 0;
    const anchors = el.getElementsByTagName('a');
    for (let i = 0; i < anchors.length; i++) {
        linkText += (anchors[i].textContent ?? '').length;
    }
    return linkText / totalText;
}

/** Compute the ratio of text length to outer HTML length. */
function computeTextToHtmlRatio(el: DomElement): number {
    const textLen = (el.textContent ?? '').trim().length;
    const htmlLen = el.outerHTML.length;
    if (htmlLen === 0) return 0;
    return textLen / htmlLen;
}

/**
 * Score a candidate element for content-likeness.
 *
 * Weights are intentionally simple — this is a basic heuristic
 * that can be tuned with real-world data later.
 */
function scoreCandidate(el: DomElement): number {
    const textLen = (el.textContent ?? '').trim().length;
    const paragraphs = countParagraphs(el);
    const headings = countHeadings(el);
    const linkDensity = computeLinkDensity(el);
    const textToHtml = computeTextToHtmlRatio(el);

    let score = 0;

    // Text length: longer content is more likely to be the main content
    score += textLen * 0.01;

    // Paragraph count: articles have many paragraphs
    score += paragraphs * 5;

    // Heading count: content sections tend to have headings
    score += headings * 3;

    // Link density: boilerplate (nav, footers) is link-heavy — penalize
    score -= linkDensity * 50;

    // Text-to-HTML ratio: content has more text relative to markup
    score += textToHtml * 20;

    return score;
}

/**
 * Heuristic content extraction fallback.
 *
 * Scores each direct child of `<body>` and picks the highest-scoring
 * subtree. Throws ALL_STRATEGIES_FAILED if no candidate scores above
 * the minimum threshold.
 */
export function extractWithHeuristic(
    document: LinkedomDocument,
): HeuristicResult {
    const body = document.body as unknown as DomBody | null;
    if (!body) {
        throw allStrategiesFailed(
            'Page has no <body> element — likely not an HTML document.',
        );
    }

    const candidates: CandidateScore[] = [];

    for (const child of body.children) {
        const score = scoreCandidate(child);
        candidates.push({ element: child, score });
    }

    if (candidates.length === 0) {
        throw allStrategiesFailed(
            'Page body has no child elements — mostly boilerplate or empty.',
        );
    }

    // Pick the highest-scoring candidate
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (best.score < MIN_SCORE_THRESHOLD) {
        throw allStrategiesFailed(
            'No content-bearing subtree found — page appears to be mostly boilerplate.',
        );
    }

    // Wrap in a full document so domToBlocks can see all child elements —
    // bare fragments lose siblings after the first element in linkedom.
    const blocks = domToBlocks(
        `<html><body>${best.element.innerHTML}</body></html>`,
    );

    return {
        strategy: 'heuristic',
        selector: null,
        blocks,
    };
}
