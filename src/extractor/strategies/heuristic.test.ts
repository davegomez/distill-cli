import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractWithHeuristic } from '#/extractor/strategies/heuristic.ts';
import { DistillError } from '#/schema/errors.ts';

/** Wrap body content in a full HTML document. */
function doc(bodyInner: string) {
    return parseHTML(`<html><body>${bodyInner}</body></html>`).document;
}

describe('extractWithHeuristic', () => {
    it('selects the content-dense div over nav-heavy divs', () => {
        const d = doc(`
			<div>
				<a href="/a">Link A</a>
				<a href="/b">Link B</a>
				<a href="/c">Link C</a>
				<a href="/d">Link D</a>
				<a href="/e">Link E</a>
			</div>
			<div>
				<h2>Article Title</h2>
				<p>This is a long paragraph with meaningful content that should score highly in the heuristic because it has real text and not just navigation links.</p>
				<p>Another paragraph with even more content to ensure the text length score pushes this candidate above the threshold and above the link-heavy sibling.</p>
				<p>A third paragraph to solidify the content density of this particular candidate subtree element.</p>
			</div>
			<div>
				<a href="/x">Nav X</a>
				<a href="/y">Nav Y</a>
				<a href="/z">Nav Z</a>
			</div>
		`);

        const result = extractWithHeuristic(d);
        expect(result.strategy).toBe('heuristic');
        expect(result.selector).toBeNull();
        expect(result.blocks.length).toBeGreaterThan(0);
        // The content div should be selected — verify its text is present
        expect(
            result.blocks.some((b) => b.text.includes('Article Title')),
        ).toBe(true);
        expect(
            result.blocks.some((b) =>
                b.text.includes('long paragraph with meaningful content'),
            ),
        ).toBe(true);
    });

    it('throws ALL_STRATEGIES_FAILED when no content-bearing elements exist', () => {
        const d = doc(`
			<div>
				<a href="/a">A</a><a href="/b">B</a>
			</div>
		`);

        expect(() => extractWithHeuristic(d)).toThrow(DistillError);
        try {
            extractWithHeuristic(d);
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('ALL_STRATEGIES_FAILED');
            expect((err as DistillError).hint).toContain('boilerplate');
        }
    });

    it('penalizes link-heavy candidates via link density', () => {
        const d = doc(`
			<div>
				<a href="/1">Link one text here</a>
				<a href="/2">Link two text here</a>
				<a href="/3">Link three text here</a>
				<a href="/4">Link four text here</a>
				<a href="/5">Link five text here</a>
				<a href="/6">Link six text here</a>
				<a href="/7">Link seven text here</a>
				<a href="/8">Link eight text here</a>
			</div>
			<div>
				<p>Plain text content without any links inside this paragraph element that should score much better.</p>
				<p>More plain text content here to boost the score of this content candidate significantly.</p>
				<p>A third paragraph adding more content weight to this candidate over the link-heavy one above.</p>
			</div>
		`);

        const result = extractWithHeuristic(d);
        // The plain-text div should win despite the link div having text
        expect(
            result.blocks.some((b) =>
                b.text.includes('Plain text content without any links'),
            ),
        ).toBe(true);
    });

    it('boosts score for candidates with headings', () => {
        const d = doc(`
			<div>
				<p>Some text content that is reasonably long but has no headings at all inside this candidate element.</p>
				<p>More text content without headings to give this a decent baseline text score.</p>
			</div>
			<div>
				<h1>Main Heading</h1>
				<h2>Sub Heading</h2>
				<p>Some text content that is reasonably long and accompanied by headings which boost the score.</p>
				<p>More text content with headings to test the heading boost factor in scoring.</p>
			</div>
		`);

        const result = extractWithHeuristic(d);
        // The div with headings should win
        expect(result.blocks.some((b) => b.text.includes('Main Heading'))).toBe(
            true,
        );
        expect(result.blocks.some((b) => b.text.includes('Sub Heading'))).toBe(
            true,
        );
    });

    it('throws ALL_STRATEGIES_FAILED when body has no children', () => {
        const d = doc('');

        expect(() => extractWithHeuristic(d)).toThrow(DistillError);
        try {
            extractWithHeuristic(d);
        } catch (err) {
            expect((err as DistillError).code).toBe('ALL_STRATEGIES_FAILED');
        }
    });

    it('returns blocks with correct structure', () => {
        const d = doc(`
			<div>
				<h1>Title</h1>
				<p>First paragraph with enough text to pass the scoring threshold easily in this test case.</p>
				<p>Second paragraph providing additional content density for the heuristic scorer.</p>
				<p>Third paragraph ensuring we comfortably exceed the minimum score threshold value.</p>
			</div>
		`);

        const result = extractWithHeuristic(d);
        expect(result.strategy).toBe('heuristic');
        expect(result.selector).toBeNull();
        expect(Array.isArray(result.blocks)).toBe(true);
        for (const block of result.blocks) {
            expect(block).toHaveProperty('id');
            expect(block).toHaveProperty('text');
            expect(block).toHaveProperty('tagPath');
            expect(block).toHaveProperty('wordCount');
        }
    });
});
