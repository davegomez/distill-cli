import { z } from 'zod';

// §4.1 — Extraction enums

export const ExtractionStrategyEnum = z.enum([
    'explicit',
    'selector',
    'heuristic',
]);

export const ExtractionConfidenceEnum = z.enum(['high', 'medium', 'low']);

export const ExtractionArchetypeEnum = z.enum(['article-blog', 'docs', 'news']);

// §4.1 — _meta object
const MetaSchema = z.object({
    schema_version: z.literal('1.0.0'),
    tool_version: z.string(),
    command: z.string(),
    fetched_at: z.string(),
    elapsed_ms: z.number(),
    http_status: z.number().int(),
    from_cache: z.boolean(),
});

// §4.1 — extraction object
const ExtractionSchema = z.object({
    strategy: ExtractionStrategyEnum,
    selector: z.string().nullable(),
    confidence: ExtractionConfidenceEnum,
    archetype: ExtractionArchetypeEnum,
});

// §4.1 — Minimal default output shape
export const ExtractOutputSchema = z.object({
    _meta: MetaSchema,
    url: z.string(),
    final_url: z.string(),
    title: z.string(),
    content: z.object({
        markdown: z.string(),
    }),
    word_count: z.number().int().min(0),
    extraction: ExtractionSchema,
    warnings: z.array(z.string()),
});

export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;

// §4.2 — Additive opt-in field group schemas

/** +meta — top-level metadata fields */
export const MetaGroupSchema = z.object({
    description: z.string().nullable(),
    author: z.string().nullable(),
    published: z.string().nullable(),
    language: z.string().nullable(),
    site_name: z.string().nullable(),
});

/** +links */
export const LinksGroupSchema = z.object({
    links: z.array(
        z.object({
            text: z.string(),
            href: z.string(),
            rel: z.string().optional(),
        }),
    ),
});

/** +images */
export const ImagesGroupSchema = z.object({
    images: z.array(
        z.object({
            alt: z.string(),
            src: z.string(),
            local_path: z.string().optional(),
        }),
    ),
});

/** +content.html — adds content.html key */
export const ContentHtmlSchema = z.object({
    content: z.object({
        html: z.string(),
    }),
});

/** +content.text — adds content.text key */
export const ContentTextSchema = z.object({
    content: z.object({
        text: z.string(),
    }),
});

/** +extraction.metrics */
export const ExtractionMetricsSchema = z.object({
    extraction: z.object({
        metrics: z.object({
            text_length: z.number().int(),
            text_html_ratio: z.number(),
            paragraphs: z.number().int(),
            link_density: z.number(),
        }),
    }),
});

/** +extraction.trace */
export const ExtractionTraceSchema = z.object({
    extraction: z.object({
        tried: z.array(z.string()),
        stripped: z.record(z.string(), z.unknown()),
    }),
});

/** +actions_trace — nested under _meta */
export const ActionsTraceSchema = z.object({
    _meta: z.object({
        actions_trace: z.array(
            z.object({
                index: z.number().int(),
                type: z.string(),
                result: z.string(),
                error: z.string().optional(),
                elapsed_ms: z.number(),
            }),
        ),
    }),
});

// §4.2 — Group registry mapping field group names to schemas
const fieldGroupRegistry: Record<string, z.ZodType> = {
    '+meta': MetaGroupSchema,
    '+links': LinksGroupSchema,
    '+images': ImagesGroupSchema,
    '+content.html': ContentHtmlSchema,
    '+content.text': ContentTextSchema,
    '+extraction.metrics': ExtractionMetricsSchema,
    '+extraction.trace': ExtractionTraceSchema,
    '+actions_trace': ActionsTraceSchema,
};

const allGroupNames = Object.keys(fieldGroupRegistry);

/**
 * §4.2 — Compose output schema with requested field groups.
 * `fields` is the array from --fields (e.g. ['+meta', '+links'] or ['all']).
 * Returns a Zod schema that merges the base output with the requested groups.
 */
export function composeOutputSchema(
    fields: string[],
): z.ZodType<ExtractOutput & Record<string, unknown>> {
    const groups = fields.includes('all') ? allGroupNames : fields;

    let schema: z.ZodType = ExtractOutputSchema;
    for (const name of groups) {
        const group = fieldGroupRegistry[name];
        if (group) {
            // Deep-merge by intersecting the base with each group
            schema = z.intersection(schema, group);
        }
    }
    return schema as z.ZodType<ExtractOutput & Record<string, unknown>>;
}

// §4.4 — Error shape
export const ExtractErrorSchema = z.object({
    _meta: z.object({
        schema_version: z.literal('1.0.0'),
        tool_version: z.string(),
        command: z.string(),
    }),
    error: z.object({
        code: z.string(),
        message: z.string(),
        hint: z.string().optional(),
        retryable: z.boolean(),
        retry_with: z.array(z.string()).optional(),
        received: z.record(z.string(), z.unknown()).optional(),
    }),
});

export type ExtractError = z.infer<typeof ExtractErrorSchema>;

// §11 — JSON Schema derived from ExtractOutputSchema for --help --json
export const ExtractOutputJsonSchema = z.toJSONSchema(ExtractOutputSchema, {
    unrepresentable: 'any',
    io: 'output',
});
