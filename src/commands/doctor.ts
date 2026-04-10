import { execFile } from 'node:child_process';
import { resolve as dnsResolve } from 'node:dns';
import {
    accessSync,
    constants,
    mkdtempSync,
    rmSync,
    statfsSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { resolveCacheDir } from '#/cache/sqlite.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorOptions {
    fix?: boolean;
    yes?: boolean;
    json?: boolean;
    format?: 'json' | 'text';
}

type CheckStatus = 'pass' | 'fail' | 'warn';

export interface CheckResult {
    status: CheckStatus;
    message: string;
    hint?: string;
    fixable?: boolean;
}

export interface DoctorReport {
    healthy: boolean;
    checks: Record<string, CheckResult>;
}

// ---------------------------------------------------------------------------
// Known missing-lib patterns → install hints
// ---------------------------------------------------------------------------

const MISSING_LIB_HINTS: Array<{ pattern: RegExp; hint: string }> = [
    { pattern: /libnss3\.so/i, hint: 'sudo apt-get install -y libnss3' },
    {
        pattern: /libatk-1\.0\.so/i,
        hint: 'sudo apt-get install -y libatk1.0-0',
    },
    {
        pattern: /libatk-bridge-2\.0\.so/i,
        hint: 'sudo apt-get install -y libatk-bridge2.0-0',
    },
    { pattern: /libcups\.so/i, hint: 'sudo apt-get install -y libcups2' },
    { pattern: /libdrm\.so/i, hint: 'sudo apt-get install -y libdrm2' },
    { pattern: /libdbus-1\.so/i, hint: 'sudo apt-get install -y libdbus-1-3' },
    {
        pattern: /libxkbcommon\.so/i,
        hint: 'sudo apt-get install -y libxkbcommon0',
    },
    { pattern: /libgbm\.so/i, hint: 'sudo apt-get install -y libgbm1' },
    { pattern: /libpango/i, hint: 'sudo apt-get install -y libpango-1.0-0' },
    { pattern: /libasound\.so/i, hint: 'sudo apt-get install -y libasound2' },
    { pattern: /libxrandr/i, hint: 'sudo apt-get install -y libxrandr2' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execFileAsync(
    cmd: string,
    args: string[],
    opts: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            cmd,
            args,
            { env: { ...process.env }, timeout: opts.timeout },
            (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                } else {
                    resolve({ stdout, stderr });
                }
            },
        );
        child.stdout?.resume();
        child.stderr?.resume();
    });
}

