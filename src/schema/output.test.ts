import { describe, expect, it } from 'vitest';
import {
    ActionsTraceSchema,
    ContentHtmlSchema,
    ContentTextSchema,
    composeOutputSchema,
    ExtractErrorSchema,
    ExtractionArchetypeEnum,
    ExtractionConfidenceEnum,
    ExtractionMetricsSchema,
    ExtractionStrategyEnum,
    ExtractionTraceSchema,
    ExtractOutputJsonSchema,
    ExtractOutputSchema,
    ImagesGroupSchema,
    LinksGroupSchema,
    MetaGroupSchema,
} from '#/schema/output.ts';

function makeMinimalOutput() {
    return {
        _meta: {
            schema_version: '1.0.0' as const,
            tool_version: '0.1.0',
            command: 'extract',
            fetched_at: '2026-04-09T14:23:00Z',
            elapsed_ms: 842,
            http_status: 200,
            from_cache: false,
        },
        url: 'https://example.com/post',
        final_url: 'https://example.com/post/',
        title: 'Post Title',
        content: {
            markdown:
                '<distilled_content>\n# Post Title\n\nBody text.\n</distilled_content>',
        },
        word_count: 42,
        extraction: {
            strategy: 'selector' as const,
            selector: 'main',
            confidence: 'high' as const,
            archetype: 'article-blog' as const,
        },
        warnings: [],
    };
}

describe('ExtractOutputSchema', () => {
    it('validates minimal default output', () => {
        const result = ExtractOutputSchema.safeParse(makeMinimalOutput());
        expect(result.success).toBe(true);
    });

    it('schema_version is always "1.0.0"', () => {
        const data = makeMinimalOutput();
        data._meta.schema_version = '2.0.0' as '1.0.0';
        const result = ExtractOutputSchema.safeParse(data);
        expect(result.success).toBe(false);
    });

    it('allows null selector in extraction', () => {
        const data = makeMinimalOutput();
        data.extraction.selector = null as unknown as string;
        const result = ExtractOutputSchema.safeParse(data);
        expect(result.success).toBe(true);
    });
});

describe('enum validation', () => {
    describe('ExtractionStrategyEnum', () => {
        it.each(['explicit', 'selector', 'heuristic'])('accepts "%s"', (v) => {
            expect(ExtractionStrategyEnum.safeParse(v).success).toBe(true);
        });

        it('rejects invalid strategy', () => {
            expect(ExtractionStrategyEnum.safeParse('magic').success).toBe(
                false,
            );
        });
    });

    describe('ExtractionConfidenceEnum', () => {
        it.each(['high', 'medium', 'low'])('accepts "%s"', (v) => {
            expect(ExtractionConfidenceEnum.safeParse(v).success).toBe(true);
        });

        it('rejects invalid confidence', () => {
            expect(
                ExtractionConfidenceEnum.safeParse('very-high').success,
            ).toBe(false);
        });
    });

    describe('ExtractionArchetypeEnum', () => {
        it.each(['article-blog', 'docs', 'news'])('accepts "%s"', (v) => {
            expect(ExtractionArchetypeEnum.safeParse(v).success).toBe(true);
        });

        it('rejects invalid archetype', () => {
            expect(ExtractionArchetypeEnum.safeParse('forum').success).toBe(
                false,
            );
        });
    });
});

describe('field group schemas', () => {
    it('MetaGroupSchema validates', () => {
        const result = MetaGroupSchema.safeParse({
            description: 'A post',
            author: 'Alice',
            published: '2026-01-01',
            language: 'en',
            site_name: 'Example',
        });
        expect(result.success).toBe(true);
    });

    it('LinksGroupSchema validates', () => {
        const result = LinksGroupSchema.safeParse({
            links: [
                { text: 'Home', href: 'https://example.com', rel: 'nofollow' },
            ],
        });
        expect(result.success).toBe(true);
    });

    it('ImagesGroupSchema validates', () => {
        const result = ImagesGroupSchema.safeParse({
            images: [{ alt: 'Logo', src: 'https://example.com/logo.png' }],
        });
        expect(result.success).toBe(true);
    });

    it('ContentHtmlSchema validates', () => {
        const result = ContentHtmlSchema.safeParse({
            content: { html: '<h1>Title</h1>' },
        });
        expect(result.success).toBe(true);
    });

    it('ContentTextSchema validates', () => {
        const result = ContentTextSchema.safeParse({
            content: { text: 'Plain text' },
        });
        expect(result.success).toBe(true);
    });

    it('ExtractionMetricsSchema validates', () => {
        const result = ExtractionMetricsSchema.safeParse({
            extraction: {
                metrics: {
                    text_length: 5000,
                    text_html_ratio: 0.45,
                    paragraphs: 12,
                    link_density: 0.1,
                },
            },
        });
        expect(result.success).toBe(true);
    });

    it('ExtractionTraceSchema validates', () => {
        const result = ExtractionTraceSchema.safeParse({
            extraction: {
                tried: ['main', 'article'],
                stripped: { nav: 2, footer: 1 },
            },
        });
        expect(result.success).toBe(true);
    });

    it('ActionsTraceSchema validates', () => {
        const result = ActionsTraceSchema.safeParse({
            _meta: {
                actions_trace: [
                    { index: 0, type: 'wait', result: 'ok', elapsed_ms: 100 },
                    {
                        index: 1,
                        type: 'click',
                        result: 'error',
                        error: 'not found',
                        elapsed_ms: 50,
                    },
                ],
            },
        });
        expect(result.success).toBe(true);
    });
});

