import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chunkedMd5 } from '#/images/hash.ts';

const CHUNK = 15 * 1024;

describe('chunkedMd5', () => {
    it('hashes full buffer when smaller than 45 KB', () => {
        const buf = Buffer.from('hello world');
        const expected = createHash('md5').update(buf).digest('hex');
        expect(chunkedMd5(buf)).toBe(expected);
    });

    it('hashes empty buffer', () => {
        const buf = Buffer.alloc(0);
        const expected = createHash('md5').update(buf).digest('hex');
        expect(chunkedMd5(buf)).toBe(expected);
    });

    it('uses chunked strategy for buffers >= 45 KB', () => {
        const buf = Buffer.alloc(60 * 1024);
        for (let i = 0; i < buf.length; i++) {
            buf[i] = i % 256;
        }

        const mid = Math.floor((buf.length - CHUNK) / 2);
        const expected = createHash('md5')
            .update(buf.subarray(0, CHUNK))
            .update(buf.subarray(mid, mid + CHUNK))
            .update(buf.subarray(buf.length - CHUNK))
            .digest('hex');

        expect(chunkedMd5(buf)).toBe(expected);
    });

    it('boundary: 45 KB - 1 uses full-buffer hash', () => {
        const buf = Buffer.alloc(CHUNK * 3 - 1, 0x55);
        const expected = createHash('md5').update(buf).digest('hex');
        expect(chunkedMd5(buf)).toBe(expected);
    });

    it('produces different hashes for different content', () => {
        const a = Buffer.alloc(100, 0x41);
        const b = Buffer.alloc(100, 0x42);
        expect(chunkedMd5(a)).not.toBe(chunkedMd5(b));
    });
});
