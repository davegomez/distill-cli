import { describe, expect, it } from 'vitest';
import type { Block } from '#/extractor/blocks.ts';
import { renderMarkdown } from '#/extractor/markdown.ts';

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

describe('renderMarkdown', () => {
    it('returns empty string for empty block array', () => {
        expect(renderMarkdown([])).toBe('');
    });

    // -----------------------------------------------------------------------
    // Headings
    // -----------------------------------------------------------------------

    it('renders heading blocks with correct # count', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'h1:0',
                tagPath: ['h1'],
                text: 'Title',
                headingLevel: 1,
                wordCount: 1,
            }),
            makeBlock({
                id: 'h2:0',
                tagPath: ['h2'],
                text: 'Subtitle',
                headingLevel: 2,
                wordCount: 1,
            }),
            makeBlock({
                id: 'h3:0',
                tagPath: ['h3'],
                text: 'Section',
                headingLevel: 3,
                wordCount: 1,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('# Title\n\n## Subtitle\n\n### Section');
    });

    it('renders h4–h6 with correct depth', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'h4:0',
                tagPath: ['h4'],
                text: 'Four',
                headingLevel: 4,
                wordCount: 1,
            }),
            makeBlock({
                id: 'h5:0',
                tagPath: ['h5'],
                text: 'Five',
                headingLevel: 5,
                wordCount: 1,
            }),
            makeBlock({
                id: 'h6:0',
                tagPath: ['h6'],
                text: 'Six',
                headingLevel: 6,
                wordCount: 1,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('#### Four\n\n##### Five\n\n###### Six');
    });

    // -----------------------------------------------------------------------
    // Paragraphs
    // -----------------------------------------------------------------------

    it('renders paragraphs with double-newline separation', () => {
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
        const md = renderMarkdown(blocks);
        expect(md).toBe('First paragraph\n\nSecond paragraph');
    });

    // -----------------------------------------------------------------------
    // Lists
    // -----------------------------------------------------------------------

    it('renders unordered list items', () => {
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
        const md = renderMarkdown(blocks);
        expect(md).toBe('- Alpha\n- Beta');
    });

    it('renders ordered list items', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'li:0',
                tagPath: ['ol', 'li'],
                text: 'First',
                wordCount: 1,
            }),
            makeBlock({
                id: 'li:1',
                tagPath: ['ol', 'li'],
                text: 'Second',
                wordCount: 1,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('1. First\n1. Second');
    });

    it('renders nested lists correctly', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'li:0',
                tagPath: ['ul', 'li'],
                text: 'Item 1',
                wordCount: 2,
                childBlockIds: ['li:1', 'li:2'],
            }),
            makeBlock({
                id: 'li:1',
                tagPath: ['ul', 'li', 'ul', 'li'],
                text: 'Sub A',
                wordCount: 2,
            }),
            makeBlock({
                id: 'li:2',
                tagPath: ['ul', 'li', 'ul', 'li'],
                text: 'Sub B',
                wordCount: 2,
            }),
            makeBlock({
                id: 'li:3',
                tagPath: ['ul', 'li'],
                text: 'Item 2',
                wordCount: 2,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('- Item 1\n  - Sub A\n  - Sub B\n- Item 2');
    });

    // -----------------------------------------------------------------------
    // Code blocks
    // -----------------------------------------------------------------------

    it('renders code blocks with fenced backticks', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'pre:0',
                tagPath: ['pre'],
                text: 'const x = 1;',
                wordCount: 3,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('```\nconst x = 1;\n```');
    });

    it('renders multiline code blocks', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'pre:0',
                tagPath: ['pre'],
                text: 'line 1\nline 2\nline 3',
                wordCount: 6,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('```\nline 1\nline 2\nline 3\n```');
    });

    // -----------------------------------------------------------------------
    // Images
    // -----------------------------------------------------------------------

    it('renders images as ![alt](src) by default', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                imageRefs: [
                    { alt: 'A photo', src: 'https://example.com/photo.jpg' },
                ],
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('![A photo](https://example.com/photo.jpg)');
    });

    it('renders images as ![[filename|alt]] in wikilinks mode', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                imageRefs: [
                    { alt: 'A photo', src: 'https://example.com/photo.jpg' },
                ],
            }),
        ];
        const md = renderMarkdown(blocks, { format: 'wikilinks' });
        expect(md).toBe('![[photo.jpg|A photo]]');
    });

    it('renders wikilinks image without alt when alt is empty', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                imageRefs: [{ alt: '', src: 'https://example.com/logo.png' }],
            }),
        ];
        const md = renderMarkdown(blocks, { format: 'wikilinks' });
        expect(md).toBe('![[logo.png]]');
    });

    it('rewrites image URLs using imagePathMap', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                imageRefs: [
                    { alt: 'Photo', src: 'https://example.com/photo.jpg' },
                ],
            }),
        ];
        const md = renderMarkdown(blocks, {
            imagePathMap: new Map([
                ['https://example.com/photo.jpg', '/local/photo.jpg'],
            ]),
        });
        expect(md).toBe('![Photo](/local/photo.jpg)');
    });

    it('rewrites image URLs in wikilinks mode', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                imageRefs: [
                    { alt: 'Shot', src: 'https://example.com/hero.png' },
                ],
            }),
        ];
        const md = renderMarkdown(blocks, {
            format: 'wikilinks',
            imagePathMap: new Map([
                ['https://example.com/hero.png', '/assets/hero.png'],
            ]),
        });
        expect(md).toBe('![[hero.png|Shot]]');
    });

    // -----------------------------------------------------------------------
    // Tables
    // -----------------------------------------------------------------------

    it('renders tables in GFM format', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'table:0',
                tagPath: ['table'],
                text: 'Name Age Alice 30',
                childBlockIds: ['th:0', 'th:1', 'td:0', 'td:1'],
            }),
            makeBlock({ id: 'th:0', tagPath: ['table', 'th'], text: 'Name' }),
            makeBlock({ id: 'th:1', tagPath: ['table', 'th'], text: 'Age' }),
            makeBlock({
                id: 'td:0',
                tagPath: ['table', 'td'],
                text: 'Alice',
            }),
            makeBlock({ id: 'td:1', tagPath: ['table', 'td'], text: '30' }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('| Name | Age |\n| --- | --- |\n| Alice | 30 |');
    });

    it('renders table with multiple data rows', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'table:0',
                tagPath: ['table'],
                text: '',
                childBlockIds: ['th:0', 'th:1', 'td:0', 'td:1', 'td:2', 'td:3'],
            }),
            makeBlock({ id: 'th:0', tagPath: ['table', 'th'], text: 'X' }),
            makeBlock({ id: 'th:1', tagPath: ['table', 'th'], text: 'Y' }),
            makeBlock({ id: 'td:0', tagPath: ['table', 'td'], text: '1' }),
            makeBlock({ id: 'td:1', tagPath: ['table', 'td'], text: '2' }),
            makeBlock({ id: 'td:2', tagPath: ['table', 'td'], text: '3' }),
            makeBlock({ id: 'td:3', tagPath: ['table', 'td'], text: '4' }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('| X | Y |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    });

    // -----------------------------------------------------------------------
    // Blockquotes
    // -----------------------------------------------------------------------

    it('renders blockquotes with > prefix', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'bq:0',
                tagPath: ['blockquote'],
                text: 'Quoted text',
                wordCount: 2,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('> Quoted text');
    });

    it('renders blockquotes with child paragraphs', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'bq:0',
                tagPath: ['blockquote'],
                text: '',
                childBlockIds: ['p:0', 'p:1'],
            }),
            makeBlock({
                id: 'p:0',
                tagPath: ['blockquote', 'p'],
                text: 'Line one',
                wordCount: 2,
            }),
            makeBlock({
                id: 'p:1',
                tagPath: ['blockquote', 'p'],
                text: 'Line two',
                wordCount: 2,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('> Line one\n>\n> Line two');
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
                text: 'More content',
                wordCount: 2,
            }),
        ];
        const md = renderMarkdown(blocks);
        expect(md).toBe('Content\n\nMore content');
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
        const md = renderMarkdown(blocks);
        expect(md).toBe('# Title\n\nIntro paragraph.\n\n```\nhello()\n```');
    });
});
