// Which modes the switcher offers for a song.
import type { Mode, Settings } from '../shared/types';
import { songScript } from '../shared/scripts';
import type { Song } from './lineStore';

export const ALL_MODES: Mode[] = ['original', 'romanized', 'translated'];

const baseLang = (l?: string | null) => (l ?? '').toLowerCase().split(/[-_]/)[0];

/**
 * What the switcher offers for a song: every mode, or, for a song already in Latin
 * script, Original and Translated (there is nothing to romanize; "original" is then the
 * mode in effect unless it is translated). null: nothing to offer (Latin script, and
 * already in the language translations go into).
 */
export function switchFor(song: Song | null, s: Settings): { modes: Mode[]; mode: Mode } | null {
  if (!song) return { modes: ALL_MODES, mode: s.mode };
  const script = song.script ?? songScript(song.lines, song.language);
  if (script !== 'Latn') return { modes: ALL_MODES, mode: s.mode };
  const lang = baseLang(song.language);
  if (lang && lang === baseLang(s.targetLang)) return null;
  return { modes: ['original', 'translated'], mode: s.mode === 'translated' ? 'translated' : 'original' };
}
