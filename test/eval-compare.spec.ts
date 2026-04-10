import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fixture, FixtureFile } from './eval.ts';
import type { ComparisonReport, FixtureComparison } from './eval-compare.ts';
import {
    buildComparisonReport,
    compareFixture,
    formatComparisonTable,
} from './eval-compare.ts';

// ── Synthetic fixture for shape validation ─────────────────────

const SYNTHETIC_HTML = `<!DOCTYPE html>
<html><head><title>Synthetic Test</title></head>
<body><article><p>Hello world, this is synthetic content for comparison testing.</p></article></body>
</html>`;

const SYNTHETIC_EXPECTED: FixtureFile = {
    fixture_version: '1',
    source_url: 'https://example.com/synthetic',
    archetype: 'article-blog',
    notes: 'Synthetic fixture for eval-compare shape validation',
    expected: {
        title: 'Synthetic Test',
        strategy: 'selector',
        selector: 'article',
        confidence: 'high',
        word_count_range: [1, 100],
        must_contain: ['Hello world'],
        must_not_contain: [],
    },
};

describe('eval-compare', () => {
    let tmpDir: string;
    let fixture: Fixture;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distill-compare-'));
        const archetypeDir = path.join(tmpDir, 'article-blog');
        fs.mkdirSync(archetypeDir, { recursive: true });

        const htmlPath = path.join(archetypeDir, 'synthetic.html');
        const expectedPath = path.join(archetypeDir, 'synthetic.expected.json');

        fs.writeFileSync(htmlPath, SYNTHETIC_HTML);
        fs.writeFileSync(expectedPath, JSON.stringify(SYNTHETIC_EXPECTED));

        fixture = {
            name: 'synthetic',
            archetype: 'article-blog',
            htmlPath,
            expectedPath,
            expected: SYNTHETIC_EXPECTED,
        };
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('compareFixture returns the expected shape', () => {
        const result: FixtureComparison = compareFixture(fixture);

        expect(result.name).toBe('synthetic');
        expect(result.archetype).toBe('article-blog');
        expect(Array.isArray(result.tools)).toBe(true);
        expect(result.tools.length).toBe(4);

        for (const tool of result.tools) {
            expect(tool).toHaveProperty('tool');
            expect(tool).toHaveProperty('available');
            expect(tool).toHaveProperty('title');
            expect(tool).toHaveProperty('textContent');
            expect(tool).toHaveProperty('wordCount');
            expect(tool).toHaveProperty('metrics');
            expect(tool.metrics).toHaveProperty('precision');
            expect(tool.metrics).toHaveProperty('recall');
            expect(tool.metrics).toHaveProperty('f1');
            expect(tool).toHaveProperty('structuralChecks');
        }

        // distill is always available
        const distill = result.tools.find((t) => t.tool === 'distill');
        expect(distill?.available).toBe(true);
        expect(distill?.wordCount).toBeGreaterThan(0);
    });

    it('buildComparisonReport produces a valid ComparisonReport', () => {
        const report: ComparisonReport = buildComparisonReport(tmpDir);

        expect(report).toHaveProperty('generated_at');
        expect(typeof report.generated_at).toBe('string');
        expect(report).toHaveProperty('fixture_count');
        expect(report.fixture_count).toBe(1);
        expect(Array.isArray(report.tools)).toBe(true);
        expect(report.tools).toContain('distill');
        expect(Array.isArray(report.fixtures)).toBe(true);
        expect(report.fixtures.length).toBe(1);
    });

    it('unavailable tools are marked as such without crashing', () => {
        const result = compareFixture(fixture);

        // trafilatura may or may not be installed; if not, it should be marked unavailable
        const trafilatura = result.tools.find((t) => t.tool === 'trafilatura');
        expect(trafilatura).toBeDefined();
        if (!trafilatura?.available) {
            expect(trafilatura?.wordCount).toBe(0);
            expect(trafilatura?.metrics.f1).toBe(0);
        }
    });

    it('formatComparisonTable produces readable output', () => {
        const report = buildComparisonReport(tmpDir);
        const table = formatComparisonTable(report);

        expect(table).toContain('Cross-tool comparison');
        expect(table).toContain('MACRO AVG');
        expect(table).toContain('article-blog/synthetic');
    });

    it('report has valid ISO date in generated_at', () => {
        const report = buildComparisonReport(tmpDir);
        const date = new Date(report.generated_at);
        expect(date.getTime()).not.toBeNaN();
    });

    it('buildComparisonReport returns empty fixtures for missing corpus', () => {
        const report = buildComparisonReport('/nonexistent/path');
        expect(report.fixture_count).toBe(0);
        expect(report.fixtures).toEqual([]);
    });
});
