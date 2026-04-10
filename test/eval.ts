import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseHTML } from 'linkedom';
import { classifyArchetype } from '#/extractor/archetype.ts';
import { computeConfidence } from '#/extractor/confidence.ts';
import { renderMarkdown } from '#/extractor/markdown.ts';
import { extractWithHeuristic } from '#/extractor/strategies/heuristic.ts';
import { extractWithSelectorChain } from '#/extractor/strategies/selector-chain.ts';
import { stripChrome } from '#/extractor/strip-chrome.ts';

// ── Fixture schema ──────────────────────────────────────────────

export interface FixtureExpected {
    title: string;
    strategy: 'explicit' | 'selector' | 'heuristic';
    selector: string | null;
    confidence: 'high' | 'medium' | 'low';
    word_count_range: [number, number];
    must_contain: string[];
    must_not_contain: string[];
}

export interface FixtureFile {
    fixture_version: string;
    source_url: string;
    archetype: 'article-blog' | 'docs' | 'news';
    expected: FixtureExpected;
    notes: string;
}

// ── Extraction result (offline) ─────────────────────────────────

export interface OfflineExtractResult {
    title: string;
    markdown: string;
    word_count: number;
    strategy: 'explicit' | 'selector' | 'heuristic';
    selector: string | null;
    confidence: 'high' | 'medium' | 'low';
    archetype: 'article-blog' | 'docs' | 'news';
}

/**
 * Run the extract pipeline on raw HTML without network access.
 * Mirrors the logic in src/commands/extract.ts steps 3–8.
 */
export function extractFromHtml(
    html: string,
    sourceUrl: string,
): OfflineExtractResult {
    const { document } = parseHTML(html);

    // Strip chrome (mutates document)
    stripChrome(document);

    // Strategy selection: selector chain then heuristic
    const chainResult = extractWithSelectorChain(document);
    const extraction = chainResult ?? extractWithHeuristic(document);

    // Classify archetype
    const url = new URL(sourceUrl);
    const archetype = classifyArchetype(document, url, extraction.blocks);

    // Confidence
    const confidence = computeConfidence(
        extraction.strategy,
        extraction.blocks,
    );

    // Render markdown
    const markdown = renderMarkdown(extraction.blocks);

    // Word count
    const word_count = extraction.blocks
        .filter((b) => b.visibility === 'visible')
        .reduce((sum, b) => sum + b.wordCount, 0);

    // Title
    const title = document.querySelector('title')?.textContent?.trim() ?? '';

    return {
        title,
        markdown,
        word_count,
        strategy: extraction.strategy,
        selector: extraction.selector,
        confidence,
        archetype,
    };
}

// ── Fixture discovery ───────────────────────────────────────────

export interface Fixture {
    name: string;
    archetype: string;
    htmlPath: string;
    expectedPath: string;
    expected: FixtureFile;
}

export function discoverFixtures(corpusDir: string): Fixture[] {
    const fixtures: Fixture[] = [];

    if (!fs.existsSync(corpusDir)) return fixtures;

    const archetypeDirs = fs
        .readdirSync(corpusDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    for (const archetype of archetypeDirs) {
        const archetypeDir = path.join(corpusDir, archetype);
        const files = fs.readdirSync(archetypeDir);
        const htmlFiles = files.filter((f) => f.endsWith('.html'));

        for (const htmlFile of htmlFiles) {
            const baseName = htmlFile.replace(/\.html$/, '');
            const expectedFile = `${baseName}.expected.json`;
            if (!files.includes(expectedFile)) continue;

            const htmlPath = path.join(archetypeDir, htmlFile);
            const expectedPath = path.join(archetypeDir, expectedFile);
            const expected = JSON.parse(
                fs.readFileSync(expectedPath, 'utf-8'),
            ) as FixtureFile;

            fixtures.push({
                name: baseName,
                archetype,
                htmlPath,
                expectedPath,
                expected,
            });
        }
    }

    return fixtures;
}

// ── Check results ───────────────────────────────────────────────

export interface CheckFailure {
    check: string;
    expected: string;
    actual: string;
}

export interface FixtureResult {
    name: string;
    archetype: string;
    passed: boolean;
    failures: CheckFailure[];
    metrics: WordMetrics;
    structuralChecks: StructuralChecks;
}

export interface WordMetrics {
    precision: number;
    recall: number;
    f1: number;
}

export interface StructuralChecks {
    hasHeadings: boolean;
    hasLists: boolean;
    hasCodeBlocks: boolean;
    hasImages: boolean;
}

/**
 * Tokenize text into a bag of words (lowercased, whitespace-split).
 */
export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0);
}

