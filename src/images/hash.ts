import { createHash } from 'node:crypto';

/** 15 KB chunk size for chunked MD5 hashing. */
const CHUNK_SIZE = 15 * 1024;

/**
 * Chunked MD5: hash 15 KB from start + 15 KB from middle + 15 KB
 * from end. For buffers smaller than 45 KB, hash the full buffer.
 */
export function chunkedMd5(buffer: Buffer): string {
    const hash = createHash('md5');

    if (buffer.length < CHUNK_SIZE * 3) {
        hash.update(buffer);
    } else {
        const midStart = Math.floor((buffer.length - CHUNK_SIZE) / 2);
        hash.update(buffer.subarray(0, CHUNK_SIZE));
        hash.update(buffer.subarray(midStart, midStart + CHUNK_SIZE));
        hash.update(buffer.subarray(buffer.length - CHUNK_SIZE));
    }

    return hash.digest('hex');
}
