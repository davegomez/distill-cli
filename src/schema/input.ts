import { z } from 'zod';

// §5.1 — Wait targets
const WaitTarget = z.enum(['network-idle', 'load', 'domcontentloaded']);

// §5.1 — Scroll targets
const ScrollTarget = z.enum(['bottom', 'top']);

// §5.1/§5.2 — Action schemas as a discriminated union on `type`
// Targeting rule (§5.2): `selector` XOR `role`+`name` for element-targeting actions.

const WaitSelectorAction = z
    .object({
        type: z.literal('wait'),
        selector: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const WaitMsAction = z
    .object({
        type: z.literal('wait'),
        ms: z.number().int().min(1).max(10000),
        optional: z.boolean().optional(),
    })
    .strict();

const WaitForAction = z
    .object({
        type: z.literal('wait'),
        for: WaitTarget,
        optional: z.boolean().optional(),
    })
    .strict();

const WaitAction = z.union([WaitSelectorAction, WaitMsAction, WaitForAction]);

const ClickSelectorAction = z
    .object({
        type: z.literal('click'),
        selector: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const ClickRoleAction = z
    .object({
        type: z.literal('click'),
        role: z.string(),
        name: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const ClickAction = z.union([ClickSelectorAction, ClickRoleAction]);

const ScrollToAction = z
    .object({
        type: z.literal('scroll'),
        to: ScrollTarget,
        optional: z.boolean().optional(),
    })
    .strict();

const ScrollSelectorAction = z
    .object({
        type: z.literal('scroll'),
        selector: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const ScrollAction = z.union([ScrollToAction, ScrollSelectorAction]);

const FillAction = z
    .object({
        type: z.literal('fill'),
        selector: z.string(),
        value: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const PressAction = z
    .object({
        type: z.literal('press'),
        key: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const DismissSelectorAction = z
    .object({
        type: z.literal('dismiss'),
        selector: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const DismissRoleAction = z
    .object({
        type: z.literal('dismiss'),
        role: z.string(),
        name: z.string(),
        optional: z.boolean().optional(),
    })
    .strict();

const DismissAction = z.union([DismissSelectorAction, DismissRoleAction]);

export const ActionSchema = z.union([
    WaitAction,
    ClickAction,
    ScrollAction,
    FillAction,
    PressAction,
    DismissAction,
]);

export type Action = z.infer<typeof ActionSchema>;

// §3.2 — Output format enum
const FormatEnum = z.enum(['json', 'markdown', 'html']);

// §7.2 — Download images format enum
const DownloadImagesFormatEnum = z.enum(['wikilinks', 'markdown']);

// §4.2 — Field groups
const FieldGroup = z.enum([
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

// §3.2 — Canonical ExtractInput schema. Every flag maps 1:1 to a field.
export const ExtractInputSchema = z
    .object({
        url: z.string(),
        render: z.boolean().default(false),
        actions: z.array(ActionSchema).optional(),
        format: FormatEnum.default('json'),
        selector: z.string().optional(),
        fields: z.array(FieldGroup).optional(),
        download_images: z.string().optional(),
        max_image_size: z.string().default('10MB'),
        concurrency: z.number().int().min(1).default(5),
        download_images_format: DownloadImagesFormatEnum.optional(),
        cookies: z.string().optional(),
        header: z.array(z.string()).optional(),
        user_agent: z.string().optional(),
        timeout: z.number().int().min(1).default(30000),
        retries: z.number().int().min(0).default(2),
        max_age: z.string().optional(),
        no_cache: z.boolean().default(false),
        refresh: z.boolean().default(false),
        max_size: z.string().default('50MB'),
        allow_private_network: z.boolean().default(false),
        dry_run: z.boolean().default(false),
        raw_content: z.boolean().default(false),
    })
    .strict()
    .transform((data) => ({
        ...data,
        // §5.2: --actions implies --render
        render:
            data.render ||
            (data.actions !== undefined && data.actions.length > 0),
    }));

export type ExtractInput = z.infer<typeof ExtractInputSchema>;

/**
 * §3.1 — Merge parsed JSON input with individual flag values.
 * Precedence: positional URL wins, then flags, then JSON.
 * `flags` contains only the values explicitly set by the caller.
 */
export function resolveInput(
    jsonInput: Record<string, unknown>,
    flags: Record<string, unknown>,
): ExtractInput {
    const merged = { ...jsonInput, ...flags };
    return ExtractInputSchema.parse(merged);
}

// §11 — JSON Schema derived from ExtractInputSchema for --help --json
export const ExtractInputJsonSchema = z.toJSONSchema(ExtractInputSchema, {
    unrepresentable: 'any',
    io: 'input',
});
