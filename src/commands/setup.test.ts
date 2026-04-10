import type { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSetup } from '#/commands/setup.ts';

// Mock node:child_process
vi.mock('node:child_process', () => ({
    execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(childProcess.execFile);

/** Minimal fake ChildProcess for mock returns. */
function fakeChild(): ChildProcess {
    return {
        stdout: { resume: vi.fn(), pipe: vi.fn() },
        stderr: { resume: vi.fn(), pipe: vi.fn() },
    } as unknown as ChildProcess;
}

/** Helper: make execFile call the callback synchronously. */
function mockExecFileSuccess(stdout = '', stderr = '') {
    mockedExecFile.mockImplementation(
        // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
        (_cmd: any, _args: any, _opts: any, callback: any) => {
            callback(null, stdout, stderr);
            return fakeChild();
        },
    );
}

function mockExecFileFailure(errorMessage = 'install failed') {
    mockedExecFile.mockImplementation(
        // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
        (_cmd: any, _args: any, _opts: any, callback: any) => {
            callback(new Error(errorMessage), '', errorMessage);
            return fakeChild();
        },
    );
}

describe('runSetup', () => {
    let stdoutOutput: string;

    beforeEach(() => {
        stdoutOutput = '';
        mockedExecFile.mockReset();
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdoutOutput += String(chunk);
            return true;
        });
        vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        process.exitCode = undefined;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('install', () => {
        it('invokes playwright install chromium by default', async () => {
            mockExecFileSuccess('Downloading chromium...');

            await runSetup({});

            expect(mockedExecFile).toHaveBeenCalledWith(
                'npx',
                ['playwright', 'install', 'chromium'],
                expect.objectContaining({ env: expect.any(Object) }),
                expect.any(Function),
            );
        });

        it('invokes playwright install with --force when force=true', async () => {
            mockExecFileSuccess();

            await runSetup({ force: true });

            expect(mockedExecFile).toHaveBeenCalledWith(
                'npx',
                ['playwright', 'install', 'chromium', '--force'],
                expect.objectContaining({ env: expect.any(Object) }),
                expect.any(Function),
            );
        });

        it('installs the specified browser', async () => {
            mockExecFileSuccess();

            await runSetup({ browser: 'firefox' });

            expect(mockedExecFile).toHaveBeenCalledWith(
                'npx',
                ['playwright', 'install', 'firefox'],
                expect.any(Object),
                expect.any(Function),
            );
        });

        it('installs all browsers when browser=all', async () => {
            mockExecFileSuccess();

            await runSetup({ browser: 'all' });

            const calls = mockedExecFile.mock.calls;
            const installedBrowsers = calls.map((c) => (c[1] as string[])[2]);
            expect(installedBrowsers).toEqual([
                'chromium',
                'firefox',
                'webkit',
            ]);
        });

        it('sets exitCode to 5 on install failure', async () => {
            mockExecFileFailure();

            await runSetup({});

            expect(process.exitCode).toBe(5);
        });

        it('outputs JSON result when json=true', async () => {
            mockExecFileSuccess('done');

            await runSetup({ json: true });

            const parsed = JSON.parse(stdoutOutput);
            expect(parsed.action).toBe('install');
            expect(parsed.success).toBe(true);
            expect(parsed.browsers).toEqual([
                { name: 'chromium', installed: true },
            ]);
        });

        it('throws for invalid browser name', async () => {
            await expect(runSetup({ browser: 'opera' })).rejects.toThrow(
                'Invalid browser "opera"',
            );
        });
    });

    describe('--check', () => {
        it('returns JSON indicating missing browser when not installed', async () => {
            mockExecFileFailure('browser not found');

            await runSetup({ check: true, json: true });

            const parsed = JSON.parse(stdoutOutput);
            expect(parsed.action).toBe('check');
            expect(parsed.browsers).toEqual([
                { name: 'chromium', installed: false },
            ]);
            expect(parsed.success).toBe(true);
            // --check always exits 0
            expect(process.exitCode).toBeUndefined();
        });

        it('returns JSON indicating installed browser', async () => {
            mockExecFileSuccess();

            await runSetup({ check: true, json: true });

            const parsed = JSON.parse(stdoutOutput);
            expect(parsed.browsers).toEqual([
                { name: 'chromium', installed: true },
            ]);
            expect(parsed.message).toBe('All requested browsers are installed');
        });

        it('reports text status when json=false', async () => {
            mockExecFileFailure();

            await runSetup({ check: true });

            expect(stdoutOutput).toContain('chromium: missing');
        });

        it('uses --dry-run flag when checking', async () => {
            mockExecFileSuccess();

            await runSetup({ check: true });

            expect(mockedExecFile).toHaveBeenCalledWith(
                'npx',
                ['playwright', 'install', '--dry-run', 'chromium'],
                expect.any(Object),
                expect.any(Function),
            );
        });
    });
});
