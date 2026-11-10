// Which modes the switcher offers for a song.
import type { Mode, Settings } from '../shared/types';
import { songScript } from '../shared/scripts';
import { hasEnglishVerses } from '../shared/lineMix';
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
  const plain = song && plainSong(song, s.targetLang);
  if (!plain) return { modes: ALL_MODES, mode: s.mode };
  if (plain === 'same') return null;
  return { modes: ['original', 'translated'], mode: s.mode === 'translated' ? 'translated' : 'original' };
}

/**
 * A song the extension leaves as it is: 'latin', already in Latin script (nothing to
 * romanize; it can still be translated); 'same', also in the language translations go into.
 * Null for a song in another script.
 */
export function plainSong(song: Song, targetLang: string): 'latin' | 'same' | null {
  if ((song.script ?? songScript(song.lines, song.language)) !== 'Latn') return null;
  const lang = baseLang(song.language);
  // English lines in a song in another Latin-script language still translate into it.
  const english = baseLang(targetLang) !== 'en' && hasEnglishVerses(song.lines);
  return lang && lang === baseLang(targetLang) && !english ? 'same' : 'latin';
}
