import * as childProcess from 'node:child_process';
import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock modules before importing the code under test
vi.mock('node:child_process', () => ({
    execFile: vi.fn(),
}));

vi.mock('node:dns', () => ({
    resolve: vi.fn(),
}));

vi.mock('node:fs', () => ({
    accessSync: vi.fn(),
    constants: { W_OK: 2 },
    mkdtempSync: vi.fn(),
    rmSync: vi.fn(),
    statfsSync: vi.fn(),
    writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
    tmpdir: vi.fn(() => '/tmp'),
}));

vi.mock('#/cache/sqlite.ts', () => ({
    resolveCacheDir: vi.fn(() => '/mock/cache/distill'),
}));

// Import after mocks are set up
import type { ChildProcess } from 'node:child_process';
import {
    checkCacheDirFreeSpace,
    checkCacheDirWritable,
    checkChromiumLaunches,
    checkChromiumPresent,
    checkIsRoot,
    checkNetworkDns,
    checkNodeVersion,
    checkPlaywrightInstalled,
    checkTmpdir,
    collectChecks,
    type DoctorReport,
    runDoctor,
} from '#/commands/doctor.ts';

const mockedExecFile = vi.mocked(childProcess.execFile);
const mockedDnsResolve = vi.mocked(dns.resolve);
const mockedAccessSync = vi.mocked(fs.accessSync);
const mockedStatfsSync = vi.mocked(fs.statfsSync);
const mockedMkdtempSync = vi.mocked(fs.mkdtempSync);
const mockedTmpdir = vi.mocked(os.tmpdir);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeChild(): ChildProcess {
    return {
        stdout: { resume: vi.fn(), pipe: vi.fn() },
        stderr: { resume: vi.fn(), pipe: vi.fn() },
    } as unknown as ChildProcess;
}

function mockExecFileSuccess(stdout = '', stderr = '') {
    mockedExecFile.mockImplementation(
        // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
        (_cmd: any, _args: any, _opts: any, callback: any) => {
            callback(null, stdout, stderr);
            return fakeChild();
        },
    );
}

function mockExecFileFailure(errorMessage = 'command failed', stderr = '') {
    mockedExecFile.mockImplementation(
        // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
        (_cmd: any, _args: any, _opts: any, callback: any) => {
            const err = Object.assign(new Error(errorMessage), {
                stdout: '',
                stderr,
            });
            callback(err, '', stderr);
            return fakeChild();
        },
    );
}

/** Make execFile succeed for specific arg patterns and fail otherwise. */
function mockExecFileConditional(
    conditions: Array<{
        argsMatch: string;
        stdout?: string;
        stderr?: string;
        fail?: boolean;
        killed?: boolean;
    }>,
) {
    mockedExecFile.mockImplementation(
        // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
        (_cmd: any, args: any, _opts: any, callback: any) => {
            const argsStr = (args as string[]).join(' ');
            for (const cond of conditions) {
                if (argsStr.includes(cond.argsMatch)) {
                    if (cond.fail) {
                        const err = Object.assign(new Error('command failed'), {
                            stdout: cond.stdout ?? '',
                            stderr: cond.stderr ?? '',
                            killed: cond.killed ?? false,
                        });
                        callback(err, cond.stdout ?? '', cond.stderr ?? '');
                        return fakeChild();
                    }
                    callback(null, cond.stdout ?? '', cond.stderr ?? '');
                    return fakeChild();
                }
            }
            // Default: succeed
            callback(null, '', '');
            return fakeChild();
        },
    );
}

function mockDnsSuccess() {
    mockedDnsResolve.mockImplementation(
        // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
        (_hostname: any, callback: any) => {
            callback(null, ['93.184.216.34']);
        },
    );
}

