import type { FetchResult, PageFetcher } from '#/extractor/pipeline.ts';
import { type ExtractInput, ExtractInputSchema } from '#/schema/input.ts';

// ---------------------------------------------------------------------------
// Fetcher helpers
// ---------------------------------------------------------------------------

/** Create a PageFetcher that returns canned HTML. */
export function fakeFetcher(
    html: string,
    overrides?: Partial<FetchResult>,
): PageFetcher {
    return {
        async fetch(_url, _request) {
            return {
                html,
                finalUrl: 'https://example.com/page',
                httpStatus: 200,
                fromCache: false,
                actionTrace: [],
                ...overrides,
            };
        },
    };
}

/** Create a PageFetcher that always throws the given error. */
export function throwingFetcher(error: unknown): PageFetcher {
    return {
        async fetch() {
            throw error;
        },
    };
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

/** Parse ExtractInput with defaults, merging overrides. */
export function parseInput(
    overrides: Record<string, unknown> = {},
): ExtractInput {
    return ExtractInputSchema.parse({
        url: 'https://example.com/page',
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// HTML fixtures
// ---------------------------------------------------------------------------

/** Has <main> -- triggers selector-chain strategy. */
export const HTML_WITH_MAIN = `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Main Article</title>
    <meta name="description" content="A description">
    <meta name="author" content="Jane Doe">
    <meta property="og:site_name" content="Example Site">
</head>
<body>
    <nav><a href="/">Home</a></nav>
    <main>
        <h1>Main Heading</h1>
        <p>First paragraph with enough words to pass quality thresholds for extraction pipeline confidence scoring in tests.</p>
        <p>Second paragraph providing additional content so the heuristic considers this real article content worth extracting.</p>
        <img src="https://example.com/photo.jpg" alt="A photo">
    </main>
    <footer>Footer content</footer>
</body>
</html>`;

/**
 * No main/article/[role="main"]/#content/.post-content/.entry-content.
 * Content lives in a plain <div> with enough paragraphs -- heuristic fallback.
 */
export const HTML_HEURISTIC = `<!DOCTYPE html>
<html lang="en">
<head><title>Heuristic Page</title></head>
<body>
    <nav><a href="/">Nav</a></nav>
    <div>
        <h2>Section Title</h2>
        <p>Paragraph one with sufficient text to score above the heuristic minimum threshold for content detection.</p>
        <p>Paragraph two adds more bulk to ensure the scoring function picks this div as the content candidate.</p>
        <p>Paragraph three keeps piling on words so the text length factor dominates the heuristic score calculation.</p>
        <p>Paragraph four is here because we want a convincing amount of article-like content in this test fixture.</p>
        <p>Paragraph five rounds out the content block and should push the score well past the minimum threshold.</p>
    </div>
    <footer><a href="/about">About</a><a href="/contact">Contact</a></footer>
</body>
</html>`;

/** Has a .custom element for explicit selector tests. */
export const HTML_EXPLICIT = `<!DOCTYPE html>
<html lang="en">
<head><title>Explicit Page</title></head>
<body>
    <div class="custom">
        <p>Custom-selected content that should be extracted when the user passes selector .custom to the pipeline.</p>
    </div>
</body>
</html>`;

/** Full-featured HTML for field-resolution and metadata tests. */
export const HTML_FULL = `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Full Featured Article</title>
    <meta name="description" content="Comprehensive test page">
    <meta name="author" content="Test Author">
    <meta name="article:published_time" content="2025-01-15T10:00:00Z">
    <meta property="og:site_name" content="Test Site">
</head>
<body>
    <main>
        <h1>Full Article</h1>
        <p>This is a full-featured article paragraph with enough words for extraction pipeline confidence and quality thresholds.</p>
        <p>A second paragraph ensures we have real substance. <a href="https://example.com/link1">Link one</a> and <a href="https://example.com/link2">link two</a>.</p>
        <p><img src="https://example.com/img1.jpg" alt="Image one"> caption for first image.</p>
        <p><img src="https://example.com/img2.png" alt="Image two"> caption for second image.</p>
    </main>
</body>
</html>`;
