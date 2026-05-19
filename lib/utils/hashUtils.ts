/**
 * Robust string hash (53-bit safe integer).
 * Improved version of DJB2 with better entropy for longer strings.
 * Normalized to ignore case, whitespace, all standard/smart punctuation, and pipe separators.
 */
export function hashString(str: string): number {
  const normalized = str
    .toLowerCase()
    .replace(/[\s!"#$%&'()*+,-./:;<=>?@[\\\]^_\`{|}~♪…\u2018\u2019\u201C\u201D]/g, '');

  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < normalized.length; i++) {
    ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
