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

    it('removes link-dense sidebar via path A (>70% link density)', () => {
        const d = doc(
            `<div>
                <a href="/a">Home</a>
                <a href="/b">About</a>
                <a href="/c">Docs</a>
                <a href="/d">Blog</a>
                <a href="/e">FAQ</a>
            </div>
            <p>Main content</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.nav).toBe(1);
        expect(bodyText(d)).toBe('Main content');
    });

    it('removes version-list sidebar via path B (many short links)', () => {
        const d = doc(
            `<div>
                Supported Versions:
                <a href="/v18">18</a> /
                <a href="/v17">17</a> /
                <a href="/v16">16</a> /
                <a href="/v15">15</a> /
                <a href="/v14">14</a> /
                <a href="/v13">13</a> /
                <a href="/v12">12</a> /
                <a href="/v11">11</a>
            </div>
            <p>Article body</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.nav).toBe(1);
        expect(bodyText(d)).toBe('Article body');
    });

    it('preserves link-dense content inside <article>', () => {
        const d = doc(
            `<article>
                <div>
                    <a href="/a">One</a> /
                    <a href="/b">Two</a> /
                    <a href="/c">Three</a> /
                    <a href="/d">Four</a> /
                    <a href="/e">Five</a> /
                    <a href="/f">Six</a> /
                    <a href="/g">Seven</a> /
                    <a href="/h">Eight</a>
                </div>
            </article>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.nav).toBe(0);
        expect(bodyText(d)).toContain('One');
    });

    it('preserves div with links when <p> descendants exist', () => {
        const d = doc(
            `<div>
                <p>See the following references for more info:</p>
                <a href="/a">Link 1</a>
                <a href="/b">Link 2</a>
                <a href="/c">Link 3</a>
                <a href="/d">Link 4</a>
                <a href="/e">Link 5</a>
            </div>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.nav).toBe(0);
        expect(bodyText(d)).toContain('See the following');
    });

    it('preserves div with fewer than 5 links', () => {
        const d = doc(
            `<div>
                <a href="/a">A</a> / <a href="/b">B</a> / <a href="/c">C</a>
            </div>
            <p>Content</p>`,
        );
        const result = stripChrome(d);

        expect(result.stripped.nav).toBe(0);
        expect(bodyText(d)).toContain('A');
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
