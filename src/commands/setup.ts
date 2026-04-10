import { execFile } from 'node:child_process';

/** Valid browser names for Playwright. */
const VALID_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
type BrowserName = (typeof VALID_BROWSERS)[number];

/** Options accepted by runSetup. */
export interface SetupOptions {
    browser?: string;
    force?: boolean;
    check?: boolean;
    json?: boolean;
}

/** Per-browser install status returned by --check. */
interface BrowserStatus {
    name: string;
    installed: boolean;
}

/** Result shape for JSON output. */
interface SetupResult {
    browsers: BrowserStatus[];
    action: 'check' | 'install';
    success: boolean;
    message: string;
}

/** Resolve the list of browsers to operate on. */
function resolveBrowsers(browser: string | undefined): BrowserName[] {
    const value = browser ?? 'chromium';
    if (value === 'all') return [...VALID_BROWSERS];
    if (!VALID_BROWSERS.includes(value as BrowserName)) {
        throw new Error(
            `Invalid browser "${value}". Choose: ${VALID_BROWSERS.join(', ')}, or all`,
        );
    }
    return [value as BrowserName];
}

/**
 * Check whether a Playwright browser is installed by running
 * `npx playwright install --dry-run <browser>` — Playwright exits 0
 * when already present and non-zero when missing.
 *
 * Falls back to checking `playwright --version` if dry-run is unavailable.
 */
function checkBrowserInstalled(browser: BrowserName): Promise<boolean> {
    return new Promise((resolve) => {
        const child = execFile(
            'npx',
            ['playwright', 'install', '--dry-run', browser],
            { env: { ...process.env } },
            (error) => {
                // If the command succeeds the browser is present
                resolve(!error);
            },
        );
        // Swallow output
        child.stdout?.resume();
        child.stderr?.resume();
    });
}

/** Run `npx playwright install <browser>` and stream or collect output. */
function installBrowser(
    browser: BrowserName,
    force: boolean,
    json: boolean,
): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
        const args = ['playwright', 'install', browser];
        if (force) args.push('--force');

        const child = execFile(
            'npx',
            args,
            { env: { ...process.env } },
            (error, stdout, stderr) => {
                const output = `${stdout}${stderr}`;
                resolve({ success: !error, output });
            },
        );

        // In text mode stream progress to stdout as it arrives
        if (!json) {
            child.stdout?.pipe(process.stdout);
            child.stderr?.pipe(process.stderr);
        }
    });
}

/**
 * §14.2 — `distill setup` implementation.
 *
 * Installs Playwright browsers (chromium by default).
 * Respects PLAYWRIGHT_BROWSERS_PATH via the inherited env.
 */
export async function runSetup(opts: SetupOptions): Promise<void> {
    const browsers = resolveBrowsers(opts.browser);

    // --check: report install status without installing
    if (opts.check) {
        const statuses: BrowserStatus[] = await Promise.all(
            browsers.map(async (name) => ({
                name,
                installed: await checkBrowserInstalled(name),
            })),
        );

        const result: SetupResult = {
            browsers: statuses,
            action: 'check',
            success: true,
            message: statuses.every((s) => s.installed)
                ? 'All requested browsers are installed'
                : 'Some browsers are not installed',
        };

        if (opts.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
            for (const s of statuses) {
                const icon = s.installed ? 'installed' : 'missing';
                process.stdout.write(`${s.name}: ${icon}\n`);
            }
        }
        return;
    }

    // Install mode
    const statuses: BrowserStatus[] = [];
    let allOk = true;

    for (const name of browsers) {
        if (!opts.json) {
            process.stdout.write(`Installing ${name}...\n`);
        }

        const { success } = await installBrowser(
            name,
            opts.force ?? false,
            opts.json ?? false,
        );

        statuses.push({ name, installed: success });
        if (!success) {
            allOk = false;
            if (!opts.json) {
                process.stderr.write(
                    `Failed to install ${name}. Run with --check to diagnose.\n`,
                );
            }
        }
    }

    if (opts.json) {
        const result: SetupResult = {
            browsers: statuses,
            action: 'install',
            success: allOk,
            message: allOk
                ? 'All browsers installed successfully'
                : 'Some browsers failed to install',
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }

    if (!allOk) {
        process.exitCode = 5;
    }
}
