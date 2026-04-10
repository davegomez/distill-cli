import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchRaw } from '#/extractor/fetch.ts';
import { downloadImages } from '#/images/download.ts';

/** Minimal valid 1×1 PNG (69 bytes). */
const PNG_1X1 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

let server: Server;
let baseUrl: string;
let tmpDir: string;

/** Server-side concurrency tracking for the delayed endpoint. */
let inFlight = 0;
let maxInFlight = 0;

beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'distill-dl-'));

    await new Promise<void>((resolve) => {
        server = createServer((req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const path = url.pathname;

            switch (path) {
                case '/image.png':
                    res.writeHead(200, {
                        'content-type': 'image/png',
                    });
                    res.end(PNG_1X1);
                    break;

                case '/large-image': {
                    const large = Buffer.concat([PNG_1X1, Buffer.alloc(2048)]);
                    res.writeHead(200, {
                        'content-type': 'image/png',
                    });
                    res.end(large);
                    break;
                }

                case '/broken':
                    res.writeHead(500, {
                        'content-type': 'text/plain',
                    });
                    res.end('Internal Server Error');
                    break;

                case '/delayed-image': {
                    const id = url.searchParams.get('id') ?? '0';
                    inFlight++;
                    maxInFlight = Math.max(maxInFlight, inFlight);
                    setTimeout(() => {
                        inFlight--;
                        const buf = Buffer.concat([
                            PNG_1X1,
                            Buffer.from(`img-${id}`),
                        ]);
                        res.writeHead(200, {
                            'content-type': 'image/png',
                        });
                        res.end(buf);
                    }, 100);
                    break;
                }

                default:
                    res.writeHead(404);
                    res.end();
            }
        });

        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as AddressInfo;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
});

afterAll(async () => {
    await new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
    await rm(tmpDir, { recursive: true, force: true });
});

function freshDir(): string {
    return join(tmpDir, crypto.randomUUID());
}

describe('downloadImages', () => {
    it('downloads image and populates results', async () => {
        const dir = freshDir();
        const result = await downloadImages([{ src: `${baseUrl}/image.png` }], {
            dir,
            maxSize: 1_048_576,
            concurrency: 5,
            fetchFn: fetchRaw,
            format: 'markdown',
        });

        expect(result.downloads).toHaveLength(1);
        expect(result.warnings).toHaveLength(0);

        const dl = result.downloads[0];
        expect(dl.src).toBe(`${baseUrl}/image.png`);
        expect(dl.filename).toMatch(/^[a-f0-9]{32}\.png$/);
        expect(dl.bytes).toBe(PNG_1X1.length);
        expect(existsSync(dl.local_path)).toBe(true);
    });

    it('enforces maxSize limit with warning', async () => {
        const dir = freshDir();
        const result = await downloadImages(
            [{ src: `${baseUrl}/large-image` }],
            {
                dir,
                maxSize: 100,
                concurrency: 5,
                fetchFn: fetchRaw,
                format: 'markdown',
            },
        );

        expect(result.downloads).toHaveLength(0);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('exceeds');
    });

    it('captures failed downloads in warnings', async () => {
        const dir = freshDir();
        const result = await downloadImages([{ src: `${baseUrl}/broken` }], {
            dir,
            maxSize: 1_048_576,
            concurrency: 5,
            fetchFn: fetchRaw,
            format: 'markdown',
        });

        expect(result.downloads).toHaveLength(0);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('Failed');
        expect(result.warnings[0]).toContain('/broken');
    });

    it('skips write for existing file (cross-run dedup)', async () => {
        const dir = freshDir();
        await mkdir(dir, { recursive: true });

        // First download to get the filename
        const first = await downloadImages([{ src: `${baseUrl}/image.png` }], {
            dir,
            maxSize: 1_048_576,
            concurrency: 5,
            fetchFn: fetchRaw,
            format: 'markdown',
        });
        const { filename, local_path } = first.downloads[0];

        // Overwrite with sentinel to detect re-write
        writeFileSync(local_path, 'sentinel');

        // Download again — same content, same filename
        const second = await downloadImages([{ src: `${baseUrl}/image.png` }], {
            dir,
            maxSize: 1_048_576,
            concurrency: 5,
            fetchFn: fetchRaw,
            format: 'markdown',
        });

        expect(second.downloads).toHaveLength(1);
        expect(second.downloads[0].filename).toBe(filename);
        expect(second.pathMap.has(`${baseUrl}/image.png`)).toBe(true);
        // Sentinel preserved — file was not overwritten
        expect(readFileSync(local_path, 'utf-8')).toBe('sentinel');
    });

    it('populates pathMap with local path for markdown format', async () => {
        const dir = freshDir();
        const src = `${baseUrl}/image.png`;
        const result = await downloadImages([{ src }], {
            dir,
            maxSize: 1_048_576,
            concurrency: 5,
            fetchFn: fetchRaw,
            format: 'markdown',
        });

        const mapped = result.pathMap.get(src);
        expect(mapped).toBeDefined();
        expect(mapped).toContain(dir);
        expect(mapped).toMatch(/\.png$/);
    });

    it('populates pathMap with filename only for wikilinks', async () => {
        const dir = freshDir();
        const src = `${baseUrl}/image.png`;
        const result = await downloadImages([{ src }], {
            dir,
            maxSize: 1_048_576,
            concurrency: 5,
            fetchFn: fetchRaw,
            format: 'wikilinks',
        });

        const mapped = result.pathMap.get(src);
        expect(mapped).toBeDefined();
        expect(mapped).not.toContain('/');
        expect(mapped).toMatch(/^[a-f0-9]{32}\.png$/);
    });

    it('respects concurrency limit', async () => {
        inFlight = 0;
        maxInFlight = 0;

        const dir = freshDir();
        const images = Array.from({ length: 6 }, (_, i) => ({
            src: `${baseUrl}/delayed-image?id=${i}`,
        }));

        const result = await downloadImages(images, {
            dir,
            maxSize: 1_048_576,
            concurrency: 2,
            fetchFn: fetchRaw,
            format: 'markdown',
        });

        expect(result.downloads).toHaveLength(6);
        expect(maxInFlight).toBeLessThanOrEqual(2);
        expect(maxInFlight).toBe(2);
    });
});
