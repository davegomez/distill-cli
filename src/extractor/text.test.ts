import { describe, expect, it } from 'vitest';
import type { Block } from '#/extractor/blocks.ts';
import { renderText } from '#/extractor/text.ts';

function makeBlock(
    overrides: Partial<Block> & Pick<Block, 'id' | 'tagPath'>,
): Block {
    return {
        text: '',
        headingLevel: null,
        linkDensity: 0,
        wordCount: 0,
        imageRefs: [],
        visibility: 'visible',
        childBlockIds: [],
        ...overrides,
    };
}

describe('renderText', () => {
    it('returns empty string for empty block array', () => {
        expect(renderText([])).toBe('');
    });

    // -----------------------------------------------------------------------
    // Paragraph separation
    // -----------------------------------------------------------------------

    it('separates paragraphs with double newlines', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'First paragraph',
                wordCount: 2,
            }),
            makeBlock({
                id: 'p:1',
                tagPath: ['p'],
                text: 'Second paragraph',
                wordCount: 2,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('First paragraph\n\nSecond paragraph');
    });

    it('separates headings from paragraphs with double newlines', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'h1:0',
                tagPath: ['h1'],
                text: 'Title',
                headingLevel: 1,
                wordCount: 1,
            }),
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'Body text',
                wordCount: 2,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Title\n\nBody text');
    });

    // -----------------------------------------------------------------------
    // Formatting removal
    // -----------------------------------------------------------------------

    it('strips heading formatting — just plain text', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'h2:0',
                tagPath: ['h2'],
                text: 'Section Title',
                headingLevel: 2,
                wordCount: 2,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Section Title');
        expect(text).not.toContain('#');
        expect(text).not.toContain('<');
    });

    it('does not include image references', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'Some text',
                wordCount: 2,
                imageRefs: [
                    { alt: 'A photo', src: 'https://example.com/photo.jpg' },
                ],
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Some text');
        expect(text).not.toContain('photo');
        expect(text).not.toContain('example.com');
    });

    it('does not include link URLs', () => {
        // Links are already resolved to text in the block representation,
        // so link URLs are not present in block.text
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'Click here for details',
                wordCount: 4,
                linkDensity: 0.5,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Click here for details');
        expect(text).not.toContain('http');
    });

    // -----------------------------------------------------------------------
    // Code blocks
    // -----------------------------------------------------------------------

    it('renders code blocks as plain text', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'pre:0',
                tagPath: ['pre'],
                text: 'const x = 1;',
                wordCount: 3,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('const x = 1;');
        expect(text).not.toContain('```');
    });

    // -----------------------------------------------------------------------
    // Lists
    // -----------------------------------------------------------------------

    it('renders list items as plain text lines', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'li:0',
                tagPath: ['ul', 'li'],
                text: 'Alpha',
                wordCount: 1,
            }),
            makeBlock({
                id: 'li:1',
                tagPath: ['ul', 'li'],
                text: 'Beta',
                wordCount: 1,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Alpha\n\nBeta');
        expect(text).not.toContain('-');
        expect(text).not.toContain('*');
    });

    it('renders nested list items', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'li:0',
                tagPath: ['ul', 'li'],
                text: 'Parent',
                wordCount: 1,
                childBlockIds: ['li:1'],
            }),
            makeBlock({
                id: 'li:1',
                tagPath: ['ul', 'li', 'ul', 'li'],
                text: 'Child',
                wordCount: 1,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toContain('Parent');
        expect(text).toContain('Child');
    });

    // -----------------------------------------------------------------------
    // Blockquotes
    // -----------------------------------------------------------------------

    it('renders blockquotes as plain text without > prefix', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'bq:0',
                tagPath: ['blockquote'],
                text: 'Quoted text',
                wordCount: 2,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Quoted text');
        expect(text).not.toContain('>');
    });

    // -----------------------------------------------------------------------
    // Tables
    // -----------------------------------------------------------------------

    it('renders table cells as space-separated text', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'table:0',
                tagPath: ['table'],
                text: '',
                childBlockIds: ['th:0', 'th:1', 'td:0', 'td:1'],
            }),
            makeBlock({ id: 'th:0', tagPath: ['table', 'th'], text: 'Name' }),
            makeBlock({ id: 'th:1', tagPath: ['table', 'th'], text: 'Age' }),
            makeBlock({ id: 'td:0', tagPath: ['table', 'td'], text: 'Alice' }),
            makeBlock({ id: 'td:1', tagPath: ['table', 'td'], text: '30' }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Name Age Alice 30');
        expect(text).not.toContain('|');
        expect(text).not.toContain('<');
    });

    // -----------------------------------------------------------------------
    // Empty blocks
    // -----------------------------------------------------------------------

    it('omits empty blocks', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'Content',
                wordCount: 1,
            }),
            makeBlock({ id: 'p:1', tagPath: ['p'], text: '' }),
            makeBlock({
                id: 'p:2',
                tagPath: ['p'],
                text: 'More',
                wordCount: 1,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Content\n\nMore');
    });

    // -----------------------------------------------------------------------
    // Figure captions
    // -----------------------------------------------------------------------

    it('renders figure caption text but not image refs', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                text: 'Caption text',
                wordCount: 2,
                imageRefs: [
                    { alt: 'Photo', src: 'https://example.com/img.jpg' },
                ],
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Caption text');
        expect(text).not.toContain('example.com');
    });

    // -----------------------------------------------------------------------
    // Mixed content
    // -----------------------------------------------------------------------

    it('renders mixed block types in order', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'h1:0',
                tagPath: ['h1'],
                text: 'Title',
                headingLevel: 1,
                wordCount: 1,
            }),
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'Intro paragraph.',
                wordCount: 2,
            }),
            makeBlock({
                id: 'pre:0',
                tagPath: ['pre'],
                text: 'hello()',
                wordCount: 1,
            }),
        ];
        const text = renderText(blocks);
        expect(text).toBe('Title\n\nIntro paragraph.\n\nhello()');
    });
});
