import {
    invalidScheme,
    invalidUrl,
    privateNetworkBlocked,
} from '#/schema/errors.ts';

const MAX_URL_LENGTH = 2048;
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

function hasControlChars(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) < 0x20) return true;
    }
    return false;
}

/**
 * Check whether an IPv4 address string falls in a private or loopback range.
 * Ranges: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0/8
 */
function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (
        parts.length !== 4 ||
        parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
    ) {
        return false;
    }
    const [a, b] = parts;
    return (
        a === 127 || // 127.0.0.0/8 loopback
        a === 10 || // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
        (a === 192 && b === 168) || // 192.168.0.0/16
        (a === 169 && b === 254) || // 169.254.0.0/16 link-local
        a === 0 // 0.0.0.0/8
    );
}

/**
 * Check whether an IPv6 address string falls in a private or loopback range.
 * Covers: ::1 (loopback), fc00::/7 (unique local), fe80::/10 (link-local)
 */
function isPrivateIPv6(ip: string): boolean {
    // Expand :: shorthand for prefix checks
    const normalized = ip.toLowerCase();

    // Loopback
    if (
        normalized === '::1' ||
        normalized === '0000:0000:0000:0000:0000:0000:0000:0001'
    ) {
        return true;
    }

    // Expand to full form for prefix matching
    const expanded = expandIPv6(normalized);
    if (!expanded) return false;

    const firstWord = Number.parseInt(expanded.slice(0, 4), 16);

    // fc00::/7 — unique local (fc00–fdff)
    if ((firstWord & 0xfe00) === 0xfc00) return true;

    // fe80::/10 — link-local (fe80–febf)
    if ((firstWord & 0xffc0) === 0xfe80) return true;

    // :: (all zeros, unspecified)
    if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return true;

    return false;
}

/** Expand an IPv6 address to full 8-group colon-hex form. Returns null if malformed. */
function expandIPv6(ip: string): string | null {
    let addr = ip;

    // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    const v4Suffix = addr.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4Suffix) {
        const parts = v4Suffix[1].split('.').map(Number);
        if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
        const hi = ((parts[0] << 8) | parts[1]).toString(16).padStart(4, '0');
        const lo = ((parts[2] << 8) | parts[3]).toString(16).padStart(4, '0');
        addr = addr.replace(v4Suffix[0], `:${hi}:${lo}`);
    }

    const halves = addr.split('::');
    if (halves.length > 2) return null;

    if (halves.length === 2) {
        const left = halves[0] ? halves[0].split(':') : [];
        const right = halves[1] ? halves[1].split(':') : [];
        const missing = 8 - left.length - right.length;
        if (missing < 0) return null;
        const middle = Array.from({ length: missing }, () => '0000');
        const groups = [...left, ...middle, ...right];
        return groups.map((g) => g.padStart(4, '0')).join(':');
    }

    const groups = addr.split(':');
    if (groups.length !== 8) return null;
    return groups.map((g) => g.padStart(4, '0')).join(':');
}

/** Check if a hostname is a literal IP in a private/loopback range. */
function isPrivateHost(hostname: string): boolean {
    // IPv6 in brackets: URL.hostname strips the brackets
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        return isPrivateIPv6(hostname.slice(1, -1));
    }

    // Try IPv6 directly (URL class strips brackets from hostname)
    if (hostname.includes(':')) {
        return isPrivateIPv6(hostname);
    }

    // Try IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
        return isPrivateIPv4(hostname);
    }

    return false;
}

export interface ValidateUrlOptions {
    allowPrivateNetwork?: boolean;
}

/**
 * Validate a URL string per DESIGN.md §9.1.
 *
 * Returns a parsed URL on success, throws a DistillError on failure.
 */
export function validateUrl(raw: string, opts?: ValidateUrlOptions): URL {
    // Length check before parsing
    if (raw.length > MAX_URL_LENGTH) {
        throw invalidUrl(
            raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
            `URL exceeds maximum length of ${MAX_URL_LENGTH} characters.`,
        );
    }

    // Control character check
    if (hasControlChars(raw)) {
        throw invalidUrl(raw, 'URL contains control characters.');
    }

    // Strict parse
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw invalidUrl(raw);
    }

    // Scheme check
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
        throw invalidScheme(raw);
    }

    // Private/loopback check
    if (!opts?.allowPrivateNetwork && isPrivateHost(parsed.hostname)) {
        throw privateNetworkBlocked(raw);
    }

    return parsed;
}
