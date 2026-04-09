import { parseHTML } from 'linkedom';

/**
 * Minimal DOM interfaces — linkedom implements these but the project
 * does not include lib.dom types. Only the subset we actually use.
 */
interface DomNode {
    readonly nodeType: number;
    readonly childNodes: ArrayLike<DomNode> & Iterable<DomNode>;
    readonly textContent: string | null;
}

interface DomElement extends DomNode {
    readonly tagName: string;
    readonly parentElement: DomElement | null;
    hasAttribute(name: string): boolean;
    getAttribute(name: string): string | null;
}

/** Image reference found inside a block. */
export interface ImageRef {
    alt: string;
    src: string;
}

/** A single content block extracted from the DOM. */
export interface Block {
    id: string;
    text: string;
    tagPath: string[];
    headingLevel: number | null;
    linkDensity: number;
    wordCount: number;
    imageRefs: ImageRef[];
    visibility: 'visible' | 'hidden';
    childBlockIds: string[];
}

/** Elements that create a new block when encountered. */
const BLOCK_TAGS = new Set([
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'pre',
    'blockquote',
    'table',
    'td',
    'th',
    'figure',
    'article',
    'section',
    'div',
    'main',
    'header',
    'footer',
    'aside',
    'nav',
]);

/** Heading tags mapped to their level. */
const HEADING_LEVELS: Record<string, number> = {
    h1: 1,
    h2: 2,
    h3: 3,
    h4: 4,
    h5: 5,
    h6: 6,
};

/**
 * Determine if an element is hidden via the `hidden` attribute
 * or inline `display:none` / `visibility:hidden` styles.
 */
function isHidden(el: DomElement): boolean {
    if (el.hasAttribute('hidden')) return true;
    const style = el.getAttribute('style') ?? '';
    if (/display\s*:\s*none/i.test(style)) return true;
    if (/visibility\s*:\s*hidden/i.test(style)) return true;
    return false;
}

/** Build tag path from root to the given element (lowercase tag names). */
function buildTagPath(el: DomElement): string[] {
    const path: string[] = [];
    let current: DomElement | null = el;
    while (current && current.nodeType === 1) {
        path.unshift(current.tagName.toLowerCase());
        current = current.parentElement;
    }
    return path;
}

/** Count words in a string. */
function countWords(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
}

/**
 * Generate a stable block ID from the tag path and an index counter.
 * The ID is deterministic for the same HTML input.
 */
function makeBlockId(tagPath: string[], index: number): string {
    return `${tagPath.join('/')}:${index}`;
}

/**
 * Collect all direct text content from a node, including text inside
 * inline children, but NOT text inside nested block-level children.
 */
function collectDirectText(node: DomNode): string {
    const parts: string[] = [];
    for (const child of node.childNodes) {
        if (child.nodeType === 3 /* TEXT_NODE */) {
            parts.push(child.textContent ?? '');
        } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
            const tag = (child as DomElement).tagName.toLowerCase();
            if (!BLOCK_TAGS.has(tag)) {
                parts.push(collectDirectText(child));
            }
        }
    }
    return parts.join('');
}

/**
 * Collect the total length of text inside `<a>` tags that are
 * direct inline descendants (not inside nested block children).
 */
function collectLinkTextLength(node: DomNode): number {
    let total = 0;
    for (const child of node.childNodes) {
        if (child.nodeType === 1 /* ELEMENT_NODE */) {
            const el = child as DomElement;
            const tag = el.tagName.toLowerCase();
            if (BLOCK_TAGS.has(tag)) continue;
            if (tag === 'a') {
                total += (el.textContent ?? '').length;
            } else {
                total += collectLinkTextLength(el);
            }
        }
    }
    return total;
}

/**
 * Collect image references from inline descendants of a node
 * (not from nested block-level children).
 */
