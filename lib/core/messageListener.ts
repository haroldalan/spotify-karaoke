import { rememberSpotifyRomanization } from './spotifyRomanization';
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
          store.cacheFromTakeover = false;
          switchMode(store.preferredMode, store.currentActiveLang).catch(() => {});
        }
      }
    }

    if (action.type === 'SKL_NATIVE_LYRICS') {
      const adoptCanonicalHash = (canonHash: number | undefined) => {
        if (!canonHash) return;
        if (action.trackId) {
          store.canonicalHashes.set(action.trackId, canonHash);
        }
        const currentTrackId = getNowPlayingTrackId();
        if (currentTrackId && action.trackId === currentTrackId) {
          store.canonicalHash = canonHash;
        }
      };
      // Upgraded native lyrics carry a canonHash too. A late upgrade (K5) arrives
      // after Spotify rendered its own romanized lines; the interceptor deliberately
      // sends no canonical hash for those (hold-budget expiry), so the hash only
      // becomes canonical once the native lines were actually applied.
      // The late lines are re-aligned to the on-screen rows, so the canonical hash
      // is that of the applied lines, not the interceptor's hash of its own array.
      const isLate = action.late === true;
      if (!isLate) adoptCanonicalHash(action.canonHash);
      // Before the lines are applied (that may switch to Romanized mode at once).
      if (Array.isArray(action.romanizedWordLines) && Array.isArray(action.nativeLines)) {
        const pairs = rememberSpotifyRomanization(action.nativeLines, action.romanizedWordLines);
        if (pairs) console.log(`[sly-native] Romanized mode will use Spotify's own romanized lines for ${pairs} restored lines.`);
      }
      const nativeState: NativeLyricsState = {
        cache: store.cache,
        pendingNativeLines: store.pendingNativeLines,
        songKey: store.songKey,
        mode: store.mode,
        currentActiveLang: store.currentActiveLang,
        runtimeCache: store.runtimeCache
      };
      handleNativeLyrics(
        action.trackId as string,
        action.nativeLines as string[],
        nativeState,
        () => { store.romanizedGenRef.value++; store.translatedGenRef.value++; },
        async (m, lang) => { await switchMode(m, lang); },
        {
          late: isLate,
          spotifyLineCount: typeof action.spotifyLineCount === 'number' ? action.spotifyLineCount : undefined,
          spotifyWordLineCount: typeof action.spotifyWordLineCount === 'number' ? action.spotifyWordLineCount : undefined,
        },
      ).then((applied) => {
        if (isLate && applied) adoptCanonicalHash(hashString(nativeState.cache.original.join('|')));
      }).catch((err) => {
        console.warn('[sly-listener] Native lyrics handling failed:', err);
      });
    }
  });
}
