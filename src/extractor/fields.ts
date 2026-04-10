import { invalidInputJson } from '#/schema/errors.ts';
import type { ExtractOutput } from '#/schema/output.ts';

/**
 * Full extraction result containing all possible field group data.
 * `runExtract` produces this internally; `resolveFields` picks
 * the requested subset.
 */
export interface FullExtractResult extends ExtractOutput {
    /** +meta group */
    description: string | null;
    author: string | null;
    published: string | null;
    language: string | null;
    site_name: string | null;

    /** +links group */
    links: Array<{ text: string; href: string; rel?: string }>;

    /** +images group */
    images: Array<{ alt: string; src: string; local_path?: string }>;

    /** +content.html — nested under content */
    content: ExtractOutput['content'] & { html: string; text: string };

    /** +extraction.metrics and +extraction.trace — nested under extraction */
    extraction: ExtractOutput['extraction'] & {
        metrics: {
            text_length: number;
            text_html_ratio: number;
            paragraphs: number;
            link_density: number;
        };
        tried: string[];
        stripped: Record<string, number>;
    };

    /** +actions_trace — nested under _meta */
    _meta: ExtractOutput['_meta'] & {
        actions_trace: Array<{
            index: number;
            type: string;
            result: string;
            error?: string;
            elapsed_ms: number;
        }>;
    };
}

const VALID_GROUPS = new Set([
    '+meta',
    '+links',
    '+images',
    '+content.html',
    '+content.text',
    '+extraction.metrics',
    '+extraction.trace',
    '+actions_trace',
    'all',
]);

const ALL_ADDITIVE_GROUPS = [
    '+meta',
    '+links',
    '+images',
    '+content.html',
    '+content.text',
    '+extraction.metrics',
    '+extraction.trace',
    '+actions_trace',
] as const;

/**
 * §4.2 — Resolve requested field groups against a full extraction result.
 * Returns a new object containing only the minimal default fields (§4.1)
 * plus the data for each requested group.
 *
 * @param requested - Field group names from --fields (e.g. ['+meta', '+links'] or ['all'])
 * @param result - The full extraction result with all group data populated
 */
export function resolveFields(
    requested: string[],
    result: FullExtractResult,
): Record<string, unknown> {
    // Validate all group names up front
    for (const name of requested) {
        if (!VALID_GROUPS.has(name)) {
            throw invalidInputJson(
                `Unknown field group: "${name}". Valid groups: ${[...VALID_GROUPS].join(', ')}`,
            );
        }
    }

    const groups: ReadonlySet<string> = requested.includes('all')
        ? new Set(ALL_ADDITIVE_GROUPS)
        : new Set(requested);

    // §4.1 — Always-included minimal default
    const output: Record<string, unknown> = {
        _meta: { ...result._meta },
        url: result.url,
        final_url: result.final_url,
        title: result.title,
        content: { markdown: result.content.markdown },
        word_count: result.word_count,
        extraction: {
            strategy: result.extraction.strategy,
            selector: result.extraction.selector,
            confidence: result.extraction.confidence,
            archetype: result.extraction.archetype,
        },
        warnings: result.warnings,
    };

    if (groups.size === 0) return output;

    // +meta — top-level fields
    if (groups.has('+meta')) {
        output.description = result.description;
        output.author = result.author;
        output.published = result.published;
        output.language = result.language;
        output.site_name = result.site_name;
    }

    // +links
    if (groups.has('+links')) {
        output.links = result.links;
    }

    // +images
    if (groups.has('+images')) {
        output.images = result.images;
    }

    // +content.html
    if (groups.has('+content.html')) {
        (output.content as Record<string, unknown>).html = result.content.html;
    }

    // +content.text
    if (groups.has('+content.text')) {
        (output.content as Record<string, unknown>).text = result.content.text;
    }

    // +extraction.metrics
    if (groups.has('+extraction.metrics')) {
        (output.extraction as Record<string, unknown>).metrics =
            result.extraction.metrics;
    }

    // +extraction.trace
    if (groups.has('+extraction.trace')) {
        const ext = output.extraction as Record<string, unknown>;
        ext.tried = result.extraction.tried;
        ext.stripped = result.extraction.stripped;
    }

    // +actions_trace
    if (groups.has('+actions_trace')) {
        (output._meta as Record<string, unknown>).actions_trace =
            result._meta.actions_trace;
    }

    return output;
}
