import { fileTypeFromBuffer } from 'file-type';
import isSvg from 'is-svg';
import { chunkedMd5 } from '#/images/hash.ts';

/**
 * Generate a content-addressed filename `<md5>.<ext>` per §7.2.
 * Returns null when no extension can be determined (caller should
 * skip and warn).
 *
 * Extension detection priority:
 *  1. file-type magic-byte sniffing (authoritative)
 *  2. URL pathname extension (fallback)
 *  3. is-svg check when file-type returns 'xml' or nothing
 *  4. null if none resolve
 */
export async function generateFilename(
    buffer: Buffer,
    url: string,
): Promise<string | null> {
    const hash = chunkedMd5(buffer);
    const type = await fileTypeFromBuffer(buffer);

    // 1. Magic-byte detection (authoritative when not xml)
    if (type && type.ext !== 'xml') {
        return `${hash}.${type.ext}`;
    }

    // 2. URL pathname extension (fallback)
    const urlExt = extensionFromUrl(url);
    if (urlExt) {
        return `${hash}.${urlExt}`;
    }

    // 3. is-svg check when file-type returned xml or nothing
    if (buffer.length < 1_048_576 && isSvg(buffer.toString('utf-8'))) {
        return `${hash}.svg`;
    }

    // 4. No extension resolved
    return null;
}

/** Extract file extension from a URL pathname, ignoring query. */
function extensionFromUrl(url: string): string | null {
    try {
        const { pathname } = new URL(url);
        const segment = pathname.split('/').pop() ?? '';
        const dot = segment.lastIndexOf('.');
        if (dot < 1) return null;
        return segment.slice(dot + 1).toLowerCase() || null;
    } catch {
        return null;
    }
}
