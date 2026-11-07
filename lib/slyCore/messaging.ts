// @ts-nocheck
import { safeClone } from '../utils/browserUtils';
import { countWordLines } from '../lyrics/lineUtils';
import { FetchEngine } from './fetchEngine';

import { StatusEngine } from './statusEngine';
import { clearNativeLookupPending, markNativeLookupPending } from './state';

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
    handleLyricsUpgraded(message.payload as Record<string, unknown> | undefined);
  }
});

/**
 * Background hot-swap. The payload is `{ cacheKey, uri, data: FetchedLyricsResult }`,
 * where FetchedLyricsResult is `{ ok, data: { syncedLyrics | plainLyrics, isSynced, ... },
 * prefetchState, nativeStatus, processed? }`. Unwrap it exactly like
 * FetchEngine._handleSuccess so consumers get a lyrics object, stamped with its URI.
 */
export function handleLyricsUpgraded(payload: Record<string, unknown> | undefined): void {
  const result = payload?.data as Record<string, any> | undefined;
  const uri = payload?.uri as string | undefined;
  if (!uri || !result?.ok || !result.data) return;

  const fresh = safeClone(result.data);
  fresh._slyUri = uri;
  fresh.isInstant = true;
  if (result.nativeStatus) fresh.nativeStatus = result.nativeStatus;
  if (result.processed) fresh.processed = result.processed;

  window.slyInternalState.l0Cache.set(uri, safeClone(fresh));

  // Never stage or inject another track's lyrics: the L0 entry above is enough
  // for when that track plays again.
  const currentUri = (window.spotifyState?.track as any)?.uri;
  if (uri !== currentUri) {
    console.log(`[sly-coherence] Background upgrade for non-current track ${uri} cached in L0 only.`);
    return;
  }

  console.log(`[sly-coherence] 🔥 Active Track Upgraded! Performing hot-swap for ${uri}`);
  if (document.getElementById('lyrics-root-sync')) {
    // Active UI is visible: trigger a seamless hot-swap.
    window.slyInternalState.currentLyrics = safeClone(fresh);
    window.slyInternalState.pendingLyricsData = null;
    document.dispatchEvent(new CustomEvent('sly:inject', {
      detail: {
        lyricsObj: safeClone(fresh),
        isInstant: true
      },
    }));
  } else {
    // No takeover on screen: let the injection gate pick it up when the panel is ready.
    window.slyInternalState.currentLyrics = null;
    window.slyInternalState.pendingLyricsData = fresh;
  }
}

// --- INTERCEPTOR LIFECYCLE (K4) ---
// The interceptor caps its own hold time (~4s) and always pairs START with END,
// but a lost END would leave interceptorActive stuck for the whole song and
// block the decision engine and pending mode switches. The watchdog bounds that.
const INTERCEPTOR_WATCHDOG_MS = 8000;
let interceptorWatchdog: ReturnType<typeof setTimeout> | null = null;

function armInterceptorWatchdog(): void {
  if (interceptorWatchdog) clearTimeout(interceptorWatchdog);
  interceptorWatchdog = setTimeout(() => {
    interceptorWatchdog = null;
    if (window.slyInternalState.interceptorActive) {
      console.warn('[sly-dom] SLY_INTERCEPT_END not received within 8s; treating the intercept as settled.');
      settleInterceptor();
    }
  }, INTERCEPTOR_WATCHDOG_MS);
}

function settleInterceptor(): void {
  if (interceptorWatchdog) {
    clearTimeout(interceptorWatchdog);
    interceptorWatchdog = null;
  }
  window.slyInternalState.interceptorActive = false;
  // Pipeline B re-runs any mode switch it deferred while the intercept was in flight.
  document.dispatchEvent(new CustomEvent('sly:interceptor_settled'));
  if (window.slyStartThrottledPoll) window.slyStartThrottledPoll();
}

