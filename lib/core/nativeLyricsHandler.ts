import { getNowPlayingTrackId, getLyricsLines } from '../dom/domQueries';
import { hasLyricWords, countWordLines } from '../lyrics/lineUtils';
import { loadSongCache } from './lyricsCache';
import type { SongCache, LyricsCacheEntry, LyricsMode } from './lyricsTypes';
import { slyForensics } from '../slyCore/forensics';

export interface NativeLyricsState {
  cache: SongCache;
  pendingNativeLines: Map<string, string[]>;
  songKey: string;
  mode: LyricsMode;
  currentActiveLang: string;
  runtimeCache: Map<string, LyricsCacheEntry>;
}

/** Extra fields of a late SKL_NATIVE_LYRICS (K5). */
export interface NativeLyricsMeta {
  /** The interceptor released Spotify's response before the native lookup finished. */
  late?: boolean;
  /** Number of lines in Spotify's (romanized) response. */
  spotifyLineCount?: number;
  /** Spotify lines that carry words (K5 compares these; '♪' / '' lines differ between sources). */
  spotifyWordLineCount?: number;
}

/** Late native lines are only kept for the track they belong to and only applied when they fit the rows (alignNativeToRows). */
const lateNativeLines = new Set<string>();
const lateMismatchLogged = new Set<string>();

/** A line that carries words. '', whitespace-only and marker lines such as '♪' are spacers. */
const hasWords = hasLyricWords;

/**
 * K5: maps late native lines onto the snapshotted Spotify rows. The rows do not
 * line up 1:1 with Spotify's response: its trailing '' line gets no row, spacer
 * rows may render empty, and Musixmatch turns empty lines into '♪'. So only
 * lines that carry words are counted, and they are written onto the rows that
 * carry words, in order. Spacer rows keep their text.
 * Returns null when the counts of word-carrying lines differ (a real mismatch).
 */
export function alignNativeToRows(nativeLines: string[], rows: string[]): string[] | null {
  const words = nativeLines.filter(hasWords);
  if (words.length === 0 || words.length !== rows.filter(hasWords).length) return null;
  let k = 0;
  return rows.map(row => (hasWords(row) ? words[k++] : row));
}

const rowText = (el: Element): string => el.getAttribute('data-sly-original') ?? el.textContent ?? '';

function logLateMismatchOnce(trackId: string, detail: string): void {
  if (lateMismatchLogged.has(trackId)) return;
  lateMismatchLogged.add(trackId);
  console.warn(`[sly-native] Ignoring late native lyrics for ${trackId}: ${detail}.`);
}

function writeNativeLinesToDOM(nativeLines: string[]): void {
  getLyricsLines().forEach((el, i) => {
    if (nativeLines[i] !== undefined) {
      el.textContent = nativeLines[i];
      el.setAttribute('data-sly-original', nativeLines[i]);
    } else {
      el.textContent = '';
      el.removeAttribute('data-sly-original');
    }
  });
}

/** Applies pending native lines for the playing track. Returns true when cache.original was replaced. */
export function applyNativeOverride(
  expectedTrackId: string,
  state: Pick<NativeLyricsState, 'cache' | 'pendingNativeLines'>
): boolean {
  const domTrackId = getNowPlayingTrackId();
  if (!domTrackId || domTrackId !== expectedTrackId) return false;

  const native = state.pendingNativeLines.get(domTrackId);
  if (!native || native.length === 0) return false;

  // K5: late native lines replace the on-screen (Spotify) lines, so they may only
  // be applied when the word-carrying lines agree with the rows on screen.
  if (lateNativeLines.has(domTrackId)) {
    const rows = getLyricsLines();
    if (rows.length === 0) return false; // keep them pending until the panel renders
    const aligned = alignNativeToRows(native, rows.map(rowText));
    state.pendingNativeLines.delete(domTrackId);
    lateNativeLines.delete(domTrackId);
    if (!aligned) {
      logLateMismatchOnce(domTrackId, `${native.filter(hasWords).length} native lines with words vs ${rows.filter(el => hasWords(rowText(el))).length} on screen`);
      return false;
    }
    state.cache.original = aligned;
    writeNativeLinesToDOM(aligned);
    return true;
  }

  state.pendingNativeLines.delete(domTrackId);
  state.cache.original = native;
  // Rewrite rows in place only when they line up 1:1 with the native lines.
  if (getLyricsLines().length === native.length) writeNativeLinesToDOM(native);
  return true;
}

