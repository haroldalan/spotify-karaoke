export const LATIN_LIKE_LANGS = new Set([
  'en', 'es', 'pt', 'it', 'fr', 'de', 'nl', 'sv', 'da', 'no', 'nb', 'fi', 
  'pl', 'tr', 'id', 'ro', 'cs', 'hu', 'sk', 'hr', 'ca', 'eu', 'gl',
  'et', 'lv', 'lt', 'sl', 'bs', 'sq', 'af', 'ms', 'cy', 'ga', 'sw'
]);

export function base62ToHex(id: string): string | null {
    const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    try {
        let n = BigInt(0);
        for (const c of id) {
            const idx = CHARS.indexOf(c);
            if (idx === -1) return null;
            n = n * 62n + BigInt(idx);
        }
        return n.toString(16).padStart(32, '0');
    } catch { return null; }
}
