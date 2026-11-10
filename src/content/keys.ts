// Which mode a key press asks for (O / R / T while the lyrics are open).
import type { Mode } from '../shared/types';

const MODE_KEYS: Record<string, Mode> = { o: 'original', r: 'romanized', t: 'translated' };
const MODE_CODES: Record<string, Mode> = { KeyO: 'original', KeyR: 'romanized', KeyT: 'translated' };

/**
 * The mode a key press asks for: the letter O / R / T; on a layout without Latin letters
 * (Cyrillic, Greek, Arabic ...) the physical key where they sit on a US keyboard.
 */
export function modeForKey(e: { key: string; code: string }): Mode | undefined {
  const k = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (k in MODE_KEYS) return MODE_KEYS[k];
  return k && !/^[a-z]$/.test(k) ? MODE_CODES[e.code] : undefined;
}
