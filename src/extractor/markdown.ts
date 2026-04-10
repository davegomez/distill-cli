import type { Block, ImageRef } from '#/extractor/blocks.ts';

export interface MarkdownRenderOptions {
    imagePathMap?: Map<string, string>;
    format?: 'markdown' | 'wikilinks';
}

/**
 * Render an ordered array of content blocks as a markdown string.
 */
export function renderMarkdown(
    blocks: Block[],
    opts?: MarkdownRenderOptions,
): string {
    if (blocks.length === 0) return '';

    const options: MarkdownRenderOptions = opts ?? {};
    const blockMap = new Map<string, Block>();
    const childIds = new Set<string>();

    for (const block of blocks) {
        blockMap.set(block.id, block);
        for (const childId of block.childBlockIds) {
            childIds.add(childId);
        }
    }

    const rootBlocks = blocks.filter((b) => !childIds.has(b.id));

    // Render root blocks, tracking type for list grouping
    const rendered: { kind: 'list' | 'block'; text: string }[] = [];

    for (const block of rootBlocks) {
        const text = renderBlock(block, blockMap, options);
        if (text === '') continue;

        rendered.push({
            kind: block.tagPath.at(-1) === 'li' ? 'list' : 'block',
            text,
        });
    }

    // Group consecutive list items with single newlines;
    // separate everything else with double newlines.
    const parts: string[] = [];
    let i = 0;
    while (i < rendered.length) {
        if (rendered[i].kind === 'list') {
            const group: string[] = [];
            while (i < rendered.length && rendered[i].kind === 'list') {
                group.push(rendered[i].text);
                i++;
            }
            parts.push(group.join('\n'));
        } else {
            parts.push(rendered[i].text);
            i++;
        }
    }

    return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function renderBlock(
    block: Block,
    blockMap: Map<string, Block>,
    opts: MarkdownRenderOptions,
): string {
    if (isBlockEmpty(block, blockMap)) return '';

    if (block.headingLevel !== null) return renderHeading(block);

    const tag = block.tagPath.at(-1) ?? '';
    switch (tag) {
        case 'p':
            return renderParagraph(block, opts);
        case 'li':
            return renderListItem(block, blockMap, opts);
        case 'pre':
            return renderCodeBlock(block);
        case 'blockquote':
            return renderBlockquote(block, blockMap, opts);
        case 'table':
            return renderTable(block, blockMap);
        case 'figure':
            return renderFigure(block, opts);
        default:
            return renderContainer(block, blockMap, opts);
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

// ---------------------------------------------------------------------------
// Heading
// ---------------------------------------------------------------------------

function renderHeading(block: Block): string {
    const prefix = '#'.repeat(block.headingLevel as number);
    return `${prefix} ${block.text}`;
}

// ---------------------------------------------------------------------------
// Paragraph
// ---------------------------------------------------------------------------

function renderParagraph(block: Block, opts: MarkdownRenderOptions): string {
    const parts: string[] = [block.text];
    for (const img of block.imageRefs) {
        parts.push(renderImage(img, opts));
    }
    return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

function renderImage(img: ImageRef, opts: MarkdownRenderOptions): string {
    const src = opts.imagePathMap?.get(img.src) ?? img.src;

    if (opts.format === 'wikilinks') {
        const filename = src.split('/').pop() ?? src;
        return img.alt ? `![[${filename}|${img.alt}]]` : `![[${filename}]]`;
    }

    return `![${img.alt}](${src})`;
}

// ---------------------------------------------------------------------------
// List item
// ---------------------------------------------------------------------------

function renderListItem(
    block: Block,
    blockMap: Map<string, Block>,
    opts: MarkdownRenderOptions,
): string {
    const ordered = isOrderedListItem(block);
    const depth = listNestingDepth(block);
    const indent = '  '.repeat(depth);
    const prefix = ordered ? '1. ' : '- ';

    let result = `${indent}${prefix}${block.text}`;

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        if (child.tagPath.at(-1) === 'li') {
            result += `\n${renderListItem(child, blockMap, opts)}`;
        }
    }

    return result;
}

/** Check if the immediate list parent is `<ol>`. */
function isOrderedListItem(block: Block): boolean {
    const liIndex = block.tagPath.lastIndexOf('li');
    return liIndex > 0 && block.tagPath[liIndex - 1] === 'ol';
}

/** Zero-based nesting depth (count of ul/ol ancestors minus one). */
function listNestingDepth(block: Block): number {
    let count = 0;
    for (const tag of block.tagPath) {
        if (tag === 'ul' || tag === 'ol') count++;
    }
    return Math.max(0, count - 1);
}

// ---------------------------------------------------------------------------
// Code block
// ---------------------------------------------------------------------------

function renderCodeBlock(block: Block): string {
    // Language hints require class attributes not present in Block;
    // rendered without a language hint for now.
    return `\`\`\`\n${block.text}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Blockquote
// ---------------------------------------------------------------------------

function renderBlockquote(
    block: Block,
    blockMap: Map<string, Block>,
    opts: MarkdownRenderOptions,
): string {
    const parts: string[] = [];

    if (block.text) parts.push(block.text);

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        const rendered = renderBlock(child, blockMap, opts);
        if (rendered) parts.push(rendered);
    }

    return parts
        .map((part) =>
            part
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n'),
        )
        .join('\n>\n');
}

// ---------------------------------------------------------------------------
// Table (GFM)
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
    if (colCount === 0) return block.text;

    const lines: string[] = [];

    if (headers.length > 0) {
        lines.push(`| ${headers.map((h) => h.text).join(' | ')} |`);
        lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    }

    for (let i = 0; i < cells.length; i += colCount) {
        const row = cells.slice(i, i + colCount);
        lines.push(`| ${row.map((c) => c.text).join(' | ')} |`);
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------------

function renderFigure(block: Block, opts: MarkdownRenderOptions): string {
    const parts: string[] = [];
    for (const img of block.imageRefs) {
        parts.push(renderImage(img, opts));
    }
    if (block.text) {
        parts.push(parts.length > 0 ? `*${block.text}*` : block.text);
    }
    return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Generic container (article, section, div, etc.)
// ---------------------------------------------------------------------------

function renderContainer(
    block: Block,
    blockMap: Map<string, Block>,
    opts: MarkdownRenderOptions,
): string {
    if (block.childBlockIds.length === 0) {
        const parts: string[] = [];
        if (block.text) parts.push(block.text);
        for (const img of block.imageRefs) {
            parts.push(renderImage(img, opts));
        }
        return parts.join('\n');
    }

    const parts: string[] = [];
    if (block.text) parts.push(block.text);

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        const rendered = renderBlock(child, blockMap, opts);
        if (rendered) parts.push(rendered);
    }

    return parts.join('\n\n');
}
