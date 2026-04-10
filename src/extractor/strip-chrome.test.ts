import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { stripChrome } from '#/extractor/strip-chrome.ts';

/** Wrap in full HTML document so linkedom creates a proper body. */
function doc(bodyInner: string) {
    return parseHTML(`<html><body>${bodyInner}</body></html>`).document;
}

function bodyText(document: ReturnType<typeof doc>): string {
    return (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('stripChrome', () => {
    it('removes <nav> elements', () => {
        const d = doc('<nav><a href="/">Home</a></nav><p>Content</p>');
        const result = stripChrome(d);

        expect(d.querySelectorAll('nav').length).toBe(0);
        expect(bodyText(d)).toBe('Content');
        expect(result.stripped.nav).toBe(1);
    });

    it('removes elements with role="navigation"', () => {
        const d = doc(
            '<div role="navigation"><a href="/">Home</a></div><p>Content</p>',
        );
        const result = stripChrome(d);

        expect(result.stripped.nav).toBe(1);
        expect(bodyText(d)).toBe('Content');
    });

    it('removes body-level <header> but preserves <article><header>', () => {
        const d = doc(
            `<header><h1>Site Title</h1></header>
			<article>
				<header><h2>Article Title</h2></header>
				<p>Article body</p>
			</article>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.header).toBe(1);
        expect(bodyText(d)).toContain('Article Title');
        expect(bodyText(d)).not.toContain('Site Title');
    });

    it('preserves <header> inside <section role="article">', () => {
        const d = doc(
            `<header><h1>Site Title</h1></header>
			<section role="article">
				<header><h2>Section Title</h2></header>
				<p>Body</p>
			</section>`,
        );
        stripChrome(d);

        expect(bodyText(d)).toContain('Section Title');
        expect(bodyText(d)).not.toContain('Site Title');
    });

    it('removes <script> and <style> elements', () => {
        const d = doc(
            `<script>alert("xss")</script>
			<style>body { color: red }</style>
			<noscript>Enable JS</noscript>
			<p>Content</p>`,
        );
        const result = stripChrome(d);

        expect(d.querySelectorAll('script').length).toBe(0);
        expect(d.querySelectorAll('style').length).toBe(0);
        expect(d.querySelectorAll('noscript').length).toBe(0);
        expect(result.stripped.scripts).toBe(2); // script + noscript
        expect(result.stripped.styles).toBe(1);
        expect(bodyText(d)).toBe('Content');
    });

    it('removes cookie banner divs', () => {
        const d = doc(
            `<div id="cookie-consent">We use cookies</div>
			<div class="gdpr-banner">Accept all</div>
			<p>Content</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.cookie_banners).toBe(2);
        expect(bodyText(d)).toBe('Content');
    });

    it('removes cookie banners matched by class containing ccpa', () => {
        const d = doc('<div class="ccpa-notice">Privacy</div><p>Content</p>');
        const result = stripChrome(d);

        expect(result.stripped.cookie_banners).toBe(1);
        expect(bodyText(d)).toBe('Content');
    });

    it('removes social share widgets that contain only links', () => {
        const d = doc(
            `<div class="social-share">
				<a href="https://twitter.com/share">Tweet</a>
				<a href="https://facebook.com/share">Share</a>
			</div>
			<p>Content</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.social_widgets).toBe(1);
        expect(bodyText(d)).toBe('Content');
    });

    it('does not remove social-classed elements that contain non-link content', () => {
        const d = doc(
            `<div class="social-feed">
				<p>Some content paragraph</p>
				<a href="#">Link</a>
			</div>
			<p>Main</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.social_widgets).toBe(0);
        expect(bodyText(d)).toContain('Some content paragraph');
    });

    it('removes ad containers', () => {
        const d = doc(
            `<div class="ad-container">Buy now!</div>
			<div id="sponsor-block">Sponsored</div>
			<div class="ads">Ad unit</div>
			<p>Content</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.ads).toBe(3);
        expect(bodyText(d)).toBe('Content');
    });

    it('does not match "ad" inside longer words like "loading"', () => {
        const d = doc(
            '<div class="loading-indicator">Loading...</div><p>Content</p>',
        );
        const result = stripChrome(d);

        expect(result.stripped.ads).toBe(0);
        expect(bodyText(d)).toContain('Loading...');
    });

    it('removes <footer> and role="contentinfo"', () => {
        const d = doc(
            `<p>Content</p>
			<footer>© 2024</footer>
			<div role="contentinfo">Legal</div>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.footer).toBe(2);
        expect(bodyText(d)).toBe('Content');
    });

    it('removes <aside> and role="complementary"', () => {
        const d = doc(
            `<p>Content</p>
			<aside>Sidebar</aside>
			<div role="complementary">Related</div>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.aside).toBe(2);
        expect(bodyText(d)).toBe('Content');
    });

    it('removes role="banner" elements', () => {
        const d = doc('<div role="banner">Site banner</div><p>Content</p>');
        const result = stripChrome(d);

        expect(result.stripped.header).toBe(1);
        expect(bodyText(d)).toBe('Content');
    });

    it('returns accurate stripping metadata counts', () => {
        const d = doc(
            `<script>x</script>
			<script>y</script>
			<style>.a{}</style>
			<nav><a href="/">Home</a></nav>
			<nav><a href="/about">About</a></nav>
			<header><h1>Site</h1></header>
			<footer>Footer 1</footer>
			<footer>Footer 2</footer>
			<aside>Side</aside>
			<div id="cookie-popup">Cookies</div>
			<div class="share-buttons"><a href="#">Share</a></div>
			<div class="ad">Ad</div>
			<div class="ads">Ads</div>
			<p>Content</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped).toEqual({
            scripts: 2,
            styles: 1,
            nav: 2,
            header: 1,
            footer: 2,
            aside: 1,
            cookie_banners: 1,
            social_widgets: 1,
            ads: 2,
        });
        expect(bodyText(d)).toBe('Content');
    });
});
