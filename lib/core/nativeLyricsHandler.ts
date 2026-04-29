import { getNowPlayingTrackId, getLyricsLines } from '../dom/domQueries';
import { loadSongCache } from './lyricsCache';
import type { SongCache, LyricsCacheEntry, LyricsMode } from './lyricsTypes';

export interface NativeLyricsState {
  cache: SongCache;
  pendingNativeLines: Map<string, string[]>;
  songKey: string;
  mode: LyricsMode;
  currentActiveLang: string;
  runtimeCache: Map<string, LyricsCacheEntry>;
}

export function applyNativeOverride(state: Pick<NativeLyricsState, 'cache' | 'pendingNativeLines'>): void {
  const domTrackId = getNowPlayingTrackId();
  if (!domTrackId) return;

  const native = state.pendingNativeLines.get(domTrackId);
  if (!native || native.length === 0) return;

  state.pendingNativeLines.delete(domTrackId);
  state.cache.original = native;

  getLyricsLines().forEach((el, i) => {
    if (native[i] !== undefined) {
      el.textContent = native[i];
      el.setAttribute('data-sly-original', native[i]);
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

  if (trackId !== getNowPlayingTrackId() || state.cache.original.length === 0) return;

  const isAlreadyNative = state.cache.original.length === nativeLines.length && state.cache.original.every((l, i) => l === nativeLines[i]);
  if (isAlreadyNative) {
    state.pendingNativeLines.delete(trackId);
    return;
  }

  state.pendingNativeLines.delete(trackId);

  state.cache.original = nativeLines;

  state.cache.processed.clear();

  onCancelInflight();

  await loadSongCache(state.songKey, state.cache, state.runtimeCache);

  if (state.mode === 'original') {
    getLyricsLines().forEach((el, i) => {
      if (nativeLines[i] !== undefined) {
        el.textContent = nativeLines[i];
        el.setAttribute('data-sly-original', nativeLines[i]);
      }
    });
  } else {
    await onModeSwitch(state.mode, state.currentActiveLang);
  }
}
