/**
 * Spotify's own romanized lines for native-script lines the extension restored.
 *
 * When Spotify shows a romanized fallback and the extension restores the native script
 * line for line (the same number of lines with words, written onto Spotify's own lines),
 * each native line has Spotify's romanized line next to it: licensed and in the spelling
 * listeners know ("hum baatein"), where the local transliterator gives a literal one
 * ("hama batem"). Romanized mode shows Spotify's line for those native lines.
 */
import { hasLyricWords } from '../lyrics/lineUtils';
import type { ProcessedCache } from './lyricsTypes';

const MAX_LINES = 3000;
const byNativeLine = new Map<string, string>();

/**
 * Pairs the native lines with words with `romanizedWordLines`, one entry per native line
 * with words, in order ('' where Spotify has none for that line). Nothing is recorded
 * when the counts differ (the lines would not belong together).
 * Returns the number of pairs recorded.
 */
export function rememberSpotifyRomanization(nativeLines: readonly string[], romanizedWordLines: readonly string[]): number {
  const native = nativeLines.filter(hasLyricWords);
  if (!native.length || native.length !== romanizedWordLines.length) return 0;
  let pairs = 0;
  native.forEach((line, i) => {
    const romanized = romanizedWordLines[i];
    if (!hasLyricWords(romanized)) return;
    byNativeLine.delete(line);
    byNativeLine.set(line, romanized);
    pairs++;
  });
  while (byNativeLine.size > MAX_LINES) {
    const oldest = byNativeLine.keys().next().value;
    if (oldest === undefined) break;
    byNativeLine.delete(oldest);
  }
  return pairs;
}

/** Spotify's romanized line for a restored native line, if known. */
export function spotifyRomanizationFor(line: string): string | undefined {
  return byNativeLine.get(line);
}

/**
 * Writes Spotify's romanized lines into a processed result for the lines they belong to.
 * Returns true when any line changed.
 */
export function applySpotifyRomanization(lines: readonly string[], processed: ProcessedCache): boolean {
  if (!byNativeLine.size || !Array.isArray(processed.romanized)) return false;
  let changed = false;
  lines.forEach((line, i) => {
    const spotify = byNativeLine.get(line);
    if (spotify !== undefined && processed.romanized[i] !== spotify) {
      processed.romanized[i] = spotify;
      changed = true;
    }
  });
  return changed;
}

/** Popup Reset (K7) and tests. */
export function resetSpotifyRomanization(): void {
  byNativeLine.clear();
}