/**
 * Applies native-script lines restored from Musixmatch to Pipeline B's cache
 * (and the DOM in original mode). Resolves to true when the lines were applied.
 */
export async function handleNativeLyrics(
  trackId: string,
  nativeLines: string[],
  state: NativeLyricsState,
  onCancelInflight: () => void,
  onModeSwitch: (mode: LyricsMode, lang: string) => Promise<void>,
  meta: NativeLyricsMeta = {},
): Promise<boolean> {
  if (!trackId || !Array.isArray(nativeLines) || nativeLines.length === 0) return false;
  const isCurrent = trackId === getNowPlayingTrackId();
  // Late lines are re-aligned to the snapshotted rows; on-time lines are used as sent.
  let linesToApply = nativeLines;

  if (meta.late) {
    // K5: only for the current track, and only when the native lines map onto
    // the Spotify lines we snapshotted (otherwise ignore and log once).
    if (!isCurrent) return false;
    // Same gate as slyCore's SKL_NATIVE_LYRICS handler, which forces the Layer 2
    // fallback for this case: never apply what it rejected.
    const countMismatch = typeof meta.spotifyWordLineCount === 'number'
      ? countWordLines(nativeLines) !== meta.spotifyWordLineCount
      : typeof meta.spotifyLineCount === 'number' && nativeLines.length !== meta.spotifyLineCount;
    if (countMismatch) {
      logLateMismatchOnce(trackId, `${countWordLines(nativeLines)} native lines with words vs ${meta.spotifyWordLineCount ?? meta.spotifyLineCount} Spotify lines`);
      return false;
    }
    const snapshot = state.cache.original;
    if (snapshot.length === 0) {
      // Nothing snapshotted yet (panel closed or still rendering): let
      // applyNativeOverride apply it once the lines are on screen.
      state.pendingNativeLines.set(trackId, nativeLines);
      lateNativeLines.add(trackId);
      return false;
    }
    const aligned = alignNativeToRows(nativeLines, snapshot);
    if (!aligned) {
      logLateMismatchOnce(trackId, `${nativeLines.filter(hasWords).length} native lines with words vs ${snapshot.filter(hasWords).length} snapshotted Spotify lines with words`);
      return false;
    }
    linesToApply = aligned;
  } else {
    state.pendingNativeLines.set(trackId, nativeLines);
    if (!isCurrent) return false;
  }

  const cacheForensics = slyForensics.analyzeText(state.cache.original);
  const nativeForensics = slyForensics.analyzeText(linesToApply);

  const isAlreadyNative = state.cache.original.length === linesToApply.length && state.cache.original.every((l, i) => l === linesToApply[i]);
  const isUpgradingRomanized = !cacheForensics.hasAnyNative && nativeForensics.hasAnyNative;

  if (isAlreadyNative && !isUpgradingRomanized) {
    state.pendingNativeLines.delete(trackId);
    return false;
  }

  state.pendingNativeLines.delete(trackId);
  lateNativeLines.delete(trackId);

  onCancelInflight();

  // Swap the source first, then load: loadSongCache compares the stored entry
  // with cache.original, so loading against the romanized lines would discard
  // (and delete) a stored entry that was built from these native lines.
  state.cache.original = linesToApply;
  state.cache.processed.clear();
  await loadSongCache(state.songKey, state.cache, state.runtimeCache);

  if (state.mode === 'original') {
    // Only rewrite the rows when they line up with the native lines; otherwise
    // they still belong to a render Spotify is about to replace.
    if (getLyricsLines().length === linesToApply.length) {
      writeNativeLinesToDOM(linesToApply);
    }
  } else {
    await onModeSwitch(state.mode, state.currentActiveLang);
  }
  return true;
}
