import type { parseHTML } from 'linkedom';
import { type Block, domToBlocks } from '#/extractor/blocks.ts';

type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

const SELECTOR_CHAIN = [
    'main',
    'article',
    '[role="main"]',
    '#content',
    '.post-content',
    '.entry-content',
] as const;

export interface SelectorChainResult {
    strategy: 'selector';
    selector: string;
    blocks: Block[];
}

export function extractWithSelectorChain(
    document: LinkedomDocument,
): SelectorChainResult | null {
    for (const selector of SELECTOR_CHAIN) {
        const el = document.querySelector(selector);
        if (el) {
            const blocks = domToBlocks(
                `<html><body>${el.innerHTML}</body></html>`,
            );
            return { strategy: 'selector', selector, blocks };
        }
    }
    return null;
}
