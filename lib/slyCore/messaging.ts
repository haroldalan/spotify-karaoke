// @ts-nocheck
import { safeClone } from '../utils/browserUtils';
import { FetchEngine } from './fetchEngine';

import { StatusEngine } from './statusEngine';

declare global {
  interface Window {
    slyTriggerLyricsFetch: (title: string, artist: string, albumArtUrl: string, uri: string, forceRefresh?: boolean, album?: string, duration?: number) => void;
    slyCheckNowPlaying?: () => void;
    slyStartThrottledPoll?: () => void;
  }
}

// --- BACKGROUND EVENT LISTENER ---
browser.runtime.onMessage.addListener((message: Record<string, unknown>) => {
  if (message.type === 'SLY_BACKGROUND_EVENT') {
    console.log(`%c[sly-sw] ${message.event}`, 'color: #888; font-style: italic;');
    return;
  }

  if (message.type === 'LYRICS_UPGRADED') {
    const fresh = (message.payload as Record<string, unknown>)?.data;
    if (!fresh) return;
    
    const uri = (message.payload as Record<string, unknown>)?.uri as string;
    if (uri) window.slyInternalState.l0Cache.set(uri, safeClone(fresh));

    window.slyInternalState.pendingLyricsData = safeClone(fresh);
    console.log('[sly-dom] Background fetch succeeded. Pending lyrics data updated for automatic injection.');
  }
});

// --- MAIN WORLD MESSAGE BRIDGE ---
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as Record<string, unknown> | undefined;

  if (data?.type === 'SLY_FETCH_START') {
    window.slyInternalState.isSpotifyFetching = true;

  } else if (data?.type === 'SLY_FETCH_END') {
    window.slyInternalState.isSpotifyFetching = false;
    if (window.slyStartThrottledPoll) window.slyStartThrottledPoll();

  } else if (data?.type === 'SLY_INTERCEPT_START') {
    window.slyInternalState.interceptorActive = true;

  } else if (data?.type === 'SLY_INTERCEPT_END') {
    window.slyInternalState.interceptorActive = false;
    if (window.slyStartThrottledPoll) window.slyStartThrottledPoll();

  } else if (data?.type === 'SLY_FORCE_FALLBACK') {
    console.log(`[sly-dom] 🚨 Layer 1 failed to de-romanize track. Forcing Layer 2 (YTM) fallback...`);
    window.slyInternalState.forceFallback = true;
    setTimeout(window.slyCheckNowPlaying, 100);

  } else if (data?.type === 'SLY_PREFETCH_REPORT') {
    const { trackId, state, nativeStatus, metadata } = data;
    if (trackId) {
      const fullUri = `spotify:track:${trackId}`;
      window.slyPreFetchRegistry.register(fullUri, state, {
        ...(metadata ?? {}),
        nativeStatus,
        source: 'native',
        reason: state === 'MISSING' ? 'Network Intercept (404)' : 'Network Intercept'
      });
    }

  } else if (data?.type === 'SKL_NATIVE_LYRICS') {
    const { trackId, nativeLines, isRomanizedUpgrade } = data;
    if (trackId) {
      const fullUri = `spotify:track:${trackId}`;
      window.slyPreFetchRegistry.register(fullUri, 'NATIVE_OK', { 
        source: 'native', 
        reason: isRomanizedUpgrade ? 'De-Romanization Success' : 'Network Upgrade Success' 
      });
    }

    const currentTrackId = (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();
    if (trackId === currentTrackId) {
      window.slyInternalState.nativeUpgradedLines = nativeLines;
      if (window.slyInternalState.currentLyrics || window.slyInternalState.isFetchingHUD) {
        document.dispatchEvent(new CustomEvent('sly:panel_close'));
      }
      window.slyInternalState.pendingLyricsData = null;
      window.slyInternalState.fetchingForTitle = '';
      StatusEngine.clear();
    }
  } else if (data?.type === 'SLY_MXM_WARMUP') {
    safeSendMessage({ type: 'SLY_MXM_WARMUP' });

  } else if (data?.type === 'SLY_MXM_NOTIFY_METADATA') {
    safeSendMessage({ type: 'SLY_MXM_NOTIFY_METADATA', payload: data.payload });

  } else if (data?.type === 'SLY_MXM_NEW_INTERCEPTION') {
    const { requestId, payload } = data;
    safeSendMessage({ type: 'SLY_MXM_NEW_INTERCEPTION', payload }, (r) => {
      window.postMessage({ type: 'SLY_MXM_NEW_INTERCEPTION_RESPONSE', requestId, generation: r.generation }, '*');
    });

  } else if (data?.type === 'SLY_MXM_FETCH_NATIVE') {
    const { requestId, payload } = data;
    safeSendMessage({ type: 'SLY_MXM_FETCH_NATIVE', payload }, (r) => {
      window.postMessage({ type: 'SLY_MXM_FETCH_NATIVE_RESPONSE', requestId, ok: r.ok, lines: r.lines }, '*');
    });
  }
});

/**
 * Promise-based wrapper for browser.runtime.sendMessage with built-in 
 * context-invalidation safety.
 */
export function safeSendMessage(msg: Record<string, unknown>, callback?: (r: any) => void): Promise<any> {
  if (browser.runtime?.id) {
    return browser.runtime.sendMessage(msg)
      .then((r: unknown) => {
        if (callback) callback(r);
        return r;
      })
      .catch((err) => {
        if (err?.message && !err.message.includes('context invalidated')) {
          console.warn('[sly-msg] Message failed:', err.message);
        }
        return { ok: false, error: err?.message || 'Unknown error' };
      });
  }
  return Promise.resolve({ ok: false, error: 'Extension context missing' });
}

// --- FETCH TRIGGER ---
window.slyTriggerLyricsFetch = (title, artist, albumArtUrl, uri, forceRefresh = false, album?, duration?) => {
  FetchEngine.triggerFetch(title, artist, albumArtUrl, uri, forceRefresh, album, duration);
};
