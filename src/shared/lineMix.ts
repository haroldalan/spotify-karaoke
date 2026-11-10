// A song's lines in their mix of scripts and languages. Decisions about a song's script are
// made from its lines (PROBLEM.md): a multilingual song mixes scripts, Spotify romanizes some
// lines and not others, and English lines belong in Latin script.
import { isEnglishLine } from './english';
import { isLatinLine } from './scripts';

/** A line that looks romanized: Latin letters only, and not English. */
export const looksRomanized = (line: string) => isLatinLine(line) && !isEnglishLine(line);

/** Share of the lines with words that look romanized. */
export function romanizedShare(lines: string[]): number {
  const worded = lines.filter((l) => /\p{L}/u.test(l));
  return worded.length ? worded.filter(looksRomanized).length / worded.length : 0;
}

/** From this share of romanized lines a song is worth a native-script copy: not all of it has to be. */
export const ROMANIZED_SHARE_MIN = 0.3;

export const hasRomanizedPart = (lines: string[]) => romanizedShare(lines) >= ROMANIZED_SHARE_MIN;
