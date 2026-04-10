import { describe, expect, it } from 'vitest';
import {
    ActionSchema,
    ExtractInputJsonSchema,
    ExtractInputSchema,
    resolveInput,
} from '#/schema/input.ts';

describe('ExtractInputSchema', () => {
    it('accepts minimal input (just url)', () => {
        const result = ExtractInputSchema.safeParse({
            url: 'https://example.com',
        });
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.url).toBe('https://example.com');
        expect(result.data.render).toBe(false);
        expect(result.data.format).toBe('json');
        expect(result.data.timeout).toBe(30000);
        expect(result.data.retries).toBe(2);
        expect(result.data.concurrency).toBe(5);
        expect(result.data.max_image_size).toBe('10MB');
        expect(result.data.max_size).toBe('50MB');
        expect(result.data.no_cache).toBe(false);
        expect(result.data.refresh).toBe(false);
        expect(result.data.allow_private_network).toBe(false);
        expect(result.data.dry_run).toBe(false);
        expect(result.data.raw_content).toBe(false);
    });

    it('accepts full input with every field set', () => {
        const full = {
            url: 'https://example.com/page',
            render: true,
            actions: [{ type: 'wait', ms: 1000 }],
            format: 'markdown',
            selector: 'main',
            fields: ['+meta', '+links'],
            download_images: '/tmp/imgs',
            max_image_size: '5MB',
            concurrency: 10,
            download_images_format: 'wikilinks',
            cookies: '/tmp/cookies.txt',
            header: ['X-Custom: value'],
            user_agent: 'MyBot/1.0',
            timeout: 60000,
            retries: 5,
            max_age: '2h',
            no_cache: true,
            refresh: true,
            max_size: '100MB',
            allow_private_network: true,
            dry_run: true,
            raw_content: true,
        };
        const result = ExtractInputSchema.safeParse(full);
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data).toMatchObject(full);
    });

    it('rejects unknown fields', () => {
        const result = ExtractInputSchema.safeParse({
            url: 'https://example.com',
            unknown_field: true,
        });
        expect(result.success).toBe(false);
    });

    describe('enum validation', () => {
        it('rejects invalid format', () => {
            const result = ExtractInputSchema.safeParse({
                url: 'https://example.com',
                format: 'xml',
            });
            expect(result.success).toBe(false);
        });

        it('rejects invalid download_images_format', () => {
            const result = ExtractInputSchema.safeParse({
                url: 'https://example.com',
                download_images_format: 'rst',
            });
            expect(result.success).toBe(false);
        });

        it('rejects invalid fields entry', () => {
            const result = ExtractInputSchema.safeParse({
                url: 'https://example.com',
                fields: ['+nonexistent'],
            });
            expect(result.success).toBe(false);
        });
    });
});