describe('composeOutputSchema', () => {
    it('returns base schema when no groups requested', () => {
        const schema = composeOutputSchema([]);
        const result = schema.safeParse(makeMinimalOutput());
        expect(result.success).toBe(true);
    });

    it('adds +meta fields', () => {
        const schema = composeOutputSchema(['+meta']);
        const data = {
            ...makeMinimalOutput(),
            description: 'A post',
            author: 'Alice',
            published: '2026-01-01',
            language: 'en',
            site_name: 'Example',
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('adds +links fields', () => {
        const schema = composeOutputSchema(['+links']);
        const data = {
            ...makeMinimalOutput(),
            links: [{ text: 'Home', href: 'https://example.com' }],
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('adds +images fields', () => {
        const schema = composeOutputSchema(['+images']);
        const data = {
            ...makeMinimalOutput(),
            images: [{ alt: 'Logo', src: 'https://example.com/logo.png' }],
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('adds +content.html fields', () => {
        const schema = composeOutputSchema(['+content.html']);
        const data = {
            ...makeMinimalOutput(),
            content: {
                ...makeMinimalOutput().content,
                html: '<h1>Title</h1>',
            },
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('adds +content.text fields', () => {
        const schema = composeOutputSchema(['+content.text']);
        const data = {
            ...makeMinimalOutput(),
            content: {
                ...makeMinimalOutput().content,
                text: 'Plain text',
            },
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('adds +extraction.metrics fields', () => {
        const schema = composeOutputSchema(['+extraction.metrics']);
        const data = {
            ...makeMinimalOutput(),
            extraction: {
                ...makeMinimalOutput().extraction,
                metrics: {
                    text_length: 5000,
                    text_html_ratio: 0.45,
                    paragraphs: 12,
                    link_density: 0.1,
                },
            },
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('adds +extraction.trace fields', () => {
        const schema = composeOutputSchema(['+extraction.trace']);
        const data = {
            ...makeMinimalOutput(),
            extraction: {
                ...makeMinimalOutput().extraction,
                tried: ['main', 'article'],
                stripped: { nav: 2 },
            },
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('adds +actions_trace fields', () => {
        const schema = composeOutputSchema(['+actions_trace']);
        const data = {
            ...makeMinimalOutput(),
            _meta: {
                ...makeMinimalOutput()._meta,
                actions_trace: [
                    { index: 0, type: 'wait', result: 'ok', elapsed_ms: 100 },
                ],
            },
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('"all" includes every group', () => {
        const schema = composeOutputSchema(['all']);
        const data = {
            ...makeMinimalOutput(),
            // +meta
            description: 'A post',
            author: 'Alice',
            published: '2026-01-01',
            language: 'en',
            site_name: 'Example',
            // +links
            links: [{ text: 'Home', href: 'https://example.com' }],
            // +images
            images: [{ alt: 'Logo', src: 'https://example.com/logo.png' }],
            // +content.html + +content.text
            content: {
                ...makeMinimalOutput().content,
                html: '<h1>Title</h1>',
                text: 'Plain text',
            },
            // +extraction.metrics + +extraction.trace
            extraction: {
                ...makeMinimalOutput().extraction,
                metrics: {
                    text_length: 5000,
                    text_html_ratio: 0.45,
                    paragraphs: 12,
                    link_density: 0.1,
                },
                tried: ['main', 'article'],
                stripped: { nav: 2 },
            },
            // +actions_trace
            _meta: {
                ...makeMinimalOutput()._meta,
                actions_trace: [
                    { index: 0, type: 'wait', result: 'ok', elapsed_ms: 100 },
                ],
            },
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('ignores unknown group names', () => {
        const schema = composeOutputSchema(['+nonexistent']);
        const result = schema.safeParse(makeMinimalOutput());
        expect(result.success).toBe(true);
    });
});

describe('ExtractErrorSchema', () => {
    it('validates a well-formed error', () => {
        const result = ExtractErrorSchema.safeParse({
            _meta: {
                schema_version: '1.0.0',
                tool_version: '0.1.0',
                command: 'extract',
            },
            error: {
                code: 'BOT_BLOCKED',
                message: 'Target responded with 403 after 2 retries.',
                hint: 'Try --render, or provide --cookies.',
                retryable: false,
                retry_with: ['--render', '--cookies'],
                received: { url: 'https://example.com/post' },
            },
        });
        expect(result.success).toBe(true);
    });

    it('requires schema_version "1.0.0"', () => {
        const result = ExtractErrorSchema.safeParse({
            _meta: {
                schema_version: '2.0.0',
                tool_version: '0.1.0',
                command: 'extract',
            },
            error: {
                code: 'BOT_BLOCKED',
                message: 'Blocked',
                retryable: false,
            },
        });
        expect(result.success).toBe(false);
    });
});

describe('ExtractOutputJsonSchema', () => {
    it('is a valid JSON Schema object', () => {
        expect(ExtractOutputJsonSchema).toHaveProperty('$schema');
        expect(ExtractOutputJsonSchema).toHaveProperty('type', 'object');
        expect(ExtractOutputJsonSchema).toHaveProperty('properties');
    });

    it('contains core properties', () => {
        const props = (
            ExtractOutputJsonSchema as { properties: Record<string, unknown> }
        ).properties;
        expect(props).toHaveProperty('url');
        expect(props).toHaveProperty('_meta');
        expect(props).toHaveProperty('content');
        expect(props).toHaveProperty('extraction');
    });
});
