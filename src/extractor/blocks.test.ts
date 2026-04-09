import { describe, expect, it } from 'vitest';
import { domToBlocks } from '#/extractor/blocks.ts';

describe('domToBlocks', () => {
    it('produces blocks with correct headingLevel and tagPath for article>h1+p', () => {
        const html = '<article><h1>Title</h1><p>body text</p></article>';
        const blocks = domToBlocks(html);

        const h1 = blocks.find((b) => b.headingLevel === 1);
        const p = blocks.find((b) => b.tagPath.at(-1) === 'p');

        expect(h1).toBeDefined();
        expect(h1?.text).toBe('Title');
        expect(h1?.headingLevel).toBe(1);
        expect(h1?.tagPath).toContain('article');
        expect(h1?.tagPath.at(-1)).toBe('h1');

        expect(p).toBeDefined();
        expect(p?.text).toBe('body text');
        expect(p?.headingLevel).toBeNull();
        expect(p?.tagPath).toContain('article');
        expect(p?.tagPath.at(-1)).toBe('p');
    });

    it('produces correct parent/child relationships for nested lists', () => {
        const html = `
			<ul>
				<li>Item 1
					<ul>
						<li>Sub-item A</li>
						<li>Sub-item B</li>
					</ul>
				</li>
				<li>Item 2</li>
			</ul>
		`;
        const blocks = domToBlocks(html);

        const parentLi = blocks.find(
            (b) => b.text.includes('Item 1') && b.tagPath.at(-1) === 'li',
        );
        expect(parentLi).toBeDefined();
        expect(parentLi?.childBlockIds.length).toBeGreaterThan(0);

        // Child blocks should exist and reference nested list items
        const childIds = new Set(parentLi?.childBlockIds);
        const children = blocks.filter((b) => childIds.has(b.id));
        expect(children.length).toBeGreaterThan(0);
    });

    it('calculates linkDensity correctly', () => {
        const html = '<p><a href="/x">linked</a> and plain</p>';
        const blocks = domToBlocks(html);
        const p = blocks.find((b) => b.tagPath.at(-1) === 'p');

        expect(p).toBeDefined();
        // "linked and plain" — link text "linked" is 6 chars, total is 16 chars
        expect(p?.linkDensity).toBeGreaterThan(0);
        expect(p?.linkDensity).toBeLessThan(1);
        expect(p?.linkDensity).toBeCloseTo(6 / 16, 2);
    });

    it('marks elements with style="display:none" as hidden', () => {
        const html = '<div style="display:none">hidden text</div>';
        const blocks = domToBlocks(html);
        const hidden = blocks.find((b) => b.text === 'hidden text');

        expect(hidden).toBeDefined();
        expect(hidden?.visibility).toBe('hidden');
    });

    it('marks elements with hidden attribute as hidden', () => {
        const html = '<p hidden>secret</p>';
        const blocks = domToBlocks(html);
        const hidden = blocks.find((b) => b.text === 'secret');

        expect(hidden).toBeDefined();
        expect(hidden?.visibility).toBe('hidden');
    });

    it('marks children of hidden elements as hidden', () => {
        const html =
            '<section style="display:none"><p>nested hidden</p></section>';
        const blocks = domToBlocks(html);
        const p = blocks.find((b) => b.tagPath.at(-1) === 'p');

        expect(p).toBeDefined();
        expect(p?.visibility).toBe('hidden');
    });

    it('captures image references in imageRefs', () => {
        const html = '<p>Text <img src="/photo.jpg" alt="A photo"> more</p>';
        const blocks = domToBlocks(html);
        const p = blocks.find((b) => b.tagPath.at(-1) === 'p');

        expect(p).toBeDefined();
        expect(p?.imageRefs).toHaveLength(1);
        expect(p?.imageRefs[0]).toEqual({
            alt: 'A photo',
            src: '/photo.jpg',
        });
    });

    it('does not create separate blocks for inline elements', () => {
        const html =
            '<p>Hello <strong>bold</strong> and <em>italic</em> text</p>';
        const blocks = domToBlocks(html);

        // Only one block (the <p>), no separate blocks for strong/em
        const pBlocks = blocks.filter((b) => b.tagPath.at(-1) === 'p');
        expect(pBlocks).toHaveLength(1);
        expect(pBlocks[0].text).toBe('Hello bold and italic text');

        // No blocks with strong or em as the final tag
        const inlineBlocks = blocks.filter(
            (b) => b.tagPath.at(-1) === 'strong' || b.tagPath.at(-1) === 'em',
        );
        expect(inlineBlocks).toHaveLength(0);
    });

    it('assigns correct wordCount', () => {
        const html = '<p>one two three four five</p>';
        const blocks = domToBlocks(html);
        expect(blocks[0].wordCount).toBe(5);
    });

    it('handles heading levels 1-6', () => {
        const html = `<html><body>
			<h1>H1</h1><h2>H2</h2><h3>H3</h3>
			<h4>H4</h4><h5>H5</h5><h6>H6</h6>
		</body></html>`;
        const blocks = domToBlocks(html);
        for (let i = 1; i <= 6; i++) {
            const h = blocks.find((b) => b.headingLevel === i);
            expect(h, `h${i} should exist`).toBeDefined();
            expect(h?.text).toBe(`H${i}`);
        }
    });

    it('generates stable IDs across identical runs', () => {
        const html = '<article><h1>T</h1><p>body</p></article>';
        const run1 = domToBlocks(html);
        const run2 = domToBlocks(html);
        expect(run1.map((b) => b.id)).toEqual(run2.map((b) => b.id));
    });

    it('div without direct text does not create a block', () => {
        const html = '<div><p>wrapped</p></div>';
        const blocks = domToBlocks(html);

        // Only the <p> should be a block, not the wrapper <div>
        expect(blocks).toHaveLength(1);
        expect(blocks[0].tagPath.at(-1)).toBe('p');
    });

    it('div with direct text creates a block', () => {
        const html = '<div>Some direct text</div>';
        const blocks = domToBlocks(html);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe('Some direct text');
        expect(blocks[0].tagPath.at(-1)).toBe('div');
    });

    it('marks visibility:hidden style as hidden', () => {
        const html = '<p style="visibility: hidden">ghost</p>';
        const blocks = domToBlocks(html);
        expect(blocks[0].visibility).toBe('hidden');
    });

    it('returns empty array for empty HTML', () => {
        expect(domToBlocks('')).toEqual([]);
    });
});
