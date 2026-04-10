import type { Block } from '#/extractor/blocks.ts';

/**
 * Render an ordered array of content blocks as a cleaned semantic HTML string.
 */
export function renderHtml(blocks: Block[]): string {
    if (blocks.length === 0) return '';

    const blockMap = new Map<string, Block>();
    const childIds = new Set<string>();

    for (const block of blocks) {
        blockMap.set(block.id, block);
        for (const childId of block.childBlockIds) {
            childIds.add(childId);
        }
    }

    const rootBlocks = blocks.filter((b) => !childIds.has(b.id));
    const parts: string[] = [];

    let i = 0;
    while (i < rootBlocks.length) {
        const block = rootBlocks[i];

        // Group consecutive list items into <ul> or <ol>
        if (block.tagPath.at(-1) === 'li') {
            const listItems: Block[] = [];
            while (
                i < rootBlocks.length &&
                rootBlocks[i].tagPath.at(-1) === 'li'
            ) {
                listItems.push(rootBlocks[i]);
                i++;
            }
            parts.push(renderList(listItems, blockMap));
            continue;
        }

        const rendered = renderBlock(block, blockMap);
        if (rendered !== '') parts.push(rendered);
        i++;
    }

    if (parts.length === 0) return '';
    return `<article>${parts.join('')}</article>`;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function renderBlock(block: Block, blockMap: Map<string, Block>): string {
    if (isBlockEmpty(block, blockMap)) return '';

    if (block.headingLevel !== null) return renderHeading(block);

    const tag = block.tagPath.at(-1) ?? '';
    switch (tag) {
        case 'p':
            return renderParagraph(block);
        case 'li':
            return renderListItem(block, blockMap);
        case 'pre':
            return renderCodeBlock(block);
        case 'blockquote':
            return renderBlockquote(block, blockMap);
        case 'table':
            return renderTable(block, blockMap);
        case 'figure':
            return renderFigure(block);
        default:
            return renderContainer(block, blockMap);
    }
}

function isBlockEmpty(block: Block, blockMap: Map<string, Block>): boolean {
    if (block.text.length > 0) return false;
    if (block.imageRefs.length > 0) return false;
    return block.childBlockIds.every((id) => {
        const child = blockMap.get(id);
        return !child || isBlockEmpty(child, blockMap);
    });
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Heading
// ---------------------------------------------------------------------------

function renderHeading(block: Block): string {
    const level = block.headingLevel as number;
    return `<h${level}>${escapeHtml(block.text)}</h${level}>`;
}

// ---------------------------------------------------------------------------
// Paragraph
// ---------------------------------------------------------------------------

function renderParagraph(block: Block): string {
    const parts: string[] = [escapeHtml(block.text)];
    for (const img of block.imageRefs) {
        parts.push(renderImage(img));
    }
    return `<p>${parts.join('')}</p>`;
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

function renderImage(img: { alt: string; src: string }): string {
    return `<img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}">`;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function renderList(items: Block[], blockMap: Map<string, Block>): string {
    const ordered = items.length > 0 && isOrderedListItem(items[0]);
    const tag = ordered ? 'ol' : 'ul';
    const inner = items
        .map((item) => renderListItem(item, blockMap))
        .filter(Boolean)
        .join('');
    return `<${tag}>${inner}</${tag}>`;
}

function renderListItem(block: Block, blockMap: Map<string, Block>): string {
    if (isBlockEmpty(block, blockMap)) return '';

    const parts: string[] = [escapeHtml(block.text)];

    // Collect nested list items
    const nestedItems: Block[] = [];
    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        if (child.tagPath.at(-1) === 'li') {
            nestedItems.push(child);
        }
    }

    if (nestedItems.length > 0) {
        parts.push(renderList(nestedItems, blockMap));
    }

    return `<li>${parts.join('')}</li>`;
}

function isOrderedListItem(block: Block): boolean {
    const liIndex = block.tagPath.lastIndexOf('li');
    return liIndex > 0 && block.tagPath[liIndex - 1] === 'ol';
}

// ---------------------------------------------------------------------------
// Code block
// ---------------------------------------------------------------------------

function renderCodeBlock(block: Block): string {
    return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
}

// ---------------------------------------------------------------------------
// Blockquote
// ---------------------------------------------------------------------------

function renderBlockquote(block: Block, blockMap: Map<string, Block>): string {
    const parts: string[] = [];

    if (block.text) parts.push(`<p>${escapeHtml(block.text)}</p>`);

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        const rendered = renderBlock(child, blockMap);
        if (rendered) parts.push(rendered);
    }

    return `<blockquote>${parts.join('')}</blockquote>`;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function renderTable(block: Block, blockMap: Map<string, Block>): string {
    const headers: Block[] = [];
    const cells: Block[] = [];

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child) continue;
        const tag = child.tagPath.at(-1);
        if (tag === 'th') headers.push(child);
        else if (tag === 'td') cells.push(child);
    }

    const colCount = headers.length > 0 ? headers.length : cells.length;
    if (colCount === 0)
        return block.text ? `<p>${escapeHtml(block.text)}</p>` : '';

    const rows: string[] = [];

    if (headers.length > 0) {
        const ths = headers
            .map((h) => `<th>${escapeHtml(h.text)}</th>`)
            .join('');
        rows.push(`<thead><tr>${ths}</tr></thead>`);
    }

    const bodyRows: string[] = [];
    for (let i = 0; i < cells.length; i += colCount) {
        const row = cells.slice(i, i + colCount);
        const tds = row.map((c) => `<td>${escapeHtml(c.text)}</td>`).join('');
        bodyRows.push(`<tr>${tds}</tr>`);
    }
    if (bodyRows.length > 0) {
        rows.push(`<tbody>${bodyRows.join('')}</tbody>`);
    }

    return `<table>${rows.join('')}</table>`;
}

// ---------------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------------

function renderFigure(block: Block): string {
    const parts: string[] = [];
    for (const img of block.imageRefs) {
        parts.push(renderImage(img));
    }
    if (block.text) {
        parts.push(`<figcaption>${escapeHtml(block.text)}</figcaption>`);
    }
    return `<figure>${parts.join('')}</figure>`;
}

// ---------------------------------------------------------------------------
// Generic container
// ---------------------------------------------------------------------------

function renderContainer(block: Block, blockMap: Map<string, Block>): string {
    if (block.childBlockIds.length === 0) {
        const parts: string[] = [];
        if (block.text) parts.push(`<p>${escapeHtml(block.text)}</p>`);
        for (const img of block.imageRefs) {
            parts.push(renderImage(img));
        }
        return parts.join('');
    }

    const parts: string[] = [];
    if (block.text) parts.push(`<p>${escapeHtml(block.text)}</p>`);

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        const rendered = renderBlock(child, blockMap);
        if (rendered) parts.push(rendered);
    }

    return parts.join('');
}