/**
 * Compute word-level precision, recall, and F1 between extracted
 * content and must_contain phrases used as rough ground truth.
 */
export function computeWordMetrics(
    extractedText: string,
    mustContainPhrases: string[],
): WordMetrics {
    if (mustContainPhrases.length === 0) {
        return { precision: 1, recall: 1, f1: 1 };
    }

    const groundTruth = tokenize(mustContainPhrases.join(' '));
    const extracted = tokenize(extractedText);

    if (groundTruth.length === 0) return { precision: 1, recall: 1, f1: 1 };
    if (extracted.length === 0) return { precision: 0, recall: 0, f1: 0 };

    const groundBag = new Map<string, number>();
    for (const w of groundTruth) {
        groundBag.set(w, (groundBag.get(w) ?? 0) + 1);
    }

    const extractedBag = new Map<string, number>();
    for (const w of extracted) {
        extractedBag.set(w, (extractedBag.get(w) ?? 0) + 1);
    }

    // True positives: min of each word count in both bags
    let tp = 0;
    for (const [word, groundCount] of groundBag) {
        const extractedCount = extractedBag.get(word) ?? 0;
        tp += Math.min(groundCount, extractedCount);
    }

    const precision = tp / extracted.length;
    const recall = tp / groundTruth.length;
    const f1 =
        precision + recall > 0
            ? (2 * precision * recall) / (precision + recall)
            : 0;

    return { precision, recall, f1 };
}

/**
 * Detect structural elements in the extracted markdown.
 */
