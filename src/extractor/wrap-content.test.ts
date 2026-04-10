import { describe, expect, it } from 'vitest';
import { wrapContentFields, wrapTag } from './wrap-content.ts';

describe('wrapTag', () => {
    it('wraps a string in distilled_content tags', () => {
        expect(wrapTag('hello')).toBe(
            '<distilled_content>\nhello\n</distilled_content>',
        );
    });

    it('wraps empty string (empty tags)', () => {
        expect(wrapTag('')).toBe('<distilled_content>\n\n</distilled_content>');
    });
});

describe('wrapContentFields', () => {
    it('wraps content.markdown by default', () => {
        const output = {
            content: { markdown: '# Title' },
        };
        const result = wrapContentFields(output, false);
        expect((result.content as Record<string, string>).markdown).toBe(
            '<distilled_content>\n# Title\n</distilled_content>',
        );
    });

    it('--raw-content strips the wrapping', () => {
        const output = {
            content: { markdown: '# Title' },
        };
        const result = wrapContentFields(output, true);
        expect((result.content as Record<string, string>).markdown).toBe(
            '# Title',
        );
    });

    it('wraps content.html when present', () => {
        const output = {
            content: { markdown: '# Title', html: '<h1>Title</h1>' },
        };
        const result = wrapContentFields(output, false);
        const content = result.content as Record<string, string>;
        expect(content.html).toBe(
            '<distilled_content>\n<h1>Title</h1>\n</distilled_content>',
        );
        expect(content.markdown).toBe(
            '<distilled_content>\n# Title\n</distilled_content>',
        );
    });

    it('wraps content.text when present', () => {
        const output = {
            content: { markdown: '# Title', text: 'Title' },
        };
        const result = wrapContentFields(output, false);
        const content = result.content as Record<string, string>;
        expect(content.text).toBe(
            '<distilled_content>\nTitle\n</distilled_content>',
        );
    });

    it('wraps all three content fields when all are present', () => {
        const output = {
            content: {
                markdown: '# Title',
                html: '<h1>Title</h1>',
                text: 'Title',
            },
        };
        const result = wrapContentFields(output, false);
        const content = result.content as Record<string, string>;
        expect(content.markdown).toContain('<distilled_content>');
        expect(content.html).toContain('<distilled_content>');
        expect(content.text).toContain('<distilled_content>');
    });

    it('wraps empty content values (empty tags)', () => {
        const output = {
            content: { markdown: '' },
        };
        const result = wrapContentFields(output, false);
        expect((result.content as Record<string, string>).markdown).toBe(
            '<distilled_content>\n\n</distilled_content>',
        );
    });

    it('returns output unchanged when no content key exists', () => {
        const output = { url: 'https://example.com' };
        const result = wrapContentFields(output, false);
        expect(result).toEqual({ url: 'https://example.com' });
    });

    it('does not wrap non-content keys', () => {
        const output = {
            title: 'Test',
            content: { markdown: '# Title' },
        };
        const result = wrapContentFields(output, false);
        expect(result.title).toBe('Test');
    });
});
