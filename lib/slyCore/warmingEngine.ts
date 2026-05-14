// @ts-nocheck
import { slyInternalState, spotifyState } from './state';
import { safeClone } from '../utils/browserUtils';
import { slyPreFetchRegistry } from './preFetch';
import { MetadataEngine } from './metadataEngine';

/**
 * WarmingEngine: The central hub for proactive track discovery and hydration.
 * It seeds the L0 cache before the user even clicks the lyrics button.
 */
export const WarmingEngine = {
  init() {
    console.log('[WarmingEngine] 🌊 Initializing Proactive Hydration System...');

    // 1. Listen for track changes to warm the current track
    document.addEventListener('sly:song_change', (e: any) => {
      const { uri: eventUri } = e.detail;

      // SLY FIX: Defer MetadataEngine read by 100ms.
      // At the instant sly:song_change fires, the now-playing widget DOM hasn't
      // updated yet, so MetadataEngine still returns the OLD song's title/artist.
      // A 100ms delay is enough for the widget to re-render with the new track.
      setTimeout(() => {
        const meta = MetadataEngine.getNowPlaying();
        // Prefer MetadataEngine URI (DOM-derived, most current) over the event URI (may be stale).
        const targetUri = meta.uri || eventUri;

        if (targetUri && meta.title && meta.artist) {
          this.warmTrack(targetUri, meta.title, meta.artist);
        }
      }, 100);
    });

    // 2. Listen for state updates to warm the queue
    window.addEventListener('sly_state_update', (e: any) => {
      const queue = e.detail?.queue as any[];
      if (Array.isArray(queue) && queue.length > 0) {
        this.warmQueue(queue);
      }
    });

    // 3. Listen for cache results from the background relay (bridged via index.ts)
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source === 'SLY_BRIDGE_CACHE_RESULT') {
        this.handleCacheResult(data);
      }
    });
  },

  /**
   * Triggers a cache check for the current track.
   */
  warmTrack(uri: string, title: string, artist: string) {
    if (!uri || !uri.startsWith('spotify:track:')) return;
    
    // Prevent redundant warming cycles
    if (slyInternalState.warmedUri === uri || slyInternalState.warmingUri === uri) return;

    console.log(`[WarmingEngine] 🔍 PROACTIVE DISCOVERY: "${title}" by ${artist}`);
    console.log(`[WarmingEngine] 🛰️ Sending SLY_CHECK_CACHE request for ${uri}`);
    
    slyInternalState.warmingUri = uri;

    // SLY FIX: Route via window.postMessage to satisfy Chrome's isolated world requirements.
    // Caught by index.ts which relays to the background script.
    window.postMessage({ 
      type: 'SLY_CHECK_CACHE', 
      payload: { title, artist, uri } 
    }, window.location.origin);
  },

  /**
   * Pre-warms the next tracks in the Spotify queue.
   */
  warmQueue(queue: any[]) {
    const nextTracks = queue.slice(0, 2);
    nextTracks.forEach(track => {
      const { title, artist, albumArtUrl, id, uri } = track;
      const fullUri = uri || `spotify:track:${id}`;
      
      // Only pre-fetch if not already in L0 or currently fetching
      if (!slyInternalState.l0Cache.has(fullUri) && !slyInternalState.fetchingForUri.has(fullUri)) {
        console.log(`[WarmingEngine] 🌊 QUEUE WARMING: "${title}" [Next Up]`);
        if (window.slyTriggerLyricsFetch) {
          window.slyTriggerLyricsFetch(title, artist, albumArtUrl, fullUri);
        }
      }
    });
  },

  /**
   * Processes the cache result from the background and hydrates the L0 Session Cache.
   */
  handleCacheResult(data: any) {
    const { uri, result, error, title, artist } = data;
    
    // Clear warming lock
    if (slyInternalState.warmingUri === uri) {
      slyInternalState.warmingUri = undefined;
    }

    if (error) {
      console.warn(`[WarmingEngine] ❌ CACHE ERROR for "${title}": Database request failed.`);
      return;
    }

    if (result?.found) {
      const nativeStatus = result.nativeStatus || 'MISSING';
      const customStatus = result.prefetchState || 'MISSING';
      const lineCount = result.data?.lines?.length || 0;
      const color = result.data?.extractedColor || result.extractedColor || 'None';

      console.log(`[WarmingEngine] ✨ CACHE HIT for "${title}"`);
      console.log(`[WarmingEngine] 📊 Elements Found: { Lines: ${lineCount}, Native: ${nativeStatus}, Custom: ${customStatus}, Color: ${color} }`);
      
      // Hydrate L0 Session Cache (In-Memory RAM)
      if (result.ok && result.data) {
        const mutableData = safeClone(result.data);
        mutableData._slyUri = uri;
        if (result.nativeStatus) mutableData.nativeStatus = result.nativeStatus;
        slyInternalState.l0Cache.set(uri, mutableData);
        console.log(`[WarmingEngine] 🧠 L0 HYDRATION: Synchronously cached for 0ms swap.`);
      } else {
        // Hydrate with failure state but preserve extracted color for immersive HUDs
        slyInternalState.l0Cache.set(uri, { 
          failed: true, 
          _slyUri: uri, 
          extractedColor: result.data?.extractedColor || result.extractedColor 
        });
        console.log(`[WarmingEngine] 🧠 L0 HYDRATION: Cached FAILURE state (preserved color: ${color}).`);
      }
      
      slyInternalState.warmedUri = uri;

      // Update the PreFetchRegistry so the detector knows the situation
      const targetState = (nativeStatus === 'SYNCED' || nativeStatus === 'NATIVE_OK')
        ? 'NATIVE_OK'
        : (customStatus || 'MISSING');
      
      if (slyPreFetchRegistry) {
        slyPreFetchRegistry.register(uri, targetState, {
          title, 
          artist,
          nativeStatus,
          customStatus,
          reason: 'WarmingEngine Hydration'
        });
      }
    } else {
      console.log(`[WarmingEngine] 🆕 FIRST PLAY: No cache record found for "${title}". Standard fetch pipeline will handle this.`);
    }
  }
};
