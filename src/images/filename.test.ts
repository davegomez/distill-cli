import { describe, expect, it } from 'vitest';
import { generateFilename } from '#/images/filename.ts';
import { chunkedMd5 } from '#/images/hash.ts';

/** Minimal valid 1×1 PNG (69 bytes). */
const PNG_1X1 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const SIMPLE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="1" height="1"/></svg>';

describe('generateFilename', () => {
    it('detects PNG via file-type magic bytes', async () => {
        const result = await generateFilename(
            PNG_1X1,
            'https://example.com/image',
        );
        const hash = chunkedMd5(PNG_1X1);
        expect(result).toBe(`${hash}.png`);
    });

    it('falls back to URL extension for unknown binary', async () => {
        const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        const result = await generateFilename(
            buf,
            'https://example.com/photo.jpg',
        );
        const hash = chunkedMd5(buf);
        expect(result).toBe(`${hash}.jpg`);
    });

    it('detects SVG via is-svg when file-type returns nothing', async () => {
        const buf = Buffer.from(SIMPLE_SVG);
        const result = await generateFilename(
            buf,
            'https://cdn.example.com/abc123',
        );
        const hash = chunkedMd5(buf);
        expect(result).toBe(`${hash}.svg`);
    });

    it('returns null for extensionless CDN URL with unknown bytes', async () => {
        const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const result = await generateFilename(
            buf,
            'https://cdn.example.com/abc123',
        );
        expect(result).toBeNull();
    });

    it('strips query string from URL extension', async () => {
        const buf = Buffer.from([0x00, 0x01, 0x02]);
        const result = await generateFilename(
            buf,
            'https://example.com/img.webp?w=100&h=100',
        );
        const hash = chunkedMd5(buf);
        expect(result).toBe(`${hash}.webp`);
    });
});