function dnsLookupAsync(hostname: string): Promise<void> {
    return new Promise((resolve, reject) => {
        dnsResolve(hostname, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/** Prompt user for yes/no confirmation. Returns true if yes. */
function confirm(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stderr,
        });
        rl.question(`${question} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}

function pass(message: string): CheckResult {
    return { status: 'pass', message };
}

function fail(message: string, hint?: string, fixable?: boolean): CheckResult {
    return { status: 'fail', message, hint, fixable };
}

function warn(message: string, hint?: string): CheckResult {
    return { status: 'warn', message, hint };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

export function checkNodeVersion(): CheckResult {
    const major = Number.parseInt(process.versions.node.split('.')[0], 10);
    if (major >= 24) {
        return pass(`v${process.versions.node}`);
    }
    return fail(
        `v${process.versions.node} (requires >=24)`,
        'Upgrade Node.js to version 24 or later.',
    );
}

export async function checkPlaywrightInstalled(): Promise<CheckResult> {
    try {
        await execFileAsync('npx', ['playwright', '--version'], {
            timeout: 10_000,
        });
        return pass('playwright package found');
    } catch {
        return fail('playwright not found', 'Run: pnpm add playwright');
    }
}

export async function checkChromiumPresent(): Promise<CheckResult> {
    try {
        await execFileAsync(
            'npx',
            ['playwright', 'install', '--dry-run', 'chromium'],
            { timeout: 10_000 },
        );
        // dry-run exits 0 when already installed
        return pass('chromium binary present');
    } catch {
        return fail(
            'chromium browser not installed',
            'Run: distill setup',
            true,
        );
    }
}

export async function checkChromiumLaunches(): Promise<CheckResult> {
    try {
        // Attempt to launch chromium briefly via Playwright's test runner
        await execFileAsync(
            'npx',
            ['playwright', 'launch-server', '--browser', 'chromium'],
            { timeout: 5_000 },
        );
        return pass('chromium launches successfully');
    } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? '';
        // Check for known missing library patterns
        for (const { pattern, hint } of MISSING_LIB_HINTS) {
            if (pattern.test(stderr)) {
                return fail(`chromium launch failed: missing library`, hint);
            }
        }
        // If it timed out, the browser actually started (that's good — it just
        // didn't exit within 5s because launch-server keeps running)
        const message = (err as { message?: string }).message ?? '';
        if (
            message.includes('TIMEOUT') ||
            message.includes('timed out') ||
            (err as { killed?: boolean }).killed
        ) {
            return pass('chromium launches successfully');
        }
        return fail(
            'chromium launch failed',
            `Run: distill doctor --fix to reinstall. Error: ${stderr.slice(0, 200) || message.slice(0, 200)}`,
            true,
        );
    }
}

export async function checkBrowserVersionMatch(): Promise<CheckResult> {
    try {
        const { stdout } = await execFileAsync(
            'npx',
            ['playwright', '--version'],
            { timeout: 10_000 },
        );
        const cliVersion = stdout.trim().replace(/^Version\s+/i, '');

        // Check installed browser version by reading the registry
        const { stdout: browserOutput } = await execFileAsync(
            'npx',
            ['playwright', 'install', '--dry-run', 'chromium'],
            { timeout: 10_000 },
        );

        // If dry-run succeeds with no action needed, versions match
        if (
            !browserOutput.includes('needs to be installed') &&
            !browserOutput.includes('out of date')
        ) {
            return pass(`browser matches playwright ${cliVersion}`);
        }
        return warn(
            `browser may not match playwright ${cliVersion}`,
            'Run: distill setup --force',
        );
    } catch {
        return warn('could not determine version match');
    }
}

export function checkCacheDirWritable(): CheckResult {
    const cacheDir = resolveCacheDir();
    try {
        accessSync(cacheDir, constants.W_OK);
        return pass(`${cacheDir} is writable`);
    } catch {
        return fail(
            `${cacheDir} is not writable`,
            `Ensure the directory exists and is writable: mkdir -p ${cacheDir}`,
            true,
        );
    }
}

export function checkCacheDirFreeSpace(): CheckResult {
    const cacheDir = resolveCacheDir();
    try {
        const stats = statfsSync(cacheDir);
        const freeMb = Math.floor((stats.bfree * stats.bsize) / (1024 * 1024));
        if (freeMb >= 500) {
            return pass(`${freeMb} MB free`);
        }
        return warn(
            `${freeMb} MB free (recommended: >=500 MB)`,
            'Free up disk space or move the cache directory.',
        );
    } catch {
        return warn('could not determine free space');
    }
}

export async function checkNetworkDns(): Promise<CheckResult> {
    try {
        await dnsLookupAsync('example.com');
        return pass('DNS resolves example.com');
    } catch {
        return fail(
            'DNS resolution failed for example.com',
            'Check your network connection.',
        );
    }
}

export function checkTmpdir(): CheckResult {
    const tmp = tmpdir();
    try {
        accessSync(tmp, constants.W_OK);
        // Verify we can actually write
        const testDir = mkdtempSync(join(tmp, 'distill-doctor-'));
        const testFile = join(testDir, 'probe');
        writeFileSync(testFile, 'ok');
        rmSync(testDir, { recursive: true });
        return pass(`${tmp} exists and is writable`);
    } catch {
        return fail(
            `${tmp} is not writable`,
            'Ensure the temp directory exists and has write permissions.',
        );
    }
}

export function checkIsRoot(): CheckResult {
    const isRoot = process.getuid?.() === 0;
    if (!isRoot) {
        return pass('not running as root');
    }
    const noSandbox =
        process.env.PLAYWRIGHT_CHROMIUM_SANDBOX === '0' ||
        process.env.CHROMIUM_FLAGS?.includes('--no-sandbox');
    if (noSandbox) {
        return warn('running as root with --no-sandbox');
    }
    return warn(
        'running as root without --no-sandbox',
        'Chromium may fail when run as root. Set PLAYWRIGHT_CHROMIUM_SANDBOX=0 or run as a non-root user.',
    );
}

// ---------------------------------------------------------------------------
// Fix actions
// ---------------------------------------------------------------------------

async function fixChromiumInstall(yes: boolean): Promise<void> {
    const sizeWarning = 'This will download the Chromium browser (~450 MB). ';
    if (!yes) {
        const confirmed = await confirm(`${sizeWarning}Proceed?`);
        if (!confirmed) {
            process.stderr.write('Skipped browser installation.\n');
            return;
        }
    } else {
        process.stderr.write(`${sizeWarning}Installing...\n`);
    }
    try {
        await execFileAsync('npx', ['playwright', 'install', 'chromium'], {
            timeout: 300_000,
        });
        process.stderr.write('Chromium installed successfully.\n');
    } catch (err: unknown) {
        const message =
            (err as { message?: string }).message ?? 'unknown error';
        process.stderr.write(`Failed to install chromium: ${message}\n`);
    }
}

async function fixCacheDir(yes: boolean): Promise<void> {
    const cacheDir = resolveCacheDir();
    if (!yes) {
        const confirmed = await confirm(`Create cache directory ${cacheDir}?`);
        if (!confirmed) {
            process.stderr.write('Skipped cache directory creation.\n');
            return;
        }
    }
    try {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(cacheDir, { recursive: true });
        process.stderr.write(`Created ${cacheDir}\n`);
    } catch (err: unknown) {
        const message =
            (err as { message?: string }).message ?? 'unknown error';
        process.stderr.write(`Failed to create cache directory: ${message}\n`);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Run all doctor checks and return a structured report. */
export async function collectChecks(): Promise<DoctorReport> {
    const checks: Record<string, CheckResult> = {};

    // Synchronous checks
    checks['node.version'] = checkNodeVersion();
    checks['cache.dir.writable'] = checkCacheDirWritable();
    checks['cache.dir.free_space_mb'] = checkCacheDirFreeSpace();
    checks['platform.tmpdir'] = checkTmpdir();
    checks['platform.is_root'] = checkIsRoot();

    // Async checks — run in parallel
    const [
        pwInstalled,
        chromiumPresent,
        chromiumLaunches,
        versionMatch,
        dnsOk,
    ] = await Promise.all([
        checkPlaywrightInstalled(),
        checkChromiumPresent(),
        checkChromiumLaunches(),
        checkBrowserVersionMatch(),
        checkNetworkDns(),
    ]);

    checks['playwright.installed'] = pwInstalled;
    checks['playwright.browser.chromium.present'] = chromiumPresent;
    checks['playwright.browser.chromium.launches'] = chromiumLaunches;
    checks['playwright.browser.version_match'] = versionMatch;
    checks['network.dns_ok'] = dnsOk;

    const healthy = Object.values(checks).every((c) => c.status !== 'fail');

    return { healthy, checks };
}

/** Format report as human-readable text. */
function formatText(report: DoctorReport): string {
    const lines: string[] = [];
    for (const [name, check] of Object.entries(report.checks)) {
        const icon =
            check.status === 'pass'
                ? 'OK'
                : check.status === 'warn'
                  ? 'WARN'
                  : 'FAIL';
        lines.push(`[${icon}] ${name}: ${check.message}`);
        if (check.hint) {
            lines.push(`       hint: ${check.hint}`);
        }
    }
    lines.push('');
    lines.push(report.healthy ? 'All checks passed.' : 'Some checks failed.');
    lines.push('');
    return lines.join('\n');
}

/**
 * §14.3 — `distill doctor` implementation.
 *
 * Performs environment health checks and reports results.
 * Default output is JSON (agent-friendly). Use --format text for terminals.
 * Exit 0 if healthy, exit 5 if any check fails.
 * --fix attempts remediation; --fix --yes skips confirmation prompts.
 */
export async function runDoctor(opts: DoctorOptions): Promise<void> {
    const report = await collectChecks();
    const useJson =
        opts.format !== 'text' &&
        (opts.json !== false ||
            opts.format === 'json' ||
            opts.format === undefined);

    // Apply fixes if requested
    if (opts.fix) {
        const checks = report.checks;

        if (checks['playwright.browser.chromium.present']?.status === 'fail') {
            await fixChromiumInstall(opts.yes ?? false);
        }

        if (
            checks['playwright.browser.chromium.launches']?.status === 'fail' &&
            checks['playwright.browser.chromium.present']?.status !== 'fail'
        ) {
            await fixChromiumInstall(opts.yes ?? false);
        }

        if (checks['cache.dir.writable']?.status === 'fail') {
            await fixCacheDir(opts.yes ?? false);
        }

        // Re-run checks after fixes
        const updated = await collectChecks();
        Object.assign(report, updated);
    }

    if (useJson) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        process.stdout.write(formatText(report));
    }

    if (!report.healthy) {
        process.exitCode = 5;
    }
}
