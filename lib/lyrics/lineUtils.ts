/**
 * Helpers for comparing lyric line lists from different sources.
 *
 * Spotify, the native-script sources and the on-screen rows disagree about non-lyric
 * lines: Spotify sends '♪' instrumental markers and a trailing '' line, other sources
 * mark or drop empty lines their own way, and spacer rows may render empty. Only lines that carry
 * words (a letter or digit) are comparable between sources.
 */

/** True when the line carries words (any letter or digit), i.e. it is not '', whitespace or '♪'. */
export const hasLyricWords = (line: string | null | undefined): boolean => /[\p{L}\p{N}]/u.test(line ?? '');

/** Number of lines that carry words. */
export const countWordLines = (lines: ReadonlyArray<string | null | undefined>): number =>
  lines.reduce((n, l) => (hasLyricWords(l) ? n + 1 : n), 0);
