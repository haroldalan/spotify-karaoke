// Which modes the switcher offers for a song.
import type { Mode, Settings } from '../shared/types';
import { songScript } from '../shared/scripts';
import type { Song } from './lineStore';

export const ALL_MODES: Mode[] = ['original', 'romanized', 'translated'];

const baseLang = (l?: string | null) => (l ?? '').toLowerCase().split(/[-_]/)[0];

/**
 * What the switcher offers for a song, and the mode in effect for it:
 * - every mode, for a song in another script;
 * - Original and Translated, for a song already in Latin script (nothing to romanize;
 *   "original" is in effect unless it is translated);
 * - nothing (null) with all three lines on (every version is on screen already), or for a
 *   Latin-script song already in the language translations go into.
 */
export function switchFor(song: Song | null, s: Settings): { modes: Mode[]; mode: Mode } | null {
  if (s.allLines) return null;
  if (!song || (song.script ?? songScript(song.lines, song.language)) !== 'Latn') return { modes: ALL_MODES, mode: s.mode };
  const lang = baseLang(song.language);
  if (lang && lang === baseLang(s.targetLang)) return null;
  return { modes: ['original', 'translated'], mode: s.mode === 'translated' ? 'translated' : 'original' };
}
