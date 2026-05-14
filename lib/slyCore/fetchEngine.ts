// @ts-nocheck
import { MetadataEngine } from './metadataEngine';
import { StatusEngine } from './statusEngine';
import { slyInternalState } from './state';
import { safeClone } from '../utils/browserUtils';
import { slyPreFetchRegistry } from './preFetch';
import { safeSendMessage } from './messaging';

/**
 * FetchEngine: Orchestrates external lyric fetching with UI feedback.
 * Handles stale results, cache hydration, and error states.
 */
export const FetchEngine = {
  /**
   * Initiates a lyric fetch for a track.
   */
  triggerFetch(title: string, artist: string, albumArtUrl: string, uri: string, forceRefresh = false) {
    // 1. Validation & Throttle
    if (!uri || uri === 'ad' || uri === 'N/A') return;
    if (!forceRefresh && (slyInternalState.fetchingForUri.has(uri) || (slyInternalState.lastUri === uri && slyInternalState.currentLyrics?.lines))) return;

    // Use MetadataEngine to ensure we have valid fields
    const meta = { title, artist, albumArtUrl, uri };
    if (!MetadataEngine.isValidForFetch(meta)) return;

    const myGeneration = slyInternalState.fetchGeneration;
    const myUri = uri;

    // 2. L0 SESSION CACHE CHECK (Magical Seamless Swap)
    // If we've already fetched this song in the current session, restore it synchronously
    // to eliminate the "Fetching" HUD flicker entirely.
    const isNativeSynced = slyPreFetchRegistry.getState(uri)?.nativeStatus === 'SYNCED';
    const l0Hit = slyInternalState.l0Cache.get(uri);

    if (l0Hit && !forceRefresh && !isNativeSynced) {
      console.log(`[FetchEngine] ⚡ L0 CACHE HIT: Seamlessly restoring state for "${title}" [${uri}]`);
      
      if (l0Hit.failed) {
        slyInternalState.currentLyrics = { failed: true, _slyUri: uri, extractedColor: l0Hit.extractedColor };
        slyInternalState.pendingLyricsData = null;
        slyInternalState.fetchingForUri.add(uri);
        
        // Show error HUD if lyrics panel is open
        const btn = document.querySelector('[data-testid="lyrics-button"]');
        if (btn?.getAttribute('data-active') === 'true' || btn?.getAttribute('aria-pressed') === 'true') {
          StatusEngine.show(
            "Even Spotify Karaoke couldn't find the lyrics for this song.",
            'You can help the community by adding them to the open-source database.',
            true,
            { ...meta, extractedColor: l0Hit.extractedColor }
          );
        }
        return;
      }

      slyInternalState.pendingLyricsData = { ...l0Hit, isInstant: true };
      if (window.slyCheckNowPlaying) window.slyCheckNowPlaying();
      return;
    }

    slyInternalState.fetchingForUri.add(uri);
    console.log(`[FetchEngine] 🚀 INITIATING FETCH: "${title}" by ${artist} [URI: ${uri}]`);

    // 3. HUD GRACE PERIOD (Seamless Hits)
    // We wait 150ms before showing the HUD to give the fetch (or SW cache) a head-start.
    const hudGracePeriod = 150;
    setTimeout(() => {
      // ABORT CONDITIONS:
      if (!slyInternalState.fetchingForUri.has(myUri)) return; // Fetch already finished
      if (myGeneration !== slyInternalState.fetchGeneration) return; // Track changed
      if (slyInternalState.pendingLyricsData?._slyUri === myUri) return; // Staged for injection
      
      const root = document.getElementById('lyrics-root-sync');
      const hasRendered = !!(slyInternalState.currentLyrics?.lines) && !!root;

      if (!hasRendered) {
        StatusEngine.show('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Initializing external search...', false, meta);
      }
    }, hudGracePeriod);

    // 4. ASYNC COLOR UPGRADE
    // If we don't have a color in L0/Session, ask the background to extract it.
    const sessionKey = `sly_theme_${albumArtUrl}`;
    if (!sessionStorage.getItem(sessionKey)) {
      safeSendMessage({ type: 'GET_COLOR', payload: { albumArtUrl } }, (r) => {
        if (r?.color) {
          sessionStorage.setItem(sessionKey, r.color);
          // If the HUD is currently showing for THIS song, upgrade its color.
          if (slyInternalState.statusHUDActive && slyInternalState.lastUri === myUri) {
             StatusEngine.show('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Initializing external search...', false, { ...meta, extractedColor: r.color });
          }
        }
      });
    }

    // 5. Send Message to Service Worker
    const nativeStatus = slyPreFetchRegistry.getState(uri)?.nativeStatus;
    
    safeSendMessage({ 
      type: 'FETCH_LYRICS', 
      payload: { title, artist, albumArtUrl, uri, nativeStatus, forceRefresh } 
    }, (r) => {
      this.handleFetchResult(r, { title, artist, albumArtUrl, uri, myGeneration, myUri });
    });
  },

  /**
   * Handles the response from the background script.
   */
  handleFetchResult(r: any, context: any) {
    const { title, artist, uri, myGeneration, myUri } = context;

    // Stale check
    if (myGeneration !== slyInternalState.fetchGeneration || (myUri && slyInternalState.lastUri && myUri !== slyInternalState.lastUri)) {
      console.log(`[FetchEngine] ⚠️ Fetch response for "${title}" discarded — track changed mid-flight.`);
      if (!slyInternalState.fetchingForUri.size) StatusEngine.clear();
      return;
    }

    slyInternalState.fetchingForUri.delete(uri);

    if (r?.ok) {
      this._handleSuccess(r, context);
    } else {
      this._handleFailure(r, context);
    }
  },

  _handleSuccess(r: any, context: any) {
    const { title, uri } = context;
    const mode = r.data?.isSynced ? 'synced (LRC)' : 'unsynced (plain)';
    console.log(`[FetchEngine] ✅ SUCCESS: "${title}" — got ${mode} lyrics.`);

    // Update Registries & L0 Cache
    const prefetchState = r.prefetchState || (r.data?.isSynced ? 'SYNCED' : 'UNSYNCED');
    slyPreFetchRegistry.register(uri, prefetchState, {
      title: context.title,
      artist: context.artist,
      nativeStatus: r.nativeStatus,
      customStatus: prefetchState,
      reason: 'FetchEngine Success'
    });

    const mutableData = safeClone(r.data);
    mutableData._slyUri = uri;
    if (r.nativeStatus) mutableData.nativeStatus = r.nativeStatus;
    
    // SLY FIX: Preserve merged processed cache and mark as instant
    if (r.processed) mutableData.processed = r.processed;
    mutableData.isInstant = true;

    slyInternalState.l0Cache.set(uri, mutableData);

    // Stage for injection
    slyInternalState.pendingLyricsData = mutableData;
    
    // Clear HUD only if we don't have a pending injection
    // (slyCheckNowPlaying or the poll will handle the final HUD removal)
    setTimeout(() => {
      if (window.slyCheckNowPlaying) window.slyCheckNowPlaying();
    }, 0);
  },

  _handleFailure(r: any, context: any) {
    const { title, artist, uri } = context;
    console.warn(`[FetchEngine] ❌ FAILURE: "${title}" — no lyrics found.`);

    // Check for native stand-down
    const nativeStatus = slyPreFetchRegistry.getState(uri)?.nativeStatus;
    if (nativeStatus === 'UNSYNCED' || nativeStatus === 'SYNCED' || nativeStatus === 'NATIVE_OK') {
      console.log(`[FetchEngine] 🛡️ STAND-DOWN: Reverting to native ${nativeStatus} lyrics.`);
      slyInternalState.currentLyrics = null;
      slyInternalState.forceFallback = false;
      StatusEngine.clear();
      return;
    }

    // Persist failure to L0
    slyInternalState.l0Cache.set(uri, { failed: true, _slyUri: uri, extractedColor: r?.data?.extractedColor });
    slyInternalState.currentLyrics = { failed: true, extractedColor: r?.data?.extractedColor };

    // Show error HUD if lyrics panel is open
    const btn = document.querySelector('[data-testid="lyrics-button"]');
    const isPanelOpen = btn?.getAttribute('data-active') === 'true' || btn?.getAttribute('aria-pressed') === 'true';

    if (isPanelOpen) {
      StatusEngine.show(
        "Even Spotify Karaoke couldn't find the lyrics for this song.",
        'You can help the community by adding them to the open-source database.',
        true,
        context
      );
    } else {
      StatusEngine.clear();
    }
  }
};
