// Which modes the switcher offers for a song.
import type { Mode, Settings } from '../shared/types';
import { songScript } from '../shared/scripts';
import type { Song } from './lineStore';

export const ALL_MODES: Mode[] = ['original', 'romanized', 'translated'];

const baseLang = (l?: string | null) => (l ?? '').toLowerCase().split(/[-_]/)[0];
const SHOW: Record<Mode, 'showOriginal' | 'showRomanized' | 'showTranslation'> = {
  original: 'showOriginal',
  romanized: 'showRomanized',
  translated: 'showTranslation',
};

/**
 * What the switcher offers for a song, and the mode in effect for it:
 * - every mode, for a song in another script;
 * - Original and Translated, for a song already in Latin script (nothing to romanize;
 *   "original" is in effect unless it is translated);
 * - nothing (null) for a Latin-script song already in the language translations go into,
 *   or when every mode it would offer is already on screen (main line + lines beneath).
 */
export function switchFor(song: Song | null, s: Settings): { modes: Mode[]; mode: Mode } | null {
  let modes = ALL_MODES;
  let mode = s.mode;
  if (song && (song.script ?? songScript(song.lines, song.language)) === 'Latn') {
    const lang = baseLang(song.language);
    if (lang && lang === baseLang(s.targetLang)) return null;
    modes = ['original', 'translated'];
    mode = s.mode === 'translated' ? 'translated' : 'original';
  }
  if (modes.every((m) => m === mode || s[SHOW[m]])) return null;
  return { modes, mode };
}
