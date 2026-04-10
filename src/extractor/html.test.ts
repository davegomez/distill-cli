import { describe, expect, it } from 'vitest';
import type { Block } from '#/extractor/blocks.ts';
import { renderHtml } from '#/extractor/html.ts';

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

describe('renderHtml', () => {
    it('returns empty string for empty block array', () => {
        expect(renderHtml([])).toBe('');
    });

    // -----------------------------------------------------------------------
    // Structure preservation
    // -----------------------------------------------------------------------

    it('wraps output in an <article> root element', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'Hello',
                wordCount: 1,
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toMatch(/^<article>.*<\/article>$/);
    });

    it('renders headings h1–h6', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'h1:0',
                tagPath: ['h1'],
                text: 'Title',
                headingLevel: 1,
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
        const html = renderHtml(blocks);
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<h3>Section</h3>');
    });

    it('renders paragraphs', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'First',
                wordCount: 1,
            }),
            makeBlock({
                id: 'p:1',
                tagPath: ['p'],
                text: 'Second',
                wordCount: 1,
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toContain('<p>First</p>');
        expect(html).toContain('<p>Second</p>');
    });

    it('renders unordered lists', () => {
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
        const html = renderHtml(blocks);
        expect(html).toContain('<ul><li>Alpha</li><li>Beta</li></ul>');
    });

    it('renders ordered lists', () => {
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
        const html = renderHtml(blocks);
        expect(html).toContain('<ol><li>First</li><li>Second</li></ol>');
    });

    it('renders nested lists', () => {
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
        const html = renderHtml(blocks);
        expect(html).toContain(
            '<ul><li>Parent<ul><li>Child</li></ul></li></ul>',
        );
    });

    it('renders code blocks as <pre><code>', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'pre:0',
                tagPath: ['pre'],
                text: 'const x = 1;',
                wordCount: 3,
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toContain('<pre><code>const x = 1;</code></pre>');
    });

    it('renders blockquotes', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'bq:0',
                tagPath: ['blockquote'],
                text: '',
                childBlockIds: ['p:0'],
            }),
            makeBlock({
                id: 'p:0',
                tagPath: ['blockquote', 'p'],
                text: 'Quoted text',
                wordCount: 2,
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toContain('<blockquote><p>Quoted text</p></blockquote>');
    });

    it('renders tables with thead and tbody', () => {
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
        const html = renderHtml(blocks);
        expect(html).toContain(
            '<thead><tr><th>Name</th><th>Age</th></tr></thead>',
        );
        expect(html).toContain(
            '<tbody><tr><td>Alice</td><td>30</td></tr></tbody>',
        );
    });

    it('renders images with src and alt', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                imageRefs: [
                    { alt: 'A photo', src: 'https://example.com/photo.jpg' },
                ],
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toContain(
            '<img src="https://example.com/photo.jpg" alt="A photo">',
        );
    });

    it('renders figures with caption', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'figure:0',
                tagPath: ['figure'],
                text: 'A caption',
                imageRefs: [
                    { alt: 'Photo', src: 'https://example.com/img.jpg' },
                ],
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toContain('<figure>');
        expect(html).toContain('<figcaption>A caption</figcaption>');
    });

    // -----------------------------------------------------------------------
    // Attribute stripping / escaping
    // -----------------------------------------------------------------------

    it('does not include style, class, id, or data-* attributes', () => {
        // The renderer builds HTML from blocks, not from raw DOM,
        // so presentational attributes are never carried over.
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: 'Clean output',
                wordCount: 2,
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).not.toMatch(/\bstyle=/);
        expect(html).not.toMatch(/\bclass=/);
        expect(html).not.toMatch(/\bid=/);
        expect(html).not.toMatch(/\bdata-/);
    });

    it('escapes HTML special characters in text', () => {
        const blocks: Block[] = [
            makeBlock({
                id: 'p:0',
                tagPath: ['p'],
                text: '<script>alert("xss")</script>',
                wordCount: 1,
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
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
        const html = renderHtml(blocks);
        expect(html).toBe('<article><p>Content</p><p>More</p></article>');
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
                text: 'Intro.',
                wordCount: 1,
            }),
            makeBlock({
                id: 'pre:0',
                tagPath: ['pre'],
                text: 'code()',
                wordCount: 1,
            }),
        ];
        const html = renderHtml(blocks);
        expect(html).toBe(
            '<article><h1>Title</h1><p>Intro.</p><pre><code>code()</code></pre></article>',
        );
    });
});
