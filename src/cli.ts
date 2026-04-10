import { parseArgs } from 'node:util';
import { renderHelpJson, renderHelpText } from '#/cli/help.ts';
import { readInput } from '#/cli/input.ts';
import { runCacheClear, runCacheList } from '#/commands/cache.ts';
import { runDoctor } from '#/commands/doctor.ts';
import { runExtract } from '#/commands/extract.ts';
import { runSetup } from '#/commands/setup.ts';
import { listSkills, showSkill } from '#/commands/skills.ts';
import { DistillError, unknownError } from '#/schema/errors.ts';
import { type ExtractInput, ExtractInputSchema } from '#/schema/input.ts';
import type { ExtractError } from '#/schema/output.ts';

/** Serialize a DistillError to the §4.4 JSON error shape. */
function serializeError(err: DistillError): ExtractError {
    const json = err.toJSON();
    return {
        _meta: {
            schema_version: '1.0.0',
            tool_version: '0.1.0',
            command: 'extract',
        },
        error: {
            code: json.code,
            message: json.message,
            hint: json.hint,
            retryable: json.retryable,
            retry_with: json.retry_with,
            received: json.received as Record<string, unknown> | undefined,
        },
    };
}

/** Write a human-readable one-liner to stderr when running in a terminal. */
function writeStderrHint(err: DistillError): void {
    if (process.stderr.isTTY) {
        process.stderr.write(`distill: ${err.code} — ${err.message}\n`);
    }
}

function fail(err: DistillError): never {
    writeStderrHint(err);
    process.stdout.write(`${JSON.stringify(serializeError(err), null, 2)}\n`);
    process.exit(err.exit_code);
}

/** Build a flags object from CLI values, containing only explicitly-set fields. */
function buildFlags(
    positionals: string[],
    values: Record<string, unknown>,
): Record<string, unknown> {
    const flags: Record<string, unknown> = {};
    const url = positionals[1];
    if (url) flags.url = url;
    if (values.selector) flags.selector = values.selector;
    if (values.render) flags.render = true;
    if (values.timeout) flags.timeout = Number(values.timeout as string);
    if (values.retries) flags.retries = Number(values.retries as string);
    if (values['user-agent']) flags.user_agent = values['user-agent'];
    if (values['max-size']) flags.max_size = values['max-size'];
    if (values['no-cache']) flags.no_cache = true;
    if (values.refresh) flags.refresh = true;
    if (values['allow-private-network']) flags.allow_private_network = true;
    if (values['dry-run']) flags.dry_run = true;
    if (values.header) flags.header = values.header;
    if (values.cookies) flags.cookies = values.cookies;
    if (values.format) flags.format = values.format;
    if (values.fields)
        flags.fields = (values.fields as string)
            .split(',')
            .map((s) => s.trim());
    return flags;
}