export function detectStructure(markdown: string): StructuralChecks {
    const lines = markdown.split('\n');
    return {
        hasHeadings: lines.some((l) => /^#{1,6}\s/.test(l)),
        hasLists: lines.some((l) => /^[-*]\s|^\d+\.\s/.test(l.trimStart())),
        hasCodeBlocks: markdown.includes('```'),
        hasImages: /!\[/.test(markdown),
    };
}

/**
 * Run all checks for a single fixture and return the result.
 */
export function evaluateFixture(fixture: Fixture): FixtureResult {
    const html = fs.readFileSync(fixture.htmlPath, 'utf-8');
    const result = extractFromHtml(html, fixture.expected.source_url);
    const exp = fixture.expected.expected;
    const failures: CheckFailure[] = [];

    // Exact checks
    if (result.title !== exp.title) {
        failures.push({
            check: 'title',
            expected: exp.title,
            actual: result.title,
        });
    }

    if (result.strategy !== exp.strategy) {
        failures.push({
            check: 'strategy',
            expected: exp.strategy,
            actual: result.strategy,
        });
    }

    if (result.selector !== exp.selector) {
        failures.push({
            check: 'selector',
            expected: String(exp.selector),
            actual: String(result.selector),
        });
    }

    if (result.confidence !== exp.confidence) {
        failures.push({
            check: 'confidence',
            expected: exp.confidence,
            actual: result.confidence,
        });
    }

    // Word count range
    const [min, max] = exp.word_count_range;
    if (result.word_count < min || result.word_count > max) {
        failures.push({
            check: 'word_count',
            expected: `${min}–${max}`,
            actual: String(result.word_count),
        });
    }

    // must_contain
    for (const phrase of exp.must_contain) {
        if (!result.markdown.includes(phrase)) {
            failures.push({
                check: 'must_contain',
                expected: phrase,
                actual: '(not found in markdown)',
            });
        }
    }

    // must_not_contain
    for (const phrase of exp.must_not_contain) {
        if (result.markdown.includes(phrase)) {
            failures.push({
                check: 'must_not_contain',
                expected: `absent: ${phrase}`,
                actual: '(found in markdown)',
            });
        }
    }

    // Quality metrics
    const metrics = computeWordMetrics(result.markdown, exp.must_contain);
    const structuralChecks = detectStructure(result.markdown);

    return {
        name: fixture.name,
        archetype: fixture.archetype,
        passed: failures.length === 0,
        failures,
        metrics,
        structuralChecks,
    };
}

// ── Aggregate report ────────────────────────────────────────────

export interface EvalReport {
    total: number;
    passed: number;
    failed: number;
    macroF1: number;
    perArchetype: Record<
        string,
        { total: number; passed: number; failed: number }
    >;
    fixtures: FixtureResult[];
}

export function buildReport(results: FixtureResult[]): EvalReport {
    const perArchetype: Record<
        string,
        { total: number; passed: number; failed: number }
    > = {};

    for (const r of results) {
        if (!perArchetype[r.archetype]) {
            perArchetype[r.archetype] = { total: 0, passed: 0, failed: 0 };
        }
        perArchetype[r.archetype].total++;
        if (r.passed) perArchetype[r.archetype].passed++;
        else perArchetype[r.archetype].failed++;
    }

    const f1Values = results.map((r) => r.metrics.f1);
    const macroF1 =
        f1Values.length > 0
            ? f1Values.reduce((a, b) => a + b, 0) / f1Values.length
            : 0;

    return {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        macroF1,
        perArchetype,
        fixtures: results,
    };
}

/**
 * Format a human-readable summary for stderr.
 */
export function formatSummary(report: EvalReport): string {
    const lines: string[] = [];
    lines.push(
        `\nEval: ${report.passed}/${report.total} fixtures passed (macro-F1: ${report.macroF1.toFixed(3)})\n`,
    );

    for (const [archetype, stats] of Object.entries(report.perArchetype)) {
        lines.push(`  ${archetype}: ${stats.passed}/${stats.total} passed`);
    }
    lines.push('');

    for (const fixture of report.fixtures) {
        const status = fixture.passed ? 'PASS' : 'FAIL';
        lines.push(`  [${status}] ${fixture.archetype}/${fixture.name}`);
        if (!fixture.passed) {
            for (const f of fixture.failures) {
                lines.push(
                    `    - ${f.check}: expected ${f.expected}, got ${f.actual}`,
                );
            }
        }
        lines.push(
            `    metrics: P=${fixture.metrics.precision.toFixed(3)} R=${fixture.metrics.recall.toFixed(3)} F1=${fixture.metrics.f1.toFixed(3)}`,
        );
        const s = fixture.structuralChecks;
        const structural = [
            s.hasHeadings && 'headings',
            s.hasLists && 'lists',
            s.hasCodeBlocks && 'code-blocks',
            s.hasImages && 'images',
        ]
            .filter(Boolean)
            .join(', ');
        if (structural) {
            lines.push(`    structure: ${structural}`);
        }
    }
    lines.push('');
    return lines.join('\n');
}

// ── Main entrypoint ─────────────────────────────────────────────

export function runEval(corpusDir: string): EvalReport {
    const fixtures = discoverFixtures(corpusDir);
    const results = fixtures.map(evaluateFixture);
    return buildReport(results);
}

// CLI entrypoint when run with tsx
if (
    process.argv[1] &&
    (process.argv[1].endsWith('/eval.ts') ||
        process.argv[1].endsWith('\\eval.ts'))
) {
    const corpusDir = path.resolve(
        import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
        'fixtures/corpus',
    );

    const report = runEval(corpusDir);

    // Structured JSON to stdout
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    // Human-readable summary to stderr
    process.stderr.write(formatSummary(report));

    process.exit(report.failed > 0 ? 1 : 0);
}
