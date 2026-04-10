import { ErrorCode } from '#/schema/errors.ts';
import { ExtractInputJsonSchema } from '#/schema/input.ts';
import { ExtractOutputJsonSchema } from '#/schema/output.ts';

const TOOL_VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

/** §11 — Flag metadata derived from ExtractInputSchema. */
interface FlagDef {
    name: string;
    type: string;
    default: unknown;
    description: string;
}

/** §11 — Argument metadata. */
interface ArgumentDef {
    name: string;
    type: string;
    required: boolean;
}

/** §11 — Full --help --json shape. */
export interface HelpJson {
    name: string;
    tool_version: string;
    schema_version: string;
    summary: string;
    usage: string;
    arguments: ArgumentDef[];
    flags: FlagDef[];
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    error_codes: string[];
    exit_codes: Record<string, string>;
}

/** Per-command metadata registry. */
interface CommandMeta {
    summary: string;
    usage: string;
    arguments: ArgumentDef[];
    hasSchemas: boolean;
}

const COMMAND_META: Record<string, CommandMeta> = {
    extract: {
        summary: 'Extract clean content from a web page',
        usage: 'distill extract <url> [flags]',
        arguments: [{ name: 'url', type: 'string', required: true }],
        hasSchemas: true,
    },
    setup: {
        summary: 'Install Playwright browsers (chromium default)',
        usage: 'distill setup',
        arguments: [],
        hasSchemas: false,
    },
    doctor: {
        summary:
            'JSON health check (browser, cache, sessions, libs, permissions)',
        usage: 'distill doctor',
        arguments: [],
        hasSchemas: false,
    },
    cache: {
        summary: 'Cache maintenance (clear, list)',
        usage: 'distill cache <clear|list> [flags]',
        arguments: [],
        hasSchemas: false,
    },
};

/** §3.2 — Flag name to schema field mapping (kebab-case CLI → snake_case schema). */
const FLAG_DESCRIPTIONS: Record<string, string> = {
    input: 'Canonical JSON input via stdin (-) or file (@path)',
    render: 'Use Playwright for JS-rendered pages',
    actions: 'Browser actions to execute before extraction (implies --render)',
    format: 'Output format (json, markdown, html)',
    selector: 'Explicit extraction target CSS selector (skips heuristics)',
    fields: 'Additive opt-in field groups (comma-separated)',
    download_images: 'Download referenced images to directory',
    max_image_size: 'Max image size to download',
    concurrency: 'Parallel image fetch count',
    download_images_format: 'Image path rewrite style (wikilinks or markdown)',
    cookies: 'Netscape cookie jar file (must be mode 0600)',
    header: 'Custom header (repeatable)',
    user_agent: 'Override User-Agent string',
    timeout: 'Request timeout in milliseconds',
    retries: 'Network retry count',
    max_age: 'Cache max-age duration',
    no_cache: 'Bypass cache read (still writes)',
    refresh: 'Force a fresh fetch and update cache',
    max_size: 'Max response body size',
    allow_private_network: 'Disable SSRF guard (explicit opt-in only)',
    dry_run: 'Validate and echo resolved canonical input without fetching',
    raw_content: 'Strip <distilled_content> wrapping from content fields',
};

/** Map schema field names to CLI flag names (--kebab-case). */
function toFlagName(field: string): string {
    return `--${field.replace(/_/g, '-')}`;
}

/** Map Zod JSON Schema type info to a simple type string. */
function jsonSchemaTypeToString(prop: Record<string, unknown>): string {
    if (prop.type === 'array') return 'array';
    if (prop.type === 'boolean') return 'boolean';
    if (prop.type === 'number' || prop.type === 'integer') return 'number';
    if (prop.enum) return 'string';
    return (prop.type as string) ?? 'string';
}

/** Build flag definitions from the ExtractInputSchema JSON Schema. */
function buildFlags(): FlagDef[] {
    const schema = ExtractInputJsonSchema as {
        properties: Record<string, Record<string, unknown>>;
    };
    const props = schema.properties;
    const flags: FlagDef[] = [];

    for (const [field, prop] of Object.entries(props)) {
        // url is a positional argument, not a flag
        if (field === 'url') continue;

        flags.push({
            name: toFlagName(field),
            type: jsonSchemaTypeToString(prop),
            default: prop.default ?? null,
            description: FLAG_DESCRIPTIONS[field] ?? '',
        });
    }

    return flags.sort((a, b) => a.name.localeCompare(b.name));
}

/** §10.1 — Exit code descriptions. */
const EXIT_CODE_DESCRIPTIONS: Record<string, string> = {
    '0': 'success',
    '1': 'extraction',
    '2': 'network',
    '3': 'validation',
    '4': 'action',
    '5': 'internal',
};

/**
 * §11 — Render the full --help --json shape for a command.
 * Generated from Zod schemas, never hand-written.
 */
export function renderHelpJson(command: string): HelpJson {
    const meta = COMMAND_META[command];
    if (!meta) {
        return renderHelpJson('extract');
    }

    const flags = meta.hasSchemas ? buildFlags() : [];
    const errorCodes = Object.values(ErrorCode).sort();

    return {
        name: command,
        tool_version: TOOL_VERSION,
        schema_version: SCHEMA_VERSION,
        summary: meta.summary,
        usage: meta.usage,
        arguments: meta.arguments,
        flags,
        input_schema: meta.hasSchemas
            ? (ExtractInputJsonSchema as Record<string, unknown>)
            : {},
        output_schema: meta.hasSchemas
            ? (ExtractOutputJsonSchema as Record<string, unknown>)
            : {},
        error_codes: errorCodes,
        exit_codes: EXIT_CODE_DESCRIPTIONS,
    };
}

/**
 * §11 — Render human-readable --help text for a command.
 */
export function renderHelpText(command: string): string {
    const meta = COMMAND_META[command];
    if (!meta) {
        return renderHelpText('extract');
    }

    const lines: string[] = [];
    lines.push(`distill ${command} — ${meta.summary}`);
    lines.push('');
    lines.push(`Usage: ${meta.usage}`);

    if (meta.arguments.length > 0) {
        lines.push('');
        lines.push('Arguments:');
        for (const arg of meta.arguments) {
            const req = arg.required ? '(required)' : '(optional)';
            lines.push(`  <${arg.name}>  ${arg.type}  ${req}`);
        }
    }

    if (meta.hasSchemas) {
        const flags = buildFlags();
        lines.push('');
        lines.push('Flags:');
        for (const flag of flags) {
            const def =
                flag.default !== null && flag.default !== undefined
                    ? ` (default: ${JSON.stringify(flag.default)})`
                    : '';
            lines.push(`  ${flag.name}  ${flag.type}${def}`);
            if (flag.description) {
                lines.push(`      ${flag.description}`);
            }
        }
    }

    lines.push('');
    lines.push('Exit codes:');
    for (const [code, desc] of Object.entries(EXIT_CODE_DESCRIPTIONS)) {
        lines.push(`  ${code}  ${desc}`);
    }

    lines.push('');
    return lines.join('\n');
}

/**
 * Return the set of schema field names from ExtractInputSchema,
 * excluding 'url' (which is a positional argument).
 * Useful for contract tests.
 */
export function getInputSchemaFields(): Set<string> {
    const schema = ExtractInputJsonSchema as {
        properties: Record<string, unknown>;
    };
    const fields = new Set(Object.keys(schema.properties));
    fields.delete('url');
    return fields;
}
