import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { parseHTML } from 'linkedom';
import {
    computeWordMetrics,
    detectStructure,
    discoverFixtures,
    extractFromHtml,
    type Fixture,
    tokenize,
    type WordMetrics,
} from './eval.ts';

const require = createRequire(import.meta.url);

// ── Types ──────────────────────────────────────────────────────

export interface ToolResult {
    tool: string;
    available: boolean;
    title: string;
    textContent: string;
    wordCount: number;
    metrics: WordMetrics;
    structuralChecks: {
        hasHeadings: boolean;
        hasLists: boolean;
        hasCodeBlocks: boolean;
        hasImages: boolean;
    };
}

export interface FixtureComparison {
    name: string;
    archetype: string;
    tools: ToolResult[];
}

export interface ComparisonReport {
    generated_at: string;
    fixture_count: number;
    tools: string[];
    fixtures: FixtureComparison[];
}

// ── Tool runners ───────────────────────────────────────────────

function runDistill(html: string, sourceUrl: string): ToolResult {
    const result = extractFromHtml(html, sourceUrl);
    const words = tokenize(result.markdown);
    return {
        tool: 'distill',
        available: true,
        title: result.title,
        textContent: result.markdown,
        wordCount: words.length,
        metrics: { precision: 0, recall: 0, f1: 0 },
        structuralChecks: detectStructure(result.markdown),
    };
}

function runDefuddle(html: string, url: string): ToolResult {
    try {
        // UMD bundle exports the class directly via createRequire
        const Defuddle = require('defuddle') as new (
            doc: unknown,
            opts: { url: string; markdown: boolean },
        ) => {
            parse(): { title?: string; content?: string };
        };
        const { document } = parseHTML(html);
        const defuddled = new Defuddle(document, {
            url,
            markdown: true,
        }).parse();
        const text = defuddled.content ?? '';
        const words = tokenize(text);
        return {
            tool: 'defuddle',
            available: true,
            title: defuddled.title ?? '',
            textContent: text,
            wordCount: words.length,
            metrics: { precision: 0, recall: 0, f1: 0 },
            structuralChecks: detectStructure(text),
        };
    } catch {
        return unavailableResult('defuddle');
    }
}

function runReadability(html: string, _url: string): ToolResult {
    try {
        const { Readability } = require('@mozilla/readability') as {
            Readability: new (
                doc: unknown,
            ) => {
                parse(): { title: string; textContent: string } | null;
            };
        };
        const { document } = parseHTML(html);
        const parsed = new Readability(document).parse();
        const text = parsed?.textContent ?? '';
        const words = tokenize(text);
        return {
            tool: 'readability',
            available: true,
            title: parsed?.title ?? '',
            textContent: text,
            wordCount: words.length,
            metrics: { precision: 0, recall: 0, f1: 0 },
            structuralChecks: detectStructure(text),
        };
    } catch {
        return unavailableResult('readability');
    }
}

function runTrafilatura(htmlPath: string): ToolResult {
    try {
        const result = execFileSync(
            'python3',
            ['-m', 'trafilatura', '--input-file', htmlPath],
            {
                timeout: 30_000,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            },
        );
        const text = result.trim();
        const words = tokenize(text);
        return {
            tool: 'trafilatura',
            available: true,
            title: '',
            textContent: text,
            wordCount: words.length,
            metrics: { precision: 0, recall: 0, f1: 0 },
            structuralChecks: detectStructure(text),
        };
    } catch {
        return unavailableResult('trafilatura');
    }
}

function unavailableResult(tool: string): ToolResult {
    return {
        tool,
        available: false,
        title: '',
        textContent: '',
        wordCount: 0,
        metrics: { precision: 0, recall: 0, f1: 0 },
        structuralChecks: {
            hasHeadings: false,
            hasLists: false,
            hasCodeBlocks: false,
            hasImages: false,
        },
    };
}

// ── Compare a single fixture ───────────────────────────────────

export function compareFixture(fixture: Fixture): FixtureComparison {
    const html = fs.readFileSync(fixture.htmlPath, 'utf-8');
    const url = fixture.expected.source_url;
    const mustContain = fixture.expected.expected.must_contain;

    const tools = [
        runDistill(html, url),
        runDefuddle(html, url),
        runReadability(html, url),
        runTrafilatura(fixture.htmlPath),
    ];

    for (const tool of tools) {
        if (tool.available) {
            tool.metrics = computeWordMetrics(tool.textContent, mustContain);
        }
    }

    return {
        name: fixture.name,
        archetype: fixture.archetype,
        tools,
    };
}

// ── Build full report ──────────────────────────────────────────

export function buildComparisonReport(corpusDir: string): ComparisonReport {
    const fixtures = discoverFixtures(corpusDir);
    const comparisons = fixtures.map(compareFixture);

    const allTools = new Set<string>();
    for (const c of comparisons) {
        for (const t of c.tools) {
            if (t.available) allTools.add(t.tool);
        }
    }

    return {
        generated_at: new Date().toISOString(),
        fixture_count: comparisons.length,
        tools: [...allTools].sort(),
        fixtures: comparisons,
    };
}

// ── Format table for stdout ────────────────────────────────────

export function formatComparisonTable(report: ComparisonReport): string {
    const lines: string[] = [];
    const tools = report.tools;

    lines.push(
        `Cross-tool comparison: ${report.fixture_count} fixtures, ${tools.length} tools (${tools.join(', ')})`,
    );
    lines.push('');

    const header = [
        'Fixture',
        ...tools.flatMap((t) => [`${t}:F1`, `${t}:words`]),
    ];
    lines.push(header.join('\t'));
    lines.push(header.map((h) => '-'.repeat(h.length)).join('\t'));

    for (const fixture of report.fixtures) {
        const row = [`${fixture.archetype}/${fixture.name}`];
        for (const toolName of tools) {
            const t = fixture.tools.find((x) => x.tool === toolName);
            if (t?.available) {
                row.push(t.metrics.f1.toFixed(3), String(t.wordCount));
            } else {
                row.push('n/a', 'n/a');
            }
        }
        lines.push(row.join('\t'));
    }

    lines.push('');
    const avgRow = ['MACRO AVG'];
    for (const toolName of tools) {
        const f1Values: number[] = [];
        const wordCounts: number[] = [];
        for (const fixture of report.fixtures) {
            const t = fixture.tools.find((x) => x.tool === toolName);
            if (t?.available) {
                f1Values.push(t.metrics.f1);
                wordCounts.push(t.wordCount);
            }
        }
        const avgF1 =
            f1Values.length > 0
                ? f1Values.reduce((a, b) => a + b, 0) / f1Values.length
                : 0;
        const avgWords =
            wordCounts.length > 0
                ? Math.round(
                      wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length,
                  )
                : 0;
        avgRow.push(avgF1.toFixed(3), String(avgWords));
    }
    lines.push(avgRow.join('\t'));
    lines.push('');

    return lines.join('\n');
}

// ── CLI entrypoint ─────────────────────────────────────────────

if (
    process.argv[1] &&
    (process.argv[1].endsWith('/eval-compare.ts') ||
        process.argv[1].endsWith('\\eval-compare.ts'))
) {
    const corpusDir = path.resolve(
        import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
        'fixtures/corpus',
    );

    const report = buildComparisonReport(corpusDir);

    const outPath = path.resolve(
        import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
        'fixtures/comparison.json',
    );
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

    process.stdout.write(formatComparisonTable(report));
    process.stderr.write(`Report written to ${outPath}\n`);
}
