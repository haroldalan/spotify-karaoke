import { handleNativeLyrics } from './nativeLyricsHandler';
import type { NativeLyricsState } from './nativeLyricsHandler';
import type { LyricsMode } from './lyricsTypes';
import { StateStore } from './store';

export function setupMessageListener(
  store: StateStore,
  switchMode: (mode: LyricsMode, lang?: string) => Promise<void>
): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== 'https://open.spotify.com') return;
    const msg = event.data;
    if (msg?.type !== 'SKL_NATIVE_LYRICS') return;

    handleNativeLyrics(
      msg.trackId as string,
      msg.nativeLines as string[],
      {
        cache: store.cache,
        pendingNativeLines: store.pendingNativeLines,
        songKey: store.songKey,
        mode: store.mode,
        currentActiveLang: store.currentActiveLang,
        runtimeCache: store.runtimeCache
      } satisfies NativeLyricsState,
      () => { store.romanizedGenRef.value++; store.translatedGenRef.value++; },
      async (m, lang) => { await switchMode(m, lang); }
    );
  });
}