async function handleExtract(
    positionals: string[],
    values: Record<string, unknown>,
): Promise<void> {
    const flags = buildFlags(positionals, values);
    const inputSource = values.input as string | undefined;

    let input: ExtractInput;
    if (inputSource) {
        input = readInput(inputSource, flags);
    } else {
        if (!flags.url) {
            fail(
                unknownError(
                    'Missing required argument: <url>',
                    'Usage: distill extract <url> [flags]',
                ),
            );
        }
        input = ExtractInputSchema.parse(flags);
    }

    // §3.3 — --dry-run: echo resolved canonical input, skip fetch/extraction
    if (input.dry_run) {
        process.stdout.write(`${JSON.stringify(input, null, 2)}\n`);
        return;
    }

    const result = await runExtract(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

/** Handle --help / --help --json for any command. Returns true if help was handled. */
function handleHelp(command: string, values: Record<string, unknown>): boolean {
    if (!values.help) return false;

    if (values.json) {
        process.stdout.write(
            `${JSON.stringify(renderHelpJson(command), null, 2)}\n`,
        );
    } else {
        process.stdout.write(renderHelpText(command));
    }
    return true;
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            help: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
            input: { type: 'string' },
            selector: { type: 'string' },
            render: { type: 'boolean', default: false },
            timeout: { type: 'string' },
            retries: { type: 'string' },
            'user-agent': { type: 'string' },
            'max-size': { type: 'string' },
            'no-cache': { type: 'boolean', default: false },
            refresh: { type: 'boolean', default: false },
            'allow-private-network': { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
            header: { type: 'string', multiple: true },
            cookies: { type: 'string' },
            format: { type: 'string' },
            fields: { type: 'string' },
            browser: { type: 'string' },
            force: { type: 'boolean', default: false },
            check: { type: 'boolean', default: false },
            fix: { type: 'boolean', default: false },
            yes: { type: 'boolean', default: false },
            'older-than': { type: 'string' },
            url: { type: 'string' },
        },
        allowPositionals: true,
        strict: true,
    });

    const subcommand = positionals[0];

    if (!subcommand) {
        if (values.help) {
            process.stdout.write(
                'Usage: distill <command> [options]\n\nCommands: extract, setup, doctor, cache, skills\n\nUse --help on any command for details.\n',
            );
            return;
        }
        process.stdout.write(
            'Usage: distill <command> [options]\n\nCommands: extract, setup, doctor, cache, skills\n',
        );
        return;
    }

    if (subcommand === 'extract') {
        if (handleHelp('extract', values)) return;
        await handleExtract(positionals, values);
        return;
    }

    if (subcommand === 'setup') {
        if (handleHelp('setup', values)) return;
        await runSetup({
            browser: values.browser as string | undefined,
            force: values.force as boolean | undefined,
            check: values.check as boolean | undefined,
            json: values.json as boolean | undefined,
        });
        return;
    }

    if (subcommand === 'doctor') {
        if (handleHelp('doctor', values)) return;
        await runDoctor({
            fix: values.fix as boolean | undefined,
            yes: values.yes as boolean | undefined,
            json: values.json as boolean | undefined,
            format: values.format as 'json' | 'text' | undefined,
        });
        return;
    }

    if (subcommand === 'cache') {
        const cacheAction = positionals[1];
        if (handleHelp(subcommand, values)) return;

        if (cacheAction === 'list') {
            const entries = runCacheList();
            process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
            return;
        }

        if (cacheAction === 'clear') {
            const olderThan = values['older-than'] as string | undefined;
            const url = values.url as string | undefined;
            const yes = values.yes as boolean;

            // Safety confirmation for unfiltered clear
            if (!olderThan && !url && !yes) {
                const { createInterface } = await import('node:readline');
                const rl = createInterface({
                    input: process.stdin,
                    output: process.stderr,
                });
                const confirmed = await new Promise<boolean>((resolve) => {
                    rl.question(
                        'This will clear all cached entries. Proceed? [y/N] ',
                        (answer) => {
                            rl.close();
                            resolve(answer.trim().toLowerCase() === 'y');
                        },
                    );
                });
                if (!confirmed) {
                    process.stderr.write('Aborted.\n');
                    return;
                }
            }

            const result = runCacheClear({ olderThan, url });
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
        }

        process.stdout.write('Usage: distill cache <list|clear> [options]\n');
        process.exit(5);
    }

    if (subcommand === 'skills') {
        const skillsAction = positionals[1];

        if (skillsAction === 'list' || !skillsAction) {
            const skills = listSkills();
            process.stdout.write(`${JSON.stringify(skills, null, 2)}\n`);
            return;
        }

        if (skillsAction === 'show') {
            const skillName = positionals[2];
            if (!skillName) {
                process.stderr.write('Usage: distill skills show <name>\n');
                process.exit(3);
            }
            const content = showSkill(skillName);
            if (!content) {
                process.stderr.write(`Unknown skill: ${skillName}\n`);
                process.exit(3);
            }
            process.stdout.write(content);
            return;
        }

        process.stdout.write('Usage: distill skills <list|show <name>>\n');
        process.exit(5);
    }

    process.stdout.write(`Unknown command: ${subcommand}\n`);
    process.exit(5);
}

main().catch((err: unknown) => {
    if (err instanceof DistillError) {
        fail(err);
    }
    fail(unknownError(err instanceof Error ? err.message : String(err)));
});
