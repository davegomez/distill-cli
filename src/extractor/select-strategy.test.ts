import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { selectStrategy } from '#/extractor/extract.ts';
import { DistillError } from '#/schema/errors.ts';

type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

function doc(html: string): LinkedomDocument {
    return parseHTML(html).document;
}

// ---------------------------------------------------------------------------
// Explicit strategy
// ---------------------------------------------------------------------------

describe('selectStrategy — explicit', () => {
    it('returns explicit strategy when selector matches', () => {
        const result = selectStrategy(
            doc(
                '<html><body><div class="x"><p>Hello world content.</p></div></body></html>',
            ),
            '.x',
        );
        expect(result.strategy).toBe('explicit');
        expect(result.selector).toBe('.x');
        expect(result.tried).toEqual(['.x']);
        expect(result.blocks.length).toBeGreaterThan(0);
    });

    it('throws SELECTOR_NOT_FOUND when selector misses', () => {
        expect(() =>
            selectStrategy(
                doc('<html><body><p>Hi</p></body></html>'),
                '.missing',
            ),
        ).toThrow(DistillError);

        try {
            selectStrategy(
                doc('<html><body><p>Hi</p></body></html>'),
                '.missing',
            );
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('SELECTOR_NOT_FOUND');
        }
    });

    it('throws CONTENT_EMPTY when selector matches but has no visible text', () => {
        const html =
            '<html><body><div id="empty">   \t\n   </div></body></html>';
        try {
            selectStrategy(doc(html), '#empty');
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('CONTENT_EMPTY');
        }
    });
});

// ---------------------------------------------------------------------------
// Selector chain with tried tracking
// ---------------------------------------------------------------------------

describe('selectStrategy — selector chain', () => {
    it('matches <main> and records tried: ["main"]', () => {
        const result = selectStrategy(
            doc(
                '<html><body><main><p>Content here for testing.</p></main></body></html>',
            ),
        );
        expect(result.strategy).toBe('selector');
        expect(result.selector).toBe('main');
        expect(result.tried).toEqual(['main']);
    });

    it('matches <article> when no <main>, records tried: ["main", "article"]', () => {
        const result = selectStrategy(
            doc(
                '<html><body><article><p>Content here for testing.</p></article></body></html>',
            ),
        );
        expect(result.strategy).toBe('selector');
        expect(result.selector).toBe('article');
        expect(result.tried).toEqual(['main', 'article']);
    });

    it('matches [role="main"] when main and article absent', () => {
        const result = selectStrategy(
            doc(
                '<html><body><div role="main"><p>Content here for testing.</p></div></body></html>',
            ),
        );
        expect(result.strategy).toBe('selector');
        expect(result.selector).toBe('[role="main"]');
        expect(result.tried).toEqual(['main', 'article', '[role="main"]']);
    });

    it('matches #content further down the chain', () => {
        const result = selectStrategy(
            doc(
                '<html><body><div id="content"><p>Content here for testing.</p></div></body></html>',
            ),
        );
        expect(result.strategy).toBe('selector');
        expect(result.selector).toBe('#content');
        expect(result.tried).toEqual([
            'main',
            'article',
            '[role="main"]',
            '#content',
        ]);
    });
});

// ---------------------------------------------------------------------------
// Heuristic fallback
// ---------------------------------------------------------------------------

describe('selectStrategy — heuristic fallback', () => {
    it('falls back to heuristic and records all chain selectors as tried', () => {
        const html = `<html><body>
            <div>
                <h2>Title</h2>
                <p>Paragraph one with enough words to score above the heuristic threshold for detection.</p>
                <p>Paragraph two adds bulk to push the score over the minimum threshold value.</p>
                <p>Paragraph three continues to pile on more text content for the scoring function.</p>
                <p>Paragraph four is needed because the minimum score threshold requires substantial content.</p>
                <p>Paragraph five rounds things out so the heuristic reliably picks this candidate.</p>
            </div>
        </body></html>`;

        const result = selectStrategy(doc(html));
        expect(result.strategy).toBe('heuristic');
        expect(result.selector).toBeNull();
        expect(result.tried).toEqual([
            'main',
            'article',
            '[role="main"]',
            '#content',
            '.post-content',
            '.entry-content',
        ]);
    });

    it('throws ALL_STRATEGIES_FAILED when heuristic also fails, with full tried list', () => {
        const html = '<html><body><div>hi</div></body></html>';
        try {
            selectStrategy(doc(html));
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DistillError);
            expect((err as DistillError).code).toBe('ALL_STRATEGIES_FAILED');
        }
    });
});
