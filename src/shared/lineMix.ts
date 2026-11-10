// A song's lines in their mix of scripts and languages. Decisions about a song's script are
// made from its lines (PROBLEM.md): a multilingual song mixes scripts, Spotify romanizes some
// lines and not others, and English lines belong in Latin script.
import { isEnglishLine } from './english';
import { isLatinLine, scriptShare, type Script } from './scripts';

/** A line's words alone: case, spacing and punctuation left out. */
const wordsOf = (line: string) => line.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The same words: a "translation" Google sent back unchanged (bar a capital letter or a
 * comma) is no translation, and is never shown as one.
 */
export const sameWords = (a: string, b: string) => wordsOf(a) === wordsOf(b);

/**
 * From this share of English lines a song has English verses: a song in the listener's own
 * language with an English verse still has lines to translate. One short line ("No, no, no",
 * "Oh oh oh") reads as English to the word list, and is never a quarter of a song.
 */
export const ENGLISH_VERSES_SHARE = 0.25;

export function hasEnglishVerses(lines: string[]): boolean {
  const worded = lines.filter((l) => /\p{L}/u.test(l));
  return !!worded.length && worded.filter(isEnglishLine).length / worded.length >= ENGLISH_VERSES_SHARE;
}

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
