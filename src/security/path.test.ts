import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DistillError, ErrorCode } from '#/schema/errors.ts';
import { ensureSafeDir, validateOutputPath } from '#/security/path.ts';

describe('validateOutputPath', () => {
    describe('valid relative paths', () => {
        it('resolves a simple relative path against cwd', () => {
            const result = validateOutputPath('images');
            expect(result).toBe(resolve(process.cwd(), 'images'));
        });

        it('resolves a nested relative path', () => {
            const result = validateOutputPath('output/images/thumbnails');
            expect(result).toBe(
                resolve(process.cwd(), 'output/images/thumbnails'),
            );
        });

        it('resolves a relative path with safe .. that stays within base', () => {
            const base = '/home/user/project';
            const result = validateOutputPath('src/../assets', base);
            expect(result).toBe('/home/user/project/assets');
        });
    });

    describe('valid absolute paths', () => {
        it('accepts an absolute path within user home', () => {
            const home = process.env.HOME ?? '/home/user';
            const target = join(home, 'downloads', 'images');
            const result = validateOutputPath(target, home);
            expect(result).toBe(target);
        });

        it('accepts a path equal to the base itself', () => {
            const base = '/home/user/project';
            const result = validateOutputPath(base, base);
            expect(result).toBe(base);
        });
    });

    describe('.. escape rejection', () => {
        it('rejects a path that escapes cwd via ..', () => {
            const base = '/home/user/project';
            expect(() => validateOutputPath('../../etc/passwd', base)).toThrow(
                DistillError,
            );
        });

        it('throws INVALID_PATH for .. escape', () => {
            const base = '/home/user/project';
            try {
                validateOutputPath('../../../tmp/evil', base);
                expect.unreachable('should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(DistillError);
                expect((err as DistillError).code).toBe(ErrorCode.INVALID_PATH);
            }
        });

        it('rejects absolute paths that are outside the base', () => {
            const base = '/home/user/project';
            expect(() => validateOutputPath('/tmp/outside', base)).toThrow(
                DistillError,
            );
        });
    });

    describe('sensitive location rejection', () => {
        for (const dir of ['/etc', '/proc', '/sys', '/dev']) {
            it(`rejects path pointing into ${dir}`, () => {
                // Use the sensitive dir itself as both target and base so it doesn't
                // fail the escape check before reaching the sensitive-prefix check
                expect(() => validateOutputPath(`${dir}/foo`, dir)).toThrow(
                    DistillError,
                );
            });

            it(`rejects ${dir} exactly`, () => {
                expect(() => validateOutputPath(dir, dir)).toThrow(
                    DistillError,
                );
            });

            it(`INVALID_PATH code for ${dir}`, () => {
                try {
                    validateOutputPath(`${dir}/test`, dir);
                    expect.unreachable('should have thrown');
                } catch (err) {
                    expect(err).toBeInstanceOf(DistillError);
                    expect((err as DistillError).code).toBe(
                        ErrorCode.INVALID_PATH,
                    );
                }
            });
        }
    });
});

describe('ensureSafeDir', () => {
    const testDirs: string[] = [];

    afterEach(async () => {
        for (const dir of testDirs) {
            await rm(dir, { recursive: true, force: true });
        }
        testDirs.length = 0;
    });

    it('creates a missing directory', async () => {
        const dir = join(tmpdir(), `distill-test-${randomUUID()}`);
        testDirs.push(dir);

        await ensureSafeDir(dir);

        const stats = await stat(dir);
        expect(stats.isDirectory()).toBe(true);
    });

    it('creates nested missing directories', async () => {
        const rootName = `distill-test-${randomUUID()}`;
        const dir = join(tmpdir(), rootName, 'nested', 'deep');
        testDirs.push(join(tmpdir(), rootName));

        await ensureSafeDir(dir);

        const stats = await stat(dir);
        expect(stats.isDirectory()).toBe(true);
    });

    it('is a no-op if directory already exists', async () => {
        const dir = join(tmpdir(), `distill-test-${randomUUID()}`);
        testDirs.push(dir);

        await ensureSafeDir(dir);
        // Call again — should not throw
        await ensureSafeDir(dir);

        const stats = await stat(dir);
        expect(stats.isDirectory()).toBe(true);
    });
});
