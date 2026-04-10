import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock node:fs so we can intercept readFileSync(0) for stdin tests
// while letting real file reads pass through.
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const { readInput } = await import('#/cli/input.ts');

const VALID_JSON = {
    url: 'https://example.com',
    render: true,
    selector: 'main',
    timeout: 5000,
};

let tempDir: string;
let validFile: string;
let invalidFile: string;
let nonObjectFile: string;

beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'distill-input-test-'));
    validFile = join(tempDir, 'valid.json');
    invalidFile = join(tempDir, 'invalid.json');
    nonObjectFile = join(tempDir, 'array.json');
    writeFileSync(validFile, JSON.stringify(VALID_JSON));
    writeFileSync(invalidFile, '{ broken json');
    writeFileSync(nonObjectFile, '[1, 2, 3]');
});

afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

describe('readInput', () => {
    describe('stdin input', () => {
        it('parses and merges stdin JSON', () => {
            vi.mocked(readFileSync).mockImplementationOnce(
                () =>
                    JSON.stringify({
                        url: 'https://stdin.example.com',
                        render: true,
                    }) as string & Buffer,
            );
            const result = readInput('-', {});
            expect(result.url).toBe('https://stdin.example.com');
            expect(result.render).toBe(true);
            expect(result.format).toBe('json');
        });

        it('throws INVALID_INPUT_JSON for invalid stdin JSON', () => {
            vi.mocked(readFileSync).mockImplementationOnce(
                () => '{ broken' as string & Buffer,
            );
            expect(() => readInput('-', {})).toThrow(
                expect.objectContaining({ code: 'INVALID_INPUT_JSON' }),
            );
        });
    });

    describe('@file input', () => {
        it('parses and merges @file JSON', () => {
            const result = readInput(`@${validFile}`, {});
            expect(result.url).toBe('https://example.com');
            expect(result.render).toBe(true);
            expect(result.selector).toBe('main');
            expect(result.timeout).toBe(5000);
        });

        it('applies schema defaults for missing fields', () => {
            const result = readInput(`@${validFile}`, {});
            expect(result.format).toBe('json');
            expect(result.retries).toBe(2);
            expect(result.no_cache).toBe(false);
        });
    });

    describe('invalid JSON', () => {
        it('throws INVALID_INPUT_JSON for malformed JSON in file', () => {
            expect(() => readInput(`@${invalidFile}`, {})).toThrow(
                expect.objectContaining({ code: 'INVALID_INPUT_JSON' }),
            );
        });

        it('throws INVALID_INPUT_JSON for non-object JSON', () => {
            expect(() => readInput(`@${nonObjectFile}`, {})).toThrow(
                expect.objectContaining({ code: 'INVALID_INPUT_JSON' }),
            );
        });

        it('throws INVALID_INPUT_JSON for missing file', () => {
            expect(() => readInput('@/nonexistent/path/file.json', {})).toThrow(
                expect.objectContaining({ code: 'INVALID_INPUT_JSON' }),
            );
        });

        it('includes file path in hint for missing file', () => {
            try {
                readInput('@/nonexistent/path/file.json', {});
                expect.fail('should have thrown');
            } catch (err) {
                expect((err as { hint: string }).hint).toContain(
                    '/nonexistent/path/file.json',
                );
            }
        });

        it('throws INVALID_INPUT_JSON for unsupported source format', () => {
            expect(() =>
                readInput('{"url":"https://example.com"}', {}),
            ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT_JSON' }));
        });
    });

    describe('precedence: positional URL overrides JSON url', () => {
        it('flags.url wins over JSON url', () => {
            const result = readInput(`@${validFile}`, {
                url: 'https://override.example.com',
            });
            expect(result.url).toBe('https://override.example.com');
        });
    });

    describe('flags override JSON fields', () => {
        it('individual flags override JSON values', () => {
            const result = readInput(`@${validFile}`, {
                selector: 'article',
                timeout: 60000,
                render: false,
            });
            expect(result.selector).toBe('article');
            expect(result.timeout).toBe(60000);
            expect(result.render).toBe(false);
        });
    });

    describe('schema validation', () => {
        it('valid JSON passes ExtractInputSchema', () => {
            const result = readInput(`@${validFile}`, {});
            expect(result.url).toBe('https://example.com');
        });

        it('rejects JSON with unknown fields', () => {
            const unknownFile = join(tempDir, 'unknown.json');
            writeFileSync(
                unknownFile,
                JSON.stringify({
                    url: 'https://example.com',
                    unknown_field: true,
                }),
            );
            expect(() => readInput(`@${unknownFile}`, {})).toThrow(
                expect.objectContaining({ code: 'INVALID_INPUT_JSON' }),
            );
        });
    });
});