function collectImageRefs(node: DomNode): ImageRef[] {
    const refs: ImageRef[] = [];
    for (const child of node.childNodes) {
        if (child.nodeType === 1 /* ELEMENT_NODE */) {
            const el = child as DomElement;
            const tag = el.tagName.toLowerCase();
            if (BLOCK_TAGS.has(tag)) continue;
            if (tag === 'img') {
                refs.push({
                    alt: el.getAttribute('alt') ?? '',
                    src: el.getAttribute('src') ?? '',
                });
            } else {
                refs.push(...collectImageRefs(el));
            }
        }
    }
    return refs;
}

/**
 * Check if a div contains any direct text (text nodes with non-whitespace
 * content that are not inside a nested block-level child).
 */
function divHasDirectText(el: DomElement): boolean {
    for (const child of el.childNodes) {
        if (child.nodeType === 3 /* TEXT_NODE */) {
            if ((child.textContent ?? '').trim().length > 0) return true;
        } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
            const tag = (child as DomElement).tagName.toLowerCase();
            if (!BLOCK_TAGS.has(tag)) {
                if (collectDirectText(child).trim().length > 0) return true;
            }
        }
    }
    return false;
}

/** Determine the inherited visibility for an element. */
function resolveVisibility(
    el: DomElement,
    parentVisibility: 'visible' | 'hidden',
): 'visible' | 'hidden' {
    if (parentVisibility === 'hidden') return 'hidden';
    return isHidden(el) ? 'hidden' : 'visible';
}

interface TraversalContext {
    blocks: Block[];
    counter: number;
}

/**
 * Recursively traverse the DOM tree, creating blocks for block-level elements.
 * Returns the block IDs created by this subtree (for parent childBlockIds).
 */
function traverse(
    node: DomNode,
    parentVisibility: 'visible' | 'hidden',
    ctx: TraversalContext,
): string[] {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return [];

    const el = node as DomElement;
    const tag = el.tagName.toLowerCase();
    const visibility = resolveVisibility(el, parentVisibility);

    const shouldCreateBlock =
        BLOCK_TAGS.has(tag) && (tag !== 'div' || divHasDirectText(el));

    if (shouldCreateBlock) {
        const tagPath = buildTagPath(el);
        const id = makeBlockId(tagPath, ctx.counter++);
        const text = collectDirectText(el).replace(/\s+/g, ' ').trim();
        const linkTextLen = collectLinkTextLength(el);
        const totalTextLen = text.length;
        const linkDensity = totalTextLen > 0 ? linkTextLen / totalTextLen : 0;
        const headingLevel = HEADING_LEVELS[tag] ?? null;
        const imageRefs = collectImageRefs(el);
        const wordCount = countWords(text);

        // Traverse block-level children to get their IDs
        const childBlockIds: string[] = [];
        for (const child of el.childNodes) {
            if (child.nodeType === 1) {
                childBlockIds.push(...traverse(child, visibility, ctx));
            }
        }

        const block: Block = {
            id,
            text,
            tagPath,
            headingLevel,
            linkDensity,
            wordCount,
            imageRefs,
            visibility,
            childBlockIds,
        };

        ctx.blocks.push(block);
        return [id];
    }

    // Not a block-level element — traverse children looking for blocks
    const ids: string[] = [];
    for (const child of el.childNodes) {
        if (child.nodeType === 1) {
            ids.push(...traverse(child, visibility, ctx));
        }
    }
    return ids;
}

/**
 * Parse HTML and return an ordered array of Block objects
 * representing the content structure.
 */
export function domToBlocks(html: string): Block[] {
    const { document } = parseHTML(html);
    const ctx: TraversalContext = { blocks: [], counter: 0 };

    // linkedom treats fragments differently from full documents:
    // - Full HTML: document.body has the content
    // - Fragments: document.documentElement is the root element, body is empty
    // - Empty string: documentElement is null, body accessor throws
    const docEl = document.documentElement as DomElement | null;
    if (!docEl) return ctx.blocks;

    // body accessor is safe once documentElement exists
    const body = document.body as DomElement | null;

    // Prefer body when it has children (full document), otherwise use documentElement
    const root =
        body?.childNodes && [...body.childNodes].length > 0 ? body : docEl;

    traverse(root, 'visible', ctx);
    return ctx.blocks;
}
