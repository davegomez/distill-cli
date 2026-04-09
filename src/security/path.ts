import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { invalidPath } from '#/schema/errors.ts';

/**
 * Sensitive root directories that must never be written to.
 * Matching is prefix-based on the canonicalized path.
 */
const SENSITIVE_PREFIXES = ['/etc', '/proc', '/sys', '/dev'];

/**
 * Validate and canonicalize a user-supplied output path per DESIGN.md §9.2.
 *
 * Rules:
 * 1. Canonicalize via node:path.resolve (collapses `.`, `..`, normalizes separators)
 * 2. Reject paths that escape the intended base directory via `..`
 * 3. Reject absolute paths pointing into sensitive system locations
 *
 * Returns an absolute canonicalized path on success, throws DistillError INVALID_PATH on failure.
 */
export function validateOutputPath(
    raw: string,
    base: string = process.cwd(),
): string {
    const canonical = resolve(base, raw);
    const normalizedBase = resolve(base);

    // Reject `..` escapes: the resolved path must start with the base directory
    if (
        canonical !== normalizedBase &&
        !canonical.startsWith(`${normalizedBase}/`)
    ) {
        throw invalidPath(
            raw,
            'Path escapes the base directory via ".." traversal.',
        );
    }

    // Reject sensitive system locations
    for (const prefix of SENSITIVE_PREFIXES) {
        if (canonical === prefix || canonical.startsWith(`${prefix}/`)) {
            throw invalidPath(
                raw,
                `Path points into sensitive system directory "${prefix}".`,
            );
        }
    }

    return canonical;
}

/**
 * Ensure a directory exists with safe permissions (0o755).
 * Creates the directory recursively if it doesn't exist.
 * No-op if the directory already exists.
 */
export async function ensureSafeDir(dirPath: string): Promise<void> {
    try {
        const stats = await stat(dirPath);
        if (!stats.isDirectory()) {
            throw invalidPath(dirPath, 'Path exists but is not a directory.');
        }
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
            await mkdir(dirPath, { recursive: true, mode: 0o755 });
            return;
        }
        throw err;
    }
}
