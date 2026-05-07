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
    if (!msg?.type) return;

    if (msg.type === 'SKL_NATIVE_LYRICS') {
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
    }

    // Musixmatch Token Bridge: Forward to Background
    if (msg.type === 'SLY_GET_MXM_TOKEN') {
      browser.runtime.sendMessage({ type: 'SLY_GET_MXM_TOKEN' }).then(res => {
        window.postMessage({ type: 'SLY_MXM_TOKEN_RESPONSE', ...res }, '*');
      });
    }

    if (msg.type === 'SLY_SET_MXM_TOKEN') {
      browser.runtime.sendMessage({ type: 'SLY_SET_MXM_TOKEN', payload: msg.payload });
    }
  });
}