/** Bare id of the track the bridge says is playing. */
function playingTrackId(): string | undefined {
  return (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();
}

// --- MAIN WORLD MESSAGE BRIDGE ---
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as Record<string, unknown> | undefined;
  if (data?.source !== 'SLY_ACTION_GATEWAY') return;
  const action = data.action;
  if (!action) return;

  if (action.type === 'SLY_FETCH_START') {
    window.slyInternalState.isSpotifyFetching = true;

  } else if (action.type === 'SLY_FETCH_END') {
    window.slyInternalState.isSpotifyFetching = false;
    if (window.slyStartThrottledPoll) window.slyStartThrottledPoll();

  } else if (action.type === 'SLY_INTERCEPT_START') {
    // K4: interceptorActive is the in-flight flag (START..END only). An intercept
    // is also proof that the interceptor is alive.
    window.slyInternalState.interceptorActive = true;
    window.slyInternalState.interceptorReady = true;
    window.slyInternalState.interceptorFailed = false;
    armInterceptorWatchdog();
    // K5: the Layer-1 result stays pending past INTERCEPT_END until SKL_NATIVE_LYRICS
    // or SLY_FORCE_FALLBACK for this track (or the pending window expires).
    markNativeLookupPending(action.trackId as string | undefined);

  } else if (action.type === 'SLY_INTERCEPT_END') {
    settleInterceptor();

  } else if (action.type === 'SLY_FORCE_FALLBACK') {
    const trackId = action.trackId as string | undefined;
    clearNativeLookupPending(trackId);
    // A late Layer-1 failure (K5) can arrive after a skip: it must not force the
    // fallback onto the track that is playing now.
    const playingId = playingTrackId();
    if (trackId && playingId && trackId !== playingId) {
      console.log(`[sly-dom] Layer 1 failure for non-current track ${trackId} ignored.`);
      return;
    }
    console.log(`[sly-dom] 🚨 Layer 1 failed to de-romanize track. Forcing Layer 2 (YTM) fallback...`);
    window.slyInternalState.forceFallback = true;
    setTimeout(() => window.slyCheckNowPlaying?.(), 100);

  } else if (action.type === 'SLY_PREFETCH_REPORT') {
    const { trackId, state, nativeStatus, metadata } = action;
    if (trackId) {
      const fullUri = `spotify:track:${trackId}`;
      window.slyPreFetchRegistry.register(fullUri, state, {
        ...(metadata ?? {}),
        nativeStatus,
        source: 'native',
        reason: state === 'MISSING' ? 'Network Intercept (404)' : 'Network Intercept'
      });
      // K3: the interceptor reports ROMANIZED right before it starts the native-script
      // lookup (SLY_INTERCEPT_START), so the Layer-1 result is pending from here.
      if (state === 'ROMANIZED') markNativeLookupPending(trackId as string);
    }

  } else if (action.type === 'SKL_NATIVE_LYRICS') {
    const { trackId, nativeLines, isRomanizedUpgrade, late, spotifyLineCount, spotifyWordLineCount } = action;
    const wasPending = clearNativeLookupPending(trackId as string | undefined);
    // A late result after the pending window expired, while the Layer-2 takeover's
    // lines are on screen: keep the takeover. Pipeline B aligns late lines against
    // cache.original, which the takeover replaced, so releasing it would leave
    // Spotify's romanized lines, and NATIVE_OK would stop the fallback re-arming.
    // Read the lines from the DOM: a step-6 re-inject can swap currentLyrics for a
    // clone that Pipeline B drops (setupLock), so currentLyrics.lines may stay empty.
    const cl = window.slyInternalState.currentLyrics as Record<string, any> | null;
    const takeoverRoot = document.getElementById('lyrics-root-sync');
    const takeoverHasLines = !!takeoverRoot &&
      (!!takeoverRoot.querySelector('[data-testid="lyrics-line"]') || !!cl?.lines?.length);
    if (late && !wasPending && trackId && trackId === playingTrackId() &&
        cl && !cl.failed && (!cl._slyUri || cl._slyUri === `spotify:track:${trackId}`) &&
        takeoverHasLines) {
      console.log(`[sly-dom] Late native lyrics for ${trackId} arrived after the pending window; keeping the Layer-2 takeover.`);
      return;
    }
    // K5: a late upgrade is only applied by Pipeline B when it lines up 1:1 with
    // the Spotify lines already on screen. If it cannot be applied, it is a
    // failed native restoration: do not mark the track NATIVE_OK or release a
    // takeover for it; fall back to Layer 2 like SLY_FORCE_FALLBACK.
    // Compare lines WITH WORDS: Spotify's '♪' / trailing '' lines have no Musixmatch counterpart.
    const lateMismatch = late && (
      !Array.isArray(nativeLines) ||
      (typeof spotifyWordLineCount === 'number'
        ? countWordLines(nativeLines as string[]) !== spotifyWordLineCount
        : typeof spotifyLineCount === 'number' && nativeLines.length !== spotifyLineCount)
    );
    if (lateMismatch) {
      const playingId = playingTrackId();
      if (trackId && trackId === playingId) {
        console.warn(`[sly-dom] Late native lyrics for ${trackId} do not match Spotify's ${spotifyLineCount} lines; forcing Layer 2 fallback.`);
        window.slyInternalState.forceFallback = true;
        setTimeout(() => window.slyCheckNowPlaying?.(), 100);
      }
      return;
    }
    if (trackId) {
      const fullUri = `spotify:track:${trackId}`;
      window.slyPreFetchRegistry.register(fullUri, 'NATIVE_OK', { 
        source: 'native', 
        reason: isRomanizedUpgrade ? 'De-Romanization Success' : 'Network Upgrade Success' 
      });
    }

    if (trackId && trackId === playingTrackId()) {
      const fullUri = `spotify:track:${trackId}`;
      const hadTakeover = !!(window.slyInternalState.currentLyrics ||
        window.slyInternalState.isFetchingHUD || window.slyInternalState.statusHUDActive);
      window.slyInternalState.nativeUpgradedLines = nativeLines;
      // Spotify's (upgraded) lines are the answer now: drop any Layer-2 fallback that
      // was armed for this track, including its in-flight marker, or the poll would
      // restore a "Continuing external search" HUD over them.
      window.slyInternalState.forceFallback = false;
      window.slyInternalState.pendingLyricsData = null;
      window.slyInternalState.fetchingForTitle = '';
      window.slyInternalState.fetchingForUri?.delete(fullUri);
      // Clear the HUD before sly:panel_close: that handler ignores closes while a
      // HUD is up (its track-skip flicker guard).
      StatusEngine.clear();
      if (hadTakeover) {
        document.dispatchEvent(new CustomEvent('sly:panel_close'));
      }
    }
  } else if (action.type === 'SLY_MXM_WARMUP') {
    safeSendMessage({ type: 'SLY_MXM_WARMUP' });

  } else if (action.type === 'SLY_MXM_NOTIFY_METADATA') {
    safeSendMessage({ type: 'SLY_MXM_NOTIFY_METADATA', payload: action.payload });

  } else if (action.type === 'SLY_MXM_NEW_INTERCEPTION') {
    const { requestId, payload } = action;
    safeSendMessage({ type: 'SLY_MXM_NEW_INTERCEPTION', payload }, (r) => {
      window.postMessage({ 
        source: 'SLY_ACTION_GATEWAY', 
        action: { type: 'SLY_MXM_NEW_INTERCEPTION_RESPONSE', requestId, generation: r?.generation }
      }, '*');
    });

  } else if (action.type === 'SLY_MXM_FETCH_NATIVE') {
    const { requestId, payload } = action;
    safeSendMessage({ type: 'SLY_MXM_FETCH_NATIVE', payload }, (r) => {
      window.postMessage({ 
        source: 'SLY_ACTION_GATEWAY', 
        action: { type: 'SLY_MXM_FETCH_NATIVE_RESPONSE', requestId, ok: r?.ok ?? false, lines: r?.lines }
      }, '*');
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
