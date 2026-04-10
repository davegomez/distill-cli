import { readFileSync } from 'node:fs';
import { DistillError, invalidInputJson } from '#/schema/errors.ts';
import { type ExtractInput, ExtractInputSchema } from '#/schema/input.ts';

/**
 * Read and parse canonical JSON input from stdin (`-`) or a file (`@path`).
 * Returns the raw parsed object (not yet validated against ExtractInputSchema).
 */
function readRawJson(source: string): unknown {
    if (source === '-') {
        const buf = readFileSync(0, 'utf-8');
        try {
            return JSON.parse(buf);
        } catch (err) {
            throw invalidInputJson(
                `Invalid JSON on stdin: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    if (source.startsWith('@')) {
        const filePath = source.slice(1);
        let content: string;
        try {
            content = readFileSync(filePath, 'utf-8');
        } catch {
            throw invalidInputJson(`Cannot read file: ${filePath}`);
        }
        try {
            return JSON.parse(content);
        } catch (err) {
            throw invalidInputJson(
                `Invalid JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    throw invalidInputJson(
        '--input requires "-" (stdin) or "@file.json" (file path)',
    );
}

/**
 * §3.1 — Read canonical JSON input from `--input`, merge with CLI flags,
 * and return the resolved ExtractInput.
 *
 * Precedence: positional URL wins over `url` in JSON; other flags override JSON fields.
 */
export function readInput(
    inputSource: string,
    flags: Record<string, unknown>,
): ExtractInput {
    const raw = readRawJson(inputSource);

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw invalidInputJson('Input must be a JSON object');
    }

    const merged = { ...(raw as Record<string, unknown>), ...flags };

    try {
        return ExtractInputSchema.parse(merged);
    } catch (err) {
        if (err instanceof DistillError) throw err;
        throw invalidInputJson(
            err instanceof Error ? err.message : String(err),
        );
    }
}
