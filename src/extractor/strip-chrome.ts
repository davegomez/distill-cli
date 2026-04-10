import type { parseHTML } from 'linkedom';

type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

/**
 * Minimal DOM element interface — linkedom implements these but the
 * project does not include lib.dom types.
 */
interface DomElement {
    readonly tagName: string;
    readonly parentElement: DomElement | null;
    readonly childNodes: ArrayLike<DomNode> & Iterable<DomNode>;
    readonly textContent: string | null;
    readonly nodeType: number;
    getAttribute(name: string): string | null;
    querySelectorAll(
        selector: string,
    ): ArrayLike<DomElement> & Iterable<DomElement>;
    remove(): void;
}

interface DomNode {
    readonly nodeType: number;
    readonly textContent: string | null;
}

/** Counts of elements removed by category. */
export type StrippedCounts = {
    nav: number;
    header: number;
    footer: number;
    aside: number;
    scripts: number;
    styles: number;
    ads: number;
    cookie_banners: number;
    social_widgets: number;
};

/** Result returned by stripChrome. */
export interface StripChromeResult {
    stripped: StrippedCounts;
}

/** Remove an element from its parent and return 1 for counting. */
function remove(el: DomElement): 1 {
    el.remove();
    return 1;
}

/** Check if an element is a descendant of an article context. */
function isInsideArticle(el: DomElement): boolean {
    let parent = el.parentElement;
    while (parent) {
        const tag = parent.tagName.toLowerCase();
        if (tag === 'article') return true;
        if (
            tag === 'section' &&
            parent.getAttribute('role')?.toLowerCase() === 'article'
        )
            return true;
        parent = parent.parentElement;
    }
    return false;
}

/** Check if an element contains only links (and whitespace text). */
function containsOnlyLinks(el: DomElement): boolean {
    for (const child of el.childNodes) {
        if (child.nodeType === 3 /* TEXT_NODE */) {
            if ((child.textContent ?? '').trim().length > 0) return false;
        } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
            const tag = (child as DomElement).tagName.toLowerCase();
            if (tag !== 'a') return false;
        }
    }
    return el.querySelectorAll('a').length > 0;
}

/** Minimum number of links for the link-density sidebar heuristic. */
const LINK_DENSITY_MIN_LINKS = 5;

/** Minimum link-text-to-total-text ratio to classify as a link-dense sidebar. */
const LINK_DENSITY_THRESHOLD = 0.7;

/**
 * Compute link density: ratio of link text length to total text length.
 * Returns 0 for empty elements.
 */
function linkDensity(el: DomElement): number {
    const total = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (total.length === 0) return 0;

    let linkLen = 0;
    for (const a of el.querySelectorAll('a')) {
        linkLen += (a.textContent ?? '').replace(/\s+/g, ' ').trim().length;
    }
    return linkLen / total.length;
}

const COOKIE_RE = /cookie|consent|gdpr|ccpa/i;
const SOCIAL_RE = /share|social|tweet|facebook|linkedin/i;
const AD_RE = /\bads?\b|sponsor/i;

/**
 * Strip navigation chrome, scripts, styles, and common boilerplate
 * from a DOM tree before block extraction.
 *
 * Mutates the document in place per DESIGN.md §6 step 5.
 */
export function stripChrome(document: LinkedomDocument): StripChromeResult {
    const counts: StrippedCounts = {
        nav: 0,
        header: 0,
        footer: 0,
        aside: 0,
        scripts: 0,
        styles: 0,
        ads: 0,
        cookie_banners: 0,
        social_widgets: 0,
    };

    const q = (sel: string) =>
        [...document.querySelectorAll(sel)] as unknown as DomElement[];

    // 1. Scripts, styles, noscript — always remove
    for (const el of q('script')) counts.scripts += remove(el);
    for (const el of q('style')) counts.styles += remove(el);
    for (const el of q('noscript')) counts.scripts += remove(el);

    // 2. Nav elements and role="navigation"
    for (const el of q('nav')) counts.nav += remove(el);
    for (const el of q('[role="navigation"]')) {
        if (el.parentElement) counts.nav += remove(el);
    }

    // 3. Header — only body-level, not inside article/section[role=article]
    for (const el of q('header')) {
        if (!isInsideArticle(el)) counts.header += remove(el);
    }
    for (const el of q('[role="banner"]')) {
        if (el.parentElement && !isInsideArticle(el))
            counts.header += remove(el);
    }

    // 4. Footer and role="contentinfo"
    for (const el of q('footer')) counts.footer += remove(el);
    for (const el of q('[role="contentinfo"]')) {
        if (el.parentElement) counts.footer += remove(el);
    }

    // 5. Aside and role="complementary"
    for (const el of q('aside')) counts.aside += remove(el);
    for (const el of q('[role="complementary"]')) {
        if (el.parentElement) counts.aside += remove(el);
    }

    // 6. Cookie consent banners
    const body = document.body as unknown as DomElement | null;
    if (body) {
        for (const el of [...body.querySelectorAll('*')]) {
            const id = el.getAttribute('id') ?? '';
            const cls = el.getAttribute('class') ?? '';
            if (COOKIE_RE.test(id) || COOKIE_RE.test(cls)) {
                if (el.parentElement) counts.cookie_banners += remove(el);
            }
        }
    }

    // 7. Social share widgets — class matches social pattern AND contains only links
    if (body) {
        for (const el of [...body.querySelectorAll('*')]) {
            const cls = el.getAttribute('class') ?? '';
            if (SOCIAL_RE.test(cls) && containsOnlyLinks(el)) {
                if (el.parentElement) counts.social_widgets += remove(el);
            }
        }
    }

    // 8. Advertising — class or id matches ad pattern
    if (body) {
        for (const el of [...body.querySelectorAll('*')]) {
            const id = el.getAttribute('id') ?? '';
            const cls = el.getAttribute('class') ?? '';
            if (AD_RE.test(id) || AD_RE.test(cls)) {
                if (el.parentElement) counts.ads += remove(el);
            }
        }
    }

    // 9. Link-density sidebar detection — remove <div>/<ul> elements that
    //    look like navigation sidebars: high link density, no <p> prose,
    //    and enough links to rule out incidental link clusters.
    //    Two paths:
    //    A) link density > 70% with ≥ 5 links
    //    B) ≥ 8 links with short average link text (≤ 5 chars) and link
    //       density > 30% — catches version/category lists where separators
    //       dilute the raw density ratio.
    if (body) {
        for (const el of [...body.querySelectorAll('div, ul')]) {
            if (!el.parentElement) continue;
            if (isInsideArticle(el)) continue;

            const links = [...el.querySelectorAll('a')];
            if (links.length < LINK_DENSITY_MIN_LINKS) continue;

            // Presence of <p> descendants is a strong prose signal — keep.
            if ([...el.querySelectorAll('p')].length > 0) continue;

            const density = linkDensity(el);

            // Path A: straightforward high link density
            if (density > LINK_DENSITY_THRESHOLD) {
                counts.nav += remove(el);
                continue;
            }

            // Path B: version/category list — many short-text links
            if (links.length >= 8 && density > 0.2) {
                let totalLinkLen = 0;
                for (const a of links) {
                    totalLinkLen += (a.textContent ?? '')
                        .replace(/\s+/g, ' ')
                        .trim().length;
                }
                if (totalLinkLen / links.length <= 5) {
                    counts.nav += remove(el);
                }
            }
        }
    }

    return { stripped: counts };
}
