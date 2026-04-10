import { describe, expect, it } from 'vitest';
import {
    getInputSchemaFields,
    renderHelpJson,
    renderHelpText,
} from '#/cli/help.ts';
import { ErrorCode } from '#/schema/errors.ts';

describe('renderHelpJson', () => {
    it('returns the §11 shape for extract', () => {
        const help = renderHelpJson('extract');

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
        expect(typeof help.exit_codes).toBe('object');
    });

    it('error_codes list matches ErrorCode enum exactly', () => {
        const help = renderHelpJson('extract');
        const enumCodes = Object.values(ErrorCode).sort();
        expect(help.error_codes).toEqual(enumCodes);
    });

    it('input_schema is a valid JSON Schema', () => {
        const help = renderHelpJson('extract');
        const schema = help.input_schema;

        expect(schema).toHaveProperty('$schema');
        expect(schema).toHaveProperty('type', 'object');
        expect(schema).toHaveProperty('properties');
    });

    it('output_schema is a valid JSON Schema', () => {
        const help = renderHelpJson('extract');
        const schema = help.output_schema;

        expect(schema).toHaveProperty('$schema');
        expect(schema).toHaveProperty('type', 'object');
        expect(schema).toHaveProperty('properties');
    });

    it('exit_codes contains all five categories', () => {
        const help = renderHelpJson('extract');
        expect(help.exit_codes).toEqual({
            '0': 'success',
            '1': 'extraction',
            '2': 'network',
            '3': 'validation',
            '4': 'action',
            '5': 'internal',
        });
    });

    it('every flag has name, type, default, description', () => {
        const help = renderHelpJson('extract');
        for (const flag of help.flags) {
            expect(flag).toHaveProperty('name');
            expect(flag).toHaveProperty('type');
            expect(flag).toHaveProperty('default');
            expect(flag).toHaveProperty('description');
            expect(flag.name.startsWith('--')).toBe(true);
        }
    });

    it('returns valid help for setup, doctor, cache', () => {
        for (const cmd of ['setup', 'doctor', 'cache']) {
            const help = renderHelpJson(cmd);
            expect(help.name).toBe(cmd);
            expect(help.tool_version).toBe('0.1.0');
            expect(help.schema_version).toBe('1.0.0');
            expect(help.error_codes.length).toBeGreaterThan(0);
        }
    });

    it('falls back to extract for unknown commands', () => {
        const help = renderHelpJson('nonexistent');
        expect(help.name).toBe('extract');
    });
});

describe('renderHelpText', () => {
    it('returns human-readable text for extract', () => {
        const text = renderHelpText('extract');
        expect(text).toContain('distill extract');
        expect(text).toContain('Usage:');
        expect(text).toContain('Flags:');
        expect(text).toContain('Exit codes:');
        expect(text).toContain('<url>');
    });

    it('returns human-readable text for setup', () => {
        const text = renderHelpText('setup');
        expect(text).toContain('distill setup');
        expect(text).toContain('Usage:');
        expect(text).not.toContain('Flags:');
    });

    it('falls back to extract for unknown commands', () => {
        const text = renderHelpText('nonexistent');
        expect(text).toContain('distill extract');
    });
});

describe('contract: every flag has a corresponding schema field', () => {
    it('every flag in help output maps to a field in ExtractInputSchema', () => {
        const help = renderHelpJson('extract');
        const schemaFields = getInputSchemaFields();

        for (const flag of help.flags) {
            // Convert --kebab-case to snake_case
            const fieldName = flag.name.replace(/^--/, '').replace(/-/g, '_');
            expect(
                schemaFields.has(fieldName),
                `Flag ${flag.name} has no corresponding schema field "${fieldName}"`,
            ).toBe(true);
        }
    });

    it('every schema field (except url) has a corresponding flag', () => {
        const help = renderHelpJson('extract');
        const schemaFields = getInputSchemaFields();
        const flagFields = new Set(
            help.flags.map((f) => f.name.replace(/^--/, '').replace(/-/g, '_')),
        );

        for (const field of schemaFields) {
            expect(
                flagFields.has(field),
                `Schema field "${field}" has no corresponding flag`,
            ).toBe(true);
        }
    });
});
