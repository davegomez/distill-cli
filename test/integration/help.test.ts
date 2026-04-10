import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('--help --json integration', () => {
    it('distill extract --help --json prints valid JSON matching §11', () => {
        const stdout = execFileSync(
            'npx',
            ['tsx', 'src/cli.ts', 'extract', '--help', '--json'],
            { encoding: 'utf-8', cwd: process.cwd() },
        );

        const help = JSON.parse(stdout);

        expect(help.name).toBe('extract');
        expect(help.tool_version).toBe('0.1.0');
        expect(help.schema_version).toBe('1.0.0');
        expect(help.summary).toBe('Extract clean content from a web page');
        expect(help.usage).toBe('distill extract <url> [flags]');
        expect(help.arguments).toEqual([
            { name: 'url', type: 'string', required: true },
        ]);
        expect(Array.isArray(help.flags)).toBe(true);
        expect(help.flags.length).toBeGreaterThan(0);
        expect(help.input_schema).toHaveProperty('type', 'object');
        expect(help.output_schema).toHaveProperty('type', 'object');
        expect(Array.isArray(help.error_codes)).toBe(true);
        expect(help.error_codes.length).toBe(28);
        expect(typeof help.exit_codes).toBe('object');
        expect(help.exit_codes['0']).toBe('success');
    });

    it('distill extract --help prints human-readable text', () => {
        const stdout = execFileSync(
            'npx',
            ['tsx', 'src/cli.ts', 'extract', '--help'],
            { encoding: 'utf-8', cwd: process.cwd() },
        );

        expect(stdout).toContain('distill extract');
        expect(stdout).toContain('Usage:');
        expect(stdout).toContain('Flags:');
        expect(stdout).toContain('Exit codes:');
    });

    it('distill setup --help --json returns valid help', () => {
        const stdout = execFileSync(
            'npx',
            ['tsx', 'src/cli.ts', 'setup', '--help', '--json'],
            { encoding: 'utf-8', cwd: process.cwd() },
        );

        const help = JSON.parse(stdout);
        expect(help.name).toBe('setup');
        expect(help.tool_version).toBe('0.1.0');
    });

    it('distill doctor --help --json returns valid help', () => {
        const stdout = execFileSync(
            'npx',
            ['tsx', 'src/cli.ts', 'doctor', '--help', '--json'],
            { encoding: 'utf-8', cwd: process.cwd() },
        );

        const help = JSON.parse(stdout);
        expect(help.name).toBe('doctor');
        expect(help.tool_version).toBe('0.1.0');
    });

    it('distill cache --help --json returns valid help', () => {
        const stdout = execFileSync(
            'npx',
            ['tsx', 'src/cli.ts', 'cache', '--help', '--json'],
            { encoding: 'utf-8', cwd: process.cwd() },
        );

        const help = JSON.parse(stdout);
        expect(help.name).toBe('cache');
        expect(help.tool_version).toBe('0.1.0');
    });
});
