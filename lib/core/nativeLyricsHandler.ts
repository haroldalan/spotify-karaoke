import { getNowPlayingTrackId, getLyricsLines } from '../dom/domQueries';
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

export function applyNativeOverride(
  expectedTrackId: string,
  state: Pick<NativeLyricsState, 'cache' | 'pendingNativeLines'>
): void {
  const domTrackId = getNowPlayingTrackId();
  if (!domTrackId || domTrackId !== expectedTrackId) return;

  const native = state.pendingNativeLines.get(domTrackId);
  if (!native || native.length === 0) return;

  state.pendingNativeLines.delete(domTrackId);
  state.cache.original = native;

  getLyricsLines().forEach((el, i) => {
    if (native[i] !== undefined) {
      el.textContent = native[i];
      el.setAttribute('data-sly-original', native[i]);
    } else {
      el.textContent = '';
      el.removeAttribute('data-sly-original');
    }
  });
}

export async function handleNativeLyrics(
  trackId: string,
  nativeLines: string[],
  state: NativeLyricsState,
  onCancelInflight: () => void,
  onModeSwitch: (mode: LyricsMode, lang: string) => Promise<void>,
): Promise<void> {
  state.pendingNativeLines.set(trackId, nativeLines);

  if (trackId !== getNowPlayingTrackId()) return;

  const cacheForensics = slyForensics.analyzeText(state.cache.original);
  const nativeForensics = slyForensics.analyzeText(nativeLines);

  const isAlreadyNative = state.cache.original.length === nativeLines.length && state.cache.original.every((l, i) => l === nativeLines[i]);
  const isUpgradingRomanized = !cacheForensics.hasAnyNative && nativeForensics.hasAnyNative;

  if (isAlreadyNative && !isUpgradingRomanized) {
    state.pendingNativeLines.delete(trackId);
    return;
  }

  state.pendingNativeLines.delete(trackId);

  onCancelInflight();

  await loadSongCache(state.songKey, state.cache, state.runtimeCache);

  state.cache.original = nativeLines;
  state.cache.processed.clear();

  if (state.mode === 'original') {
    getLyricsLines().forEach((el, i) => {
      if (nativeLines[i] !== undefined) {
        el.textContent = nativeLines[i];
        el.setAttribute('data-sly-original', nativeLines[i]);
      } else {
        el.textContent = '';
        el.removeAttribute('data-sly-original');
      }
    });
  } else {
    await onModeSwitch(state.mode, state.currentActiveLang);
  }
}
