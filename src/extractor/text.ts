import type { Block } from '#/extractor/blocks.ts';

/**
 * Render an ordered array of content blocks as plain text with
 * double-newline paragraph separators. No formatting, no links,
 * no image references.
 */
export function renderText(blocks: Block[]): string {
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

    for (const block of rootBlocks) {
        const text = renderBlock(block, blockMap);
        if (text !== '') parts.push(text);
    }

    return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function renderBlock(block: Block, blockMap: Map<string, Block>): string {
    if (isBlockEmpty(block, blockMap)) return '';

    const tag = block.tagPath.at(-1) ?? '';
    switch (tag) {
        case 'li':
            return renderListItem(block, blockMap);
        case 'blockquote':
            return renderBlockquote(block, blockMap);
        case 'table':
            return renderTable(block, blockMap);
        case 'figure':
            // Figures only have caption text; images are excluded in text mode
            return block.text;
        default:
            return renderContainer(block, blockMap);
    }
}

function isBlockEmpty(block: Block, blockMap: Map<string, Block>): boolean {
    if (block.text.length > 0) return false;
    return block.childBlockIds.every((id) => {
        const child = blockMap.get(id);
        return !child || isBlockEmpty(child, blockMap);
    });
}

// ---------------------------------------------------------------------------
// List item
// ---------------------------------------------------------------------------

function renderListItem(block: Block, blockMap: Map<string, Block>): string {
    const parts: string[] = [];
    if (block.text) parts.push(block.text);

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        if (child.tagPath.at(-1) === 'li') {
            const rendered = renderListItem(child, blockMap);
            if (rendered) parts.push(rendered);
        }
    }

    return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Blockquote
// ---------------------------------------------------------------------------

function renderBlockquote(block: Block, blockMap: Map<string, Block>): string {
    const parts: string[] = [];
    if (block.text) parts.push(block.text);

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        const rendered = renderBlock(child, blockMap);
        if (rendered) parts.push(rendered);
    }

    return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function renderTable(block: Block, blockMap: Map<string, Block>): string {
    const cells: string[] = [];

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child) continue;
        if (child.text) cells.push(child.text);
    }

    return cells.join(' ');
}

// ---------------------------------------------------------------------------
// Generic container
// ---------------------------------------------------------------------------

function renderContainer(block: Block, blockMap: Map<string, Block>): string {
    if (block.childBlockIds.length === 0) {
        return block.text;
    }

    const parts: string[] = [];
    if (block.text) parts.push(block.text);

    for (const childId of block.childBlockIds) {
        const child = blockMap.get(childId);
        if (!child || isBlockEmpty(child, blockMap)) continue;
        const rendered = renderBlock(child, blockMap);
        if (rendered) parts.push(rendered);
    }

    return parts.join('\n\n');
}
