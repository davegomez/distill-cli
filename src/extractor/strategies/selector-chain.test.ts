import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractWithSelectorChain } from '#/extractor/strategies/selector-chain.ts';

describe('extractWithSelectorChain', () => {
    it('extracts from <main> when present', () => {
        const { document } = parseHTML(
            '<html><body><main><p>Hello world</p></main></body></html>',
        );
        const result = extractWithSelectorChain(document);
        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.strategy).toBe('selector');
        expect(result.selector).toBe('main');
        expect(result.blocks.length).toBeGreaterThan(0);
        expect(result.blocks.some((b) => b.text === 'Hello world')).toBe(true);
    });

    it('extracts from <article> when no <main>', () => {
        const { document } = parseHTML(
            '<html><body><article><p>Article content</p></article></body></html>',
        );
        const result = extractWithSelectorChain(document);
        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.selector).toBe('article');
        expect(result.blocks.some((b) => b.text === 'Article content')).toBe(
            true,
        );
    });

    it('extracts from [role="main"] when no main or article', () => {
        const { document } = parseHTML(
            '<html><body><div role="main"><p>Role main content</p></div></body></html>',
        );
        const result = extractWithSelectorChain(document);
        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.selector).toBe('[role="main"]');
        expect(result.blocks.some((b) => b.text === 'Role main content')).toBe(
            true,
        );
    });

    it('returns null when no selector in the chain matches', () => {
        const { document } = parseHTML(
            '<html><body><div><p>Plain content</p></div></body></html>',
        );
        const result = extractWithSelectorChain(document);
        expect(result).toBeNull();
    });

    it('extracts all sibling blocks from a multi-child container', () => {
        const { document } = parseHTML(
            '<html><body><main><h2>Heading One</h2><p>First paragraph</p><h2>Heading Two</h2><p>Second paragraph</p><p>Third paragraph</p></main></body></html>',
        );
        const result = extractWithSelectorChain(document);
        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.selector).toBe('main');
        expect(result.blocks.some((b) => b.text === 'Heading One')).toBe(true);
        expect(result.blocks.some((b) => b.text === 'First paragraph')).toBe(
            true,
        );
        expect(result.blocks.some((b) => b.text === 'Heading Two')).toBe(true);
        expect(result.blocks.some((b) => b.text === 'Second paragraph')).toBe(
            true,
        );
        expect(result.blocks.some((b) => b.text === 'Third paragraph')).toBe(
            true,
        );
        expect(result.blocks.length).toBe(5);
    });

    it('extracts from the first <article> when multiple exist', () => {
        const { document } = parseHTML(
            '<html><body><article><p>First article</p></article><article><p>Second article</p></article></body></html>',
        );
        const result = extractWithSelectorChain(document);
        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.selector).toBe('article');
        expect(result.blocks.some((b) => b.text === 'First article')).toBe(
            true,
        );
        expect(result.blocks.some((b) => b.text === 'Second article')).toBe(
            false,
        );
    });
});
