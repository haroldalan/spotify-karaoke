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

/**
 * Extracts and normalizes track duration to seconds.
 * Handles ms (Player API) and potential seconds (Metadata strings).
 */
export function getTrackDuration(track: any): number | undefined {
  if (!track) return undefined;

  // SLY FIX: Handle object-based duration format found in newer Spotify Web Player versions
  if (typeof track.duration === 'object' && track.duration !== null) {
    const ms = track.duration.milliseconds || track.duration.ms;
    if (ms) return Math.floor(Number(ms) / 1000);
  }

  const raw = track.duration_ms || track.duration || track.metadata?.duration;
  if (!raw) return undefined;
  
  const val = Number(raw);
  if (isNaN(val) || val <= 0) return undefined;
  
  // Spotify mostly uses ms. If > 30,000, it's definitely ms.
  if (val > 30000) return Math.floor(val / 1000);
  return Math.floor(val);
}