describe('ActionSchema', () => {
    describe('wait action', () => {
        it('accepts wait with selector', () => {
            const result = ActionSchema.safeParse({
                type: 'wait',
                selector: 'article h1',
            });
            expect(result.success).toBe(true);
        });

        it('accepts wait with ms', () => {
            const result = ActionSchema.safeParse({
                type: 'wait',
                ms: 2000,
            });
            expect(result.success).toBe(true);
        });

        it('accepts wait with for target', () => {
            for (const target of ['network-idle', 'load', 'domcontentloaded']) {
                const result = ActionSchema.safeParse({
                    type: 'wait',
                    for: target,
                });
                expect(result.success).toBe(true);
            }
        });

        it('rejects wait with invalid for target', () => {
            const result = ActionSchema.safeParse({
                type: 'wait',
                for: 'invalid-target',
            });
            expect(result.success).toBe(false);
        });

        it('rejects wait with ms exceeding 10s cap', () => {
            const result = ActionSchema.safeParse({
                type: 'wait',
                ms: 15000,
            });
            expect(result.success).toBe(false);
        });
    });

    describe('click action', () => {
        it('accepts click with selector', () => {
            const result = ActionSchema.safeParse({
                type: 'click',
                selector: '.load-more',
            });
            expect(result.success).toBe(true);
        });

        it('accepts click with role + name', () => {
            const result = ActionSchema.safeParse({
                type: 'click',
                role: 'button',
                name: 'Show more',
            });
            expect(result.success).toBe(true);
        });

        it('rejects click with neither selector nor role+name', () => {
            const result = ActionSchema.safeParse({ type: 'click' });
            expect(result.success).toBe(false);
        });
    });

    describe('scroll action', () => {
        it('accepts scroll with to target', () => {
            const result = ActionSchema.safeParse({
                type: 'scroll',
                to: 'bottom',
            });
            expect(result.success).toBe(true);
        });

        it('accepts scroll with selector', () => {
            const result = ActionSchema.safeParse({
                type: 'scroll',
                selector: '.infinite-scroll',
            });
            expect(result.success).toBe(true);
        });

        it('rejects scroll with invalid to target', () => {
            const result = ActionSchema.safeParse({
                type: 'scroll',
                to: 'middle',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('fill action', () => {
        it('accepts fill with selector and value', () => {
            const result = ActionSchema.safeParse({
                type: 'fill',
                selector: "input[name='q']",
                value: 'search term',
            });
            expect(result.success).toBe(true);
        });

        it('rejects fill without selector', () => {
            const result = ActionSchema.safeParse({
                type: 'fill',
                value: 'search term',
            });
            expect(result.success).toBe(false);
        });

        it('rejects fill without value', () => {
            const result = ActionSchema.safeParse({
                type: 'fill',
                selector: 'input',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('press action', () => {
        it('accepts press with key', () => {
            const result = ActionSchema.safeParse({
                type: 'press',
                key: 'Enter',
            });
            expect(result.success).toBe(true);
        });

        it('rejects press without key', () => {
            const result = ActionSchema.safeParse({ type: 'press' });
            expect(result.success).toBe(false);
        });
    });

    describe('dismiss action', () => {
        it('accepts dismiss with selector', () => {
            const result = ActionSchema.safeParse({
                type: 'dismiss',
                selector: '.cookie-banner .close',
                optional: true,
            });
            expect(result.success).toBe(true);
        });

        it('accepts dismiss with role + name', () => {
            const result = ActionSchema.safeParse({
                type: 'dismiss',
                role: 'button',
                name: 'Close',
            });
            expect(result.success).toBe(true);
        });

        it('rejects dismiss with neither selector nor role+name', () => {
            const result = ActionSchema.safeParse({ type: 'dismiss' });
            expect(result.success).toBe(false);
        });
    });

    it('rejects unknown action type', () => {
        const result = ActionSchema.safeParse({
            type: 'eval',
            code: 'alert(1)',
        });
        expect(result.success).toBe(false);
    });

    it('rejects actions specifying both selector and role+name', () => {
        const result = ActionSchema.safeParse({
            type: 'click',
            selector: '.btn',
            role: 'button',
            name: 'Click me',
        });
        expect(result.success).toBe(false);
    });
});

describe('resolveInput', () => {
    it('positional URL wins over JSON url', () => {
        const result = resolveInput(
            { url: 'https://json.example.com' },
            { url: 'https://flag.example.com' },
        );
        expect(result.url).toBe('https://flag.example.com');
    });

    it('flags override JSON fields', () => {
        const result = resolveInput(
            { url: 'https://example.com', format: 'json', timeout: 5000 },
            { format: 'markdown', timeout: 60000 },
        );
        expect(result.format).toBe('markdown');
        expect(result.timeout).toBe(60000);
    });

    it('JSON fields are used when flags are absent', () => {
        const result = resolveInput(
            {
                url: 'https://example.com',
                render: true,
                selector: 'main',
            },
            {},
        );
        expect(result.render).toBe(true);
        expect(result.selector).toBe('main');
    });

    it('applies defaults for missing fields', () => {
        const result = resolveInput({ url: 'https://example.com' }, {});
        expect(result.format).toBe('json');
        expect(result.timeout).toBe(30000);
        expect(result.retries).toBe(2);
    });
});

describe('ExtractInputJsonSchema', () => {
    it('is a valid JSON Schema object', () => {
        expect(ExtractInputJsonSchema).toHaveProperty('$schema');
        expect(ExtractInputJsonSchema).toHaveProperty('type', 'object');
        expect(ExtractInputJsonSchema).toHaveProperty('properties');
    });

    it('contains a url property', () => {
        const props = (
            ExtractInputJsonSchema as { properties: Record<string, unknown> }
        ).properties;
        expect(props).toHaveProperty('url');
    });
});
