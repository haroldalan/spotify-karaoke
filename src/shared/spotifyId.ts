// Spotify ids: base62 (22 chars, in URIs and color-lyrics URLs) <-> hex gid (32 chars,
// in metadata/4 URLs).
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function hexToBase62(hex: string): string | null {
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  let n = BigInt('0x' + hex);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(22, '0');
}

export function base62ToHex(id: string): string | null {
  if (!/^[0-9a-zA-Z]{22}$/.test(id)) return null;
  let n = 0n;
  for (const ch of id) n = n * 62n + BigInt(ALPHABET.indexOf(ch));
  return n.toString(16).padStart(32, '0');
}
