/**
 * §9.5 — Prompt injection defense.
 *
 * Wraps content field values in `<distilled_content>...</distilled_content>`
 * tags so downstream agents treat extracted text as data, not instructions.
 *
 * Applied at the final output step, after rendering and field resolution.
 */

const OPEN_TAG = '<distilled_content>';
const CLOSE_TAG = '</distilled_content>';

/** Wrap a single content string in distilled_content tags. */
export function wrapTag(value: string): string {
    return `${OPEN_TAG}\n${value}\n${CLOSE_TAG}`;
}

/** Content keys that receive wrapping when present. */
const CONTENT_KEYS = ['markdown', 'html', 'text'] as const;

/**
 * Wrap all content field values in `<distilled_content>` tags.
 * Mutates the `content` object in `output` in place and returns the output.
 *
 * When `rawContent` is true, returns the output unchanged (no wrapping).
 */
export function wrapContentFields(
    output: Record<string, unknown>,
    rawContent: boolean,
): Record<string, unknown> {
    if (rawContent) return output;

    const content = output.content as Record<string, string> | undefined;
    if (!content) return output;

    for (const key of CONTENT_KEYS) {
        if (key in content) {
            content[key] = wrapTag(content[key]);
        }
    }

    return output;
}
