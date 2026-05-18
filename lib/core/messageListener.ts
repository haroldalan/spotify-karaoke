import { handleNativeLyrics } from './nativeLyricsHandler';
import type { NativeLyricsState } from './nativeLyricsHandler';
import type { LyricsMode } from './lyricsTypes';
import { StateStore } from './store';
import { hashString } from '../utils/hashUtils';
import { deleteSongCache } from './lyricsCache';
import { getNowPlayingTrackId } from '../dom/domQueries';

export function setupMessageListener(
  store: StateStore,
  switchMode: (mode: LyricsMode, lang?: string) => Promise<void>
): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== 'https://open.spotify.com' && event.origin !== 'null' && event.origin !== '') {
      // Security/Compatibility: allow empty/null/origin-matched origins for integration tests (JSDOM)
      if (event.origin !== window.location.origin) return;
    }
    const msg = event.data;
    if (msg?.source !== 'SLY_ACTION_GATEWAY') return;
    const action = msg.action;
    if (!action) return;

    if (action.type === 'SLY_FETCH_START') {
      if (action.trackId) {
        store.canonicalHashes.delete(action.trackId);
      }
      const currentTrackId = getNowPlayingTrackId();
      if (currentTrackId && action.trackId === currentTrackId) {
        store.canonicalHash = null;
      }
    }

    if (action.type === 'SLY_CANONICAL_HASH') {
      if (action.trackId) {
        store.canonicalHashes.set(action.trackId, action.canonHash);
      }
      console.log(`[sly-listener] 🔒 Captured canonical lyrics hash: ${action.canonHash} for track ${action.trackId}`);

      // SELF-HEALING HASH COHERENCE GUARD:
      // If we synchronously loaded a stale/mismatched cache before the network
      // de-romanization completed, we will have a mismatch between the cache's
      // original hash and the canonical hash of the intercepted track.
      // Purge the stale cache immediately and trigger a clean de-romanization.
      const currentTrackId = getNowPlayingTrackId();
      if (currentTrackId && action.trackId === currentTrackId && store.cache.original.length > 0) {
        const runtimeEntry = store.runtimeCache.get(store.songKey);
        const cacheHash = runtimeEntry?.originalHash ?? hashString(store.cache.original.join('|'));
        if (runtimeEntry && !runtimeEntry.originalHash) runtimeEntry.originalHash = cacheHash;

        if (Number(cacheHash) !== Number(action.canonHash)) {
          console.warn(`[sly-listener] ⚠️ Canonical hash mismatch detected for active track! Discarding stale cache.`);
          deleteSongCache(store.songKey, store.runtimeCache);
          store.cache = { original: [], processed: new Map() };
          switchMode(store.preferredMode, store.currentActiveLang).catch(() => {});
        }
      }
    }

    if (action.type === 'SKL_NATIVE_LYRICS') {
      // Upgraded native lyrics carry a canonHash too
      if (action.canonHash) {
        if (action.trackId) {
          store.canonicalHashes.set(action.trackId, action.canonHash);
        }
        const currentTrackId = getNowPlayingTrackId();
        if (currentTrackId && action.trackId === currentTrackId) {
          store.canonicalHash = action.canonHash;
        }
      }
      handleNativeLyrics(
        action.trackId as string,
        action.nativeLines as string[],
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
  });
}

/**
 * Lightweight bridge for Musixmatch tokens. 
 * Must be initialized as early as possible (document_start) to avoid race conditions on refresh.
 */
export function setupTokenBridge(): void {
  if ((window as any).slyTokenBridgeReady) return;
  (window as any).slyTokenBridgeReady = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.source !== 'SLY_ACTION_GATEWAY') return;
    const action = msg.action;
    if (!action) return;

    if (action.type === 'SLY_GET_MXM_TOKEN') {
      browser.runtime.sendMessage({ type: 'SLY_GET_MXM_TOKEN' }).then(res => {
        window.postMessage({ 
          source: 'SLY_ACTION_GATEWAY', 
          action: { type: 'SLY_MXM_TOKEN_RESPONSE', token: res.token, expiry: res.expiry } 
        }, '*');
      }).catch(() => {
        // Background might not be ready yet, or context invalidated
      });
    }

    if (action.type === 'SLY_SET_MXM_TOKEN') {
      browser.runtime.sendMessage({ type: 'SLY_SET_MXM_TOKEN', payload: action.payload }).catch(() => {});
    }
  });
}