function mockDnsFailure() {
    mockedDnsResolve.mockImplementation(
        // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
        (_hostname: any, callback: any) => {
            callback(new Error('ENOTFOUND'));
        },
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('doctor', () => {
    let stdoutOutput: string;

    beforeEach(() => {
        stdoutOutput = '';
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

    // -----------------------------------------------------------------------
    // node.version
    // -----------------------------------------------------------------------
    describe('checkNodeVersion', () => {
        it('passes when Node >= 24', () => {
            // process.versions.node is read-only, so we test the actual runtime
            // Since we require Node 24+, this should pass in CI
            const result = checkNodeVersion();
            const major = Number.parseInt(
                process.versions.node.split('.')[0],
                10,
            );
            if (major >= 24) {
                expect(result.status).toBe('pass');
            } else {
                expect(result.status).toBe('fail');
            }
        });
    });

    // -----------------------------------------------------------------------
    // playwright.installed
    // -----------------------------------------------------------------------
    describe('checkPlaywrightInstalled', () => {
        it('passes when playwright command succeeds', async () => {
            mockExecFileSuccess('Version 1.50.0');
            const result = await checkPlaywrightInstalled();
            expect(result.status).toBe('pass');
        });

        it('fails when playwright command errors', async () => {
            mockExecFileFailure('not found');
            const result = await checkPlaywrightInstalled();
            expect(result.status).toBe('fail');
            expect(result.hint).toContain('pnpm add playwright');
        });
    });

    // -----------------------------------------------------------------------
    // playwright.browser.chromium.present
    // -----------------------------------------------------------------------
    describe('checkChromiumPresent', () => {
        it('passes when dry-run succeeds', async () => {
            mockExecFileSuccess('chromium already installed');
            const result = await checkChromiumPresent();
            expect(result.status).toBe('pass');
        });

        it('fails when dry-run errors', async () => {
            mockExecFileFailure('browser not found');
            const result = await checkChromiumPresent();
            expect(result.status).toBe('fail');
            expect(result.fixable).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // playwright.browser.chromium.launches
    // -----------------------------------------------------------------------
    describe('checkChromiumLaunches', () => {
        it('passes when launch times out (browser started)', async () => {
            mockedExecFile.mockImplementation(
                // biome-ignore lint/suspicious/noExplicitAny: test mock requires flexible signature
                (_cmd: any, _args: any, _opts: any, callback: any) => {
                    const err = Object.assign(new Error('timed out'), {
                        stdout: '',
                        stderr: '',
                        killed: true,
                    });
                    callback(err, '', '');
                    return fakeChild();
                },
            );
            const result = await checkChromiumLaunches();
            expect(result.status).toBe('pass');
        });

        it('fails with install hint when missing lib detected', async () => {
            mockExecFileFailure(
                'launch failed',
                'error while loading shared libraries: libnss3.so',
            );
            const result = await checkChromiumLaunches();
            expect(result.status).toBe('fail');
            expect(result.hint).toContain('libnss3');
        });

        it('fails with generic message for unknown errors', async () => {
            mockExecFileFailure('crash', 'Segmentation fault');
            const result = await checkChromiumLaunches();
            expect(result.status).toBe('fail');
            expect(result.hint).toContain('distill doctor --fix');
        });
    });

    // -----------------------------------------------------------------------
    // cache.dir.writable
    // -----------------------------------------------------------------------
    describe('checkCacheDirWritable', () => {
        it('passes when directory is writable', () => {
            mockedAccessSync.mockReturnValue(undefined);
            const result = checkCacheDirWritable();
            expect(result.status).toBe('pass');
        });

        it('fails when directory is not writable', () => {
            mockedAccessSync.mockImplementation(() => {
                throw new Error('EACCES');
            });
            const result = checkCacheDirWritable();
            expect(result.status).toBe('fail');
            expect(result.fixable).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // cache.dir.free_space_mb
    // -----------------------------------------------------------------------
    describe('checkCacheDirFreeSpace', () => {
        it('passes when free space >= 500 MB', () => {
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            const result = checkCacheDirFreeSpace();
            expect(result.status).toBe('pass');
        });

        it('warns when free space < 500 MB', () => {
            mockedStatfsSync.mockReturnValue({
                bfree: 100,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            const result = checkCacheDirFreeSpace();
            expect(result.status).toBe('warn');
            expect(result.message).toContain('MB free');
        });

        it('warns when statfs fails', () => {
            mockedStatfsSync.mockImplementation(() => {
                throw new Error('ENOENT');
            });
            const result = checkCacheDirFreeSpace();
            expect(result.status).toBe('warn');
        });
    });

    // -----------------------------------------------------------------------
    // network.dns_ok
    // -----------------------------------------------------------------------
    describe('checkNetworkDns', () => {
        it('passes when DNS resolves', async () => {
            mockDnsSuccess();
            const result = await checkNetworkDns();
            expect(result.status).toBe('pass');
        });

        it('fails when DNS fails', async () => {
            mockDnsFailure();
            const result = await checkNetworkDns();
            expect(result.status).toBe('fail');
        });
    });

    // -----------------------------------------------------------------------
    // platform.tmpdir
    // -----------------------------------------------------------------------
    describe('checkTmpdir', () => {
        it('passes when tmpdir is writable', () => {
            mockedTmpdir.mockReturnValue('/tmp');
            mockedAccessSync.mockReturnValue(undefined);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            const result = checkTmpdir();
            expect(result.status).toBe('pass');
        });

        it('fails when tmpdir is not writable', () => {
            mockedTmpdir.mockReturnValue('/tmp');
            mockedAccessSync.mockImplementation(() => {
                throw new Error('EACCES');
            });
            const result = checkTmpdir();
            expect(result.status).toBe('fail');
        });
    });

    // -----------------------------------------------------------------------
    // platform.is_root
    // -----------------------------------------------------------------------
    describe('checkIsRoot', () => {
        it('passes when not root', () => {
            vi.spyOn(process, 'getuid').mockReturnValue(1000);
            const result = checkIsRoot();
            expect(result.status).toBe('pass');
        });

        it('warns when root without no-sandbox', () => {
            vi.spyOn(process, 'getuid').mockReturnValue(0);
            const origSandbox = process.env.PLAYWRIGHT_CHROMIUM_SANDBOX;
            const origFlags = process.env.CHROMIUM_FLAGS;
            delete process.env.PLAYWRIGHT_CHROMIUM_SANDBOX;
            delete process.env.CHROMIUM_FLAGS;

            const result = checkIsRoot();
            expect(result.status).toBe('warn');
            expect(result.hint).toContain('PLAYWRIGHT_CHROMIUM_SANDBOX');

            // Restore
            if (origSandbox !== undefined)
                process.env.PLAYWRIGHT_CHROMIUM_SANDBOX = origSandbox;
            if (origFlags !== undefined) process.env.CHROMIUM_FLAGS = origFlags;
        });

        it('warns (with note) when root with no-sandbox set', () => {
            vi.spyOn(process, 'getuid').mockReturnValue(0);
            process.env.PLAYWRIGHT_CHROMIUM_SANDBOX = '0';

            const result = checkIsRoot();
            expect(result.status).toBe('warn');
            expect(result.message).toContain('with --no-sandbox');

            delete process.env.PLAYWRIGHT_CHROMIUM_SANDBOX;
        });
    });

    // -----------------------------------------------------------------------
    // collectChecks — integration
    // -----------------------------------------------------------------------
    describe('collectChecks', () => {
        it('returns all expected check keys', async () => {
            // Set up all mocks for a healthy state
            mockExecFileSuccess('Version 1.50.0');
            mockDnsSuccess();
            mockedAccessSync.mockReturnValue(undefined);
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            mockedTmpdir.mockReturnValue('/tmp');

            const report = await collectChecks();

            expect(report.checks).toHaveProperty('node.version');
            expect(report.checks).toHaveProperty('playwright.installed');
            expect(report.checks).toHaveProperty(
                'playwright.browser.chromium.present',
            );
            expect(report.checks).toHaveProperty(
                'playwright.browser.chromium.launches',
            );
            expect(report.checks).toHaveProperty(
                'playwright.browser.version_match',
            );
            expect(report.checks).toHaveProperty('cache.dir.writable');
            expect(report.checks).toHaveProperty('cache.dir.free_space_mb');
            expect(report.checks).toHaveProperty('network.dns_ok');
            expect(report.checks).toHaveProperty('platform.tmpdir');
            expect(report.checks).toHaveProperty('platform.is_root');
        });

        it('reports healthy when all checks pass', async () => {
            mockExecFileSuccess('Version 1.50.0');
            mockDnsSuccess();
            mockedAccessSync.mockReturnValue(undefined);
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            mockedTmpdir.mockReturnValue('/tmp');

            const report = await collectChecks();
            expect(report.healthy).toBe(true);
        });

        it('reports unhealthy when a check fails', async () => {
            // DNS fails, rest pass
            mockExecFileSuccess('Version 1.50.0');
            mockDnsFailure();
            mockedAccessSync.mockReturnValue(undefined);
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            mockedTmpdir.mockReturnValue('/tmp');

            const report = await collectChecks();
            expect(report.healthy).toBe(false);
            expect(report.checks['network.dns_ok'].status).toBe('fail');
        });
    });

    // -----------------------------------------------------------------------
    // runDoctor — output & exit code
    // -----------------------------------------------------------------------
    describe('runDoctor', () => {
        it('outputs JSON by default and exits 0 when healthy', async () => {
            mockExecFileSuccess('Version 1.50.0');
            mockDnsSuccess();
            mockedAccessSync.mockReturnValue(undefined);
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            mockedTmpdir.mockReturnValue('/tmp');

            await runDoctor({});

            const parsed = JSON.parse(stdoutOutput) as DoctorReport;
            expect(parsed.healthy).toBe(true);
            expect(parsed.checks).toBeDefined();
            expect(process.exitCode).toBeUndefined();
        });

        it('exits 5 when a check fails (missing browser)', async () => {
            mockExecFileConditional([
                { argsMatch: '--version', stdout: 'Version 1.50.0' },
                { argsMatch: '--dry-run', fail: true },
                { argsMatch: 'launch-server', fail: true, stderr: 'crash' },
                { argsMatch: 'install', fail: true },
            ]);
            mockDnsSuccess();
            mockedAccessSync.mockReturnValue(undefined);
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            mockedTmpdir.mockReturnValue('/tmp');

            await runDoctor({});

            const parsed = JSON.parse(stdoutOutput) as DoctorReport;
            expect(parsed.healthy).toBe(false);
            expect(process.exitCode).toBe(5);
        });

        it('outputs text when format=text', async () => {
            mockExecFileSuccess('Version 1.50.0');
            mockDnsSuccess();
            mockedAccessSync.mockReturnValue(undefined);
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            mockedTmpdir.mockReturnValue('/tmp');

            await runDoctor({ format: 'text' });

            expect(stdoutOutput).toContain('[OK]');
            expect(stdoutOutput).toContain('node.version');
            expect(stdoutOutput).toContain('All checks passed.');
        });

        it('reports root+Linux warning in JSON output', async () => {
            vi.spyOn(process, 'getuid').mockReturnValue(0);
            const origSandbox = process.env.PLAYWRIGHT_CHROMIUM_SANDBOX;
            delete process.env.PLAYWRIGHT_CHROMIUM_SANDBOX;
            delete process.env.CHROMIUM_FLAGS;

            mockExecFileSuccess('Version 1.50.0');
            mockDnsSuccess();
            mockedAccessSync.mockReturnValue(undefined);
            mockedStatfsSync.mockReturnValue({
                bfree: 1_000_000,
                bsize: 4096,
            } as ReturnType<typeof fs.statfsSync>);
            mockedMkdtempSync.mockReturnValue('/tmp/distill-doctor-abc');
            mockedTmpdir.mockReturnValue('/tmp');

            await runDoctor({});

            const parsed = JSON.parse(stdoutOutput) as DoctorReport;
            expect(parsed.checks['platform.is_root'].status).toBe('warn');
            expect(parsed.checks['platform.is_root'].hint).toContain(
                'PLAYWRIGHT_CHROMIUM_SANDBOX',
            );

            if (origSandbox !== undefined)
                process.env.PLAYWRIGHT_CHROMIUM_SANDBOX = origSandbox;
        });
    });
});
