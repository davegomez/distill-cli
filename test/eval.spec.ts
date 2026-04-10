import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    computeWordMetrics,
    detectStructure,
    discoverFixtures,
    evaluateFixture,
    extractFromHtml,
    type FixtureResult,
    tokenize,
} from './eval.ts';

const CORPUS_DIR = path.resolve(import.meta.dirname, 'fixtures/corpus');

// ── Regression guard: run harness against the real corpus ───────

describe('eval corpus regression', () => {
    const fixtures = discoverFixtures(CORPUS_DIR);

    if (fixtures.length === 0) {
        it.skip('no fixtures found — corpus is empty', () => {});
    } else {
        const results: FixtureResult[] = [];

        for (const fixture of fixtures) {
            it(`${fixture.archetype}/${fixture.name}`, () => {
                const result = evaluateFixture(fixture);
                results.push(result);

                if (!result.passed) {
                    const details = result.failures
                        .map(
                            (f) =>
                                `  ${f.check}: expected ${f.expected}, got ${f.actual}`,
                        )
                        .join('\n');
                    expect
                        .soft(result.passed, `Fixture failed:\n${details}`)
                        .toBe(true);
                }
            });
        }
    }
});

// ── Unit tests for word-level metrics (synthetic, not in corpus) ─

describe('computeWordMetrics', () => {
    it('returns perfect scores when extracted text contains all ground-truth words', () => {
        const extracted = 'the quick brown fox jumps over the lazy dog';
        const phrases = ['quick brown fox', 'lazy dog'];
        const m = computeWordMetrics(extracted, phrases);
        expect(m.recall).toBe(1);
        expect(m.precision).toBeGreaterThan(0);
        expect(m.f1).toBeGreaterThan(0);
    });

    it('returns zero recall when no ground-truth words are found', () => {
        const extracted = 'completely unrelated content here';
        const phrases = ['quick brown fox'];
        const m = computeWordMetrics(extracted, phrases);
        expect(m.recall).toBe(0);
        expect(m.f1).toBe(0);
    });

    it('returns perfect scores for empty must_contain', () => {
        const m = computeWordMetrics('some text here', []);
        expect(m).toEqual({ precision: 1, recall: 1, f1: 1 });
    });

    it('returns zero scores for empty extracted text', () => {
        const m = computeWordMetrics('', ['some words']);
        expect(m).toEqual({ precision: 0, recall: 0, f1: 0 });
    });

    it('computes correct f1 for partial overlap', () => {
        // extracted: [hello, world, foo, bar] (4 words)
        // ground: [hello, world, baz] (3 words)
        // tp = 2 (hello, world)
        // precision = 2/4 = 0.5, recall = 2/3 ≈ 0.667
        // f1 = 2 * 0.5 * 0.667 / (0.5 + 0.667) ≈ 0.571
        const m = computeWordMetrics('hello world foo bar', [
            'hello world baz',
        ]);
        expect(m.precision).toBeCloseTo(0.5, 5);
        expect(m.recall).toBeCloseTo(2 / 3, 5);
        expect(m.f1).toBeCloseTo((2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3), 5);
    });
});

// ── Unit tests for tokenize ─────────────────────────────────────

describe('tokenize', () => {
    it('lowercases and splits on whitespace', () => {
        expect(tokenize('Hello World')).toEqual(['hello', 'world']);
    });

    it('handles multiple spaces and newlines', () => {
        expect(tokenize('  foo  \n  bar  ')).toEqual(['foo', 'bar']);
    });

    it('returns empty array for blank input', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize('   ')).toEqual([]);
    });
});

// ── Unit tests for detectStructure ──────────────────────────────

describe('detectStructure', () => {
    it('detects headings', () => {
        const s = detectStructure('# Title\n\nSome text\n\n## Section');
        expect(s.hasHeadings).toBe(true);
    });

    it('detects lists', () => {
        const s = detectStructure('- item one\n- item two\n1. ordered');
        expect(s.hasLists).toBe(true);
    });

    it('detects code blocks', () => {
        const s = detectStructure('text\n```js\nconst x = 1;\n```\n');
        expect(s.hasCodeBlocks).toBe(true);
    });

    it('detects images', () => {
        const s = detectStructure('![alt text](http://img.png)');
        expect(s.hasImages).toBe(true);
    });

    it('returns all false for plain text', () => {
        const s = detectStructure('Just some plain text here.');
        expect(s).toEqual({
            hasHeadings: false,
            hasLists: false,
            hasCodeBlocks: false,
            hasImages: false,
        });
    });
});

// ── Unit tests for extractFromHtml with synthetic HTML ──────────

describe('extractFromHtml (synthetic)', () => {
    it('extracts title and content from simple HTML', () => {
        const html = `<!DOCTYPE html>
<html><head><title>Test Title</title></head>
<body><article><p>Hello world, this is a test paragraph.</p></article></body>
</html>`;
        const result = extractFromHtml(html, 'https://example.com/test');
        expect(result.title).toBe('Test Title');
        expect(result.strategy).toBe('selector');
        expect(result.selector).toBe('article');
        expect(result.markdown).toContain('Hello world');
        expect(result.word_count).toBeGreaterThan(0);
    });

    it('falls back to heuristic when no selector matches', () => {
        const html = `<!DOCTYPE html>
<html><head><title>Heuristic Test</title></head>
<body>
<div>
<p>This is a long enough paragraph to score above the heuristic threshold.</p>
<p>Another paragraph with sufficient text to ensure the heuristic picks this up.</p>
<p>Third paragraph adds more weight to the content scoring algorithm here.</p>
<p>Fourth paragraph to be absolutely sure the threshold is crossed easily.</p>
<p>Fifth paragraph for good measure, pushing the score well above twenty.</p>
</div>
</body></html>`;
        const result = extractFromHtml(html, 'https://example.com/heuristic');
        expect(result.strategy).toBe('heuristic');
        expect(result.selector).toBeNull();
        expect(result.confidence).toBe('low');
    });
});
