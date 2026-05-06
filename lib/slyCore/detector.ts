// @ts-nocheck
// Port of: lyric-test/modules/core/detector.js
/* modules/content-detector.js: Spotify DOM & State Scanner */

export interface DetectorState {
  isAd: boolean;
  isOnLyricsPage: boolean;
  hasNativeLines: boolean;
  hasUnavailableMessage: boolean;
  lyricsState: string; // LOADING | MISSING | UNSYNCED | SYNCED | NATIVE_OK | NONE
  currentTrackId: string | undefined;
  title: string;
  artist: string;
  albumArtUrl: string | undefined;
  preFetch: import('./preFetch').PreFetchEntry | null;
}

declare global {
  interface Window {
    slyDetectNativeState: () => DetectorState;
  }
}

/**
 * Analyzes Spotify's current UI and internal state to determine
 * if our fallback lyrics are needed.
 */
window.slyDetectNativeState = function (): DetectorState {
  const { track } = window.spotifyState || {};
  const trackRecord = track as Record<string, unknown> | null;

  const state: DetectorState = {
    isAd: false,
    isOnLyricsPage: false, // Calculated below
    hasNativeLines: false,
    hasUnavailableMessage: false,
    lyricsState: 'LOADING', // LOADING, MISSING, UNSYNCED, SYNCED, NATIVE_OK
    currentTrackId: (trackRecord?.uri as string)?.split(':').pop(),
    title: (trackRecord?.name as string) || 'Unknown',
    artist: ((trackRecord?.artists as Record<string, string>[])?.[0]?.name) || 'Unknown Artist',
    albumArtUrl: (trackRecord?.metadata as Record<string, string>)?.image_large_url ||
                 ((trackRecord?.images as Record<string, string>[])?.[0]?.url),
    preFetch: null,
  };

  // 0. QUICK AD SCAN (Sovereign Check)
  // We do this first so we can bypass desync guards for ads.
  const adLink = document.querySelector('a[data-testid="now-playing-widget-ad-link"]') ||
                 document.querySelector('a[data-testid="ad-link"]');
  const adWidget = document.querySelector('[data-testid="now-playing-widget"][aria-label="Advertisement"]');
  const adBar = document.querySelector('[data-testid="now-playing-bar"][data-testadtype="ad-type-ad"]');

  state.isAd = trackRecord?.type === 'ad' ||
               state.title === 'Spotify' ||
               state.title === 'Advertisement' ||
               (!!state.currentTrackId && state.currentTrackId.includes('ad:')) ||
               !!adLink || !!adWidget || !!adBar;

  // 0.1 PAGE DETECTION (Dynamic)
  const containerClass = window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x';

  // We check URL, Button states (Main), and Native Container presence.
  // NOTE: There is no functional "now-playing-view-lyrics-button" (side button) in the Spotify UI DOM.
  // CRITICAL: We do NOT check for !!document.getElementById('lyrics-root-sync') here
  // to avoid a circular dependency that prevents the extension from switching off.
  const onLyricsPath = window.location.pathname === '/lyrics';
  const mainBtnPressed = document.querySelector('[data-testid="lyrics-button"]')?.getAttribute('aria-pressed') === 'true';
  const nativeFound = !!document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${containerClass}:not(#lyrics-root-sync)`);

  state.isOnLyricsPage = onLyricsPath || mainBtnPressed || nativeFound;

  if (state.isOnLyricsPage !== (window.slyInternalState as any).isOnLyricsPage) {
    console.log(`[sly-detector] 🗺️ Page Detection Change: ${state.isOnLyricsPage ? 'OPEN' : 'CLOSED'} | Path: ${onLyricsPath} | MainBtn: ${mainBtnPressed} | Native: ${nativeFound}`);
    (window.slyInternalState as any).isOnLyricsPage = state.isOnLyricsPage;
  }


  if (!trackRecord || !trackRecord.name) {
    if (state.isAd) return state; // Ad without metadata is still an ad
    state.lyricsState = 'NONE';
    state.title = 'Unknown';
    return state;
  }

  // 1. DESYNC GUARD (Bypassed for Ads)
  // Check if the track ID in the state matches our last internal reset.
  // If they don't match, a track switch is in progress and we should stay in LOADING.
  const internalUri = window.slyInternalState.lastUri;
  const currentUri = (trackRecord?.uri as string);
  if (!state.isAd && currentUri && internalUri && currentUri !== internalUri) {
    state.lyricsState = 'LOADING';
    return state;
  }

  const domTitle = document.querySelector('[data-testid="now-playing-widget-track-link"]')?.textContent ||
                   document.querySelector('[data-testid="context-item-info-title"]')?.textContent;

  if (!state.isAd && domTitle && trackRecord.name && domTitle !== trackRecord.name) {
    state.lyricsState = 'LOADING';
    return state;
  }

  if (state.isAd) return state;

  // 2. DOM SCANNING
  // Scavenge or fallback to known error containers. We check for actual visibility 
  // (not display: none) to avoid catching stale errors during track transitions.
  // GHOST GUARD: Ignore lines and error messages for 150ms after a song change to allow React to settle.
  const isSettling = window.slyInternalState.songSettlingUntil && Date.now() < window.slyInternalState.songSettlingUntil;

  const errorEl = document.querySelector('.' + (window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP')) as HTMLElement | null;
  const errorElAlt = document.querySelector('.' + (window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM')) as HTMLElement | null;
  state.hasUnavailableMessage = !isSettling && (
                                 (!!errorEl && (errorEl.offsetParent !== null || (errorEl.textContent || '').trim().length > 0)) || 
                                 (!!errorElAlt && (errorElAlt.offsetParent !== null || (errorElAlt.textContent || '').trim().length > 0))
                               );

  state.hasNativeLines = !isSettling && !!Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
                                 .find(el => !el.closest('#lyrics-root-sync'));

  // 3. GRACE PERIOD HANDLING

  // We give Spotify a 2-second window to load its own lyrics before we intervene
  if (!state.isOnLyricsPage) {
    window.slyInternalState.panelOpenTime = 0;
  } else if (!window.slyInternalState.panelOpenTime) {
    window.slyInternalState.panelOpenTime = Date.now();
  }
  const timeSinceOpen = window.slyInternalState.panelOpenTime
    ? (Date.now() - window.slyInternalState.panelOpenTime)
    : 0;

  // 4. PRE-FETCH REGISTRY CHECK
  // Consult the registry populated by the Background script/Interceptor
  state.preFetch = window.slyPreFetchRegistry.getState(state.currentTrackId ?? '') ?? null;

  if (state.preFetch && (state.preFetch.nativeStatus === 'MISSING' || state.preFetch.nativeStatus === 'ROMANIZED' || state.preFetch.nativeStatus === 'UNSYNCED')) {
    const reason = `PERSISTED_NATIVE_${state.preFetch.nativeStatus}`;
    state.lyricsState = reason; 

    if (!window.slyInternalState.forceFallback) {
      console.log(`[sly-detector] 🔎 EVIDENCE: Pre-fetch registry confirmed ${reason} state for track ${state.currentTrackId}. Triggering Fallback.`);
      window.slyInternalState.forceFallback = true;
    }
  } else if (state.preFetch?.nativeStatus === 'NATIVE_OK' || state.preFetch?.state === 'NATIVE_OK') {
    // SLY FIX: If the interceptor successfully upgraded the track, stand down and reset fallback.
    if (window.slyInternalState.forceFallback) {
      console.log(`[sly-detector] ✅ EVIDENCE: Pre-fetch registry confirmed NATIVE_OK for track ${state.currentTrackId}. Resetting Fallback.`);
      window.slyInternalState.forceFallback = false;
    }
  }

  // 4.5 NATIVE ROMANIZATION DETECTION (Aggressive Forensic Scan)
  // We don't trust Spotify's isDenseTypeface flag. We look at the actual DOM text.
  // However, we ONLY do this for languages that actually use a native script (Tamil, Hindi, etc.)
  const isNativeLanguage = window.SLY_NATIVE_LANGUAGES.has(window.spotifyState.language as string);

  // Strictly gate forensic scanning by the confirmed Language Tag.
  if (isNativeLanguage && state.hasNativeLines && timeSinceOpen > 1500 && !window.slyInternalState.forceFallback && state.preFetch?.state !== 'NATIVE_OK') {
    const nativeLines = Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
                            .filter(el => !el.closest('#lyrics-root-sync'))
                            .slice(0, 5)
                            .map(el => el.textContent)
                            .join(' ');

    const hasNativeScript = window.slyForensics.analyzeText(nativeLines).hasAnyNative;

    if (!hasNativeScript && window.spotifyState.lyricsProvider !== 'LRCLIB') {
      console.log(`[sly-detector] 🔎 EVIDENCE: Forensic DOM scan found NO native characters in a confirmed ${window.spotifyState.language} track. Triggering Fallback.`);
      window.slyInternalState.forceFallback = true;
      // Report Romanization failure for persistent 0ms hijack next time
      if (state.currentTrackId && !state.isAd && state.preFetch?.nativeStatus !== 'ROMANIZED') {
        browser.runtime.sendMessage({
          type: 'SLY_REPORT_NATIVE_STATUS',
          payload: { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'ROMANIZED', source: 'native' }
        }).catch(() => {});
      }
    }
  }

  // 5. DECISION MATRIX
  const isSettled = (Date.now() - window.slyInternalState.songChangeTime) > 500;
  
  // Guard against re-poisoning: If the registry already confirms NATIVE_OK or SYNCED,
  // do NOT let a fleeting DOM error message downgrade it to MISSING.
  const isProtected = state.preFetch?.nativeStatus === 'NATIVE_OK' || 
                      state.preFetch?.nativeStatus === 'SYNCED' ||
                      state.preFetch?.state === 'NATIVE_OK' ||
                      state.preFetch?.state === 'SYNCED';

  // SLY TEST: Disabling the React Context Provider Timeout (timeSinceOpen > 2500) to test for false positive prevention.
  const isNativeMissing = ((state.hasUnavailableMessage && isSettled && !isProtected) ||
                           state.preFetch?.nativeStatus === 'MISSING' ||
                           state.preFetch?.state === 'MISSING') && !state.hasNativeLines;

  const isNativeUnsynced = (window.spotifyState.isTimeSynced === false || 
                            state.preFetch?.nativeStatus === 'UNSYNCED' ||
                            state.preFetch?.state === 'UNSYNCED') &&
                           window.spotifyState.lyricsProvider !== null &&
                           window.spotifyState.lyricsProvider !== undefined;

  const isNativeSynced = window.spotifyState.isTimeSynced === true;

  // Determine the finalized state
  // IMMEDIATE HIJACK: If Spotify explicitly says it's missing (and we've settled), bypass all grace periods.
  if (state.hasUnavailableMessage && isSettled && !state.hasNativeLines && !isProtected) {
    state.lyricsState = 'MISSING_DOM';
    // Report this track as missing lyrics to the Background persistent cache
    if (state.currentTrackId && !state.isAd && state.preFetch?.nativeStatus !== 'MISSING') {
      const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'MISSING' as const, source: 'native' };
      browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
      // Also update local registry so concurrent fetches see it
      if (window.slyPreFetchRegistry) {
        window.slyPreFetchRegistry.register(state.currentTrackId, 'MISSING', { ...payload, nativeStatus: 'MISSING', reason: 'DOM Evidence (Error Message)' });
      }
    }
  } else if (!window.slyInternalState.forceFallback) {
    if (isNativeMissing) {
      const isTimeout = state.preFetch?.nativeStatus !== 'MISSING';
      state.lyricsState = isTimeout ? 'MISSING_TIMEOUT' : 'PERSISTED_MISSING';
      
      // SLY FIX: Report timeout-based missing state to Background
      if (isTimeout && state.currentTrackId && !state.isAd) {
        const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'MISSING' as const, source: 'native' };
        browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
        // Also update local registry so concurrent fetches see it
        if (window.slyPreFetchRegistry) {
          window.slyPreFetchRegistry.register(state.currentTrackId, 'MISSING', { ...payload, nativeStatus: 'MISSING', reason: 'Missing Timeout (2.5s)' });
        }
      }
    } else if (isNativeUnsynced) {
      state.lyricsState = state.preFetch?.nativeStatus === 'UNSYNCED' ? 'PERSISTED_UNSYNCED' : 'NATIVE_UNSYNCED';
      // SLY FIX: Always report native Unsynced state to Background to ensure persistent 0ms hijack next time,
      // even if our LOCAL preFetch registry already knows it (e.g. from Interceptor report).
      if (state.currentTrackId && !state.isAd) {
        const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'UNSYNCED' as const, source: 'native' };
        browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
        // Also update local registry so concurrent fetches see it
        if (window.slyPreFetchRegistry) {
          window.slyPreFetchRegistry.register(state.currentTrackId, 'UNSYNCED', { ...payload, nativeStatus: 'UNSYNCED', reason: 'DOM Evidence (Unsynced)' });
        }
      }
    } else if (isNativeSynced) {
      state.lyricsState = 'SYNCED';
      // SLY FIX: Report SYNCED state so it's cached proactively for future plays
      if (state.currentTrackId && !state.isAd && state.preFetch?.nativeStatus !== 'SYNCED') {
        const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'SYNCED' as const, source: 'native' };
        browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
        if (window.slyPreFetchRegistry) {
          window.slyPreFetchRegistry.register(state.currentTrackId, 'SYNCED', { ...payload, nativeStatus: 'SYNCED', reason: 'DOM Evidence (Synced)' });
        }
      }
    } else if (state.hasNativeLines) {
      state.lyricsState = 'NATIVE_OK';
      
      // SELF-HEALING: If we see native lines but the registry thought it was MISSING or ROMANIZED,
      // we have proof the registry is stale/wrong. Fix it.
      if (state.currentTrackId && !state.isAd && (state.preFetch?.nativeStatus === 'MISSING' || state.preFetch?.nativeStatus === 'ROMANIZED')) {
        console.log(`[sly-detector] 🩹 SELF-HEAL: Native lines found for track ${state.currentTrackId} which was tagged ${state.preFetch.nativeStatus}. Updating registry to NATIVE_OK.`);
        const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'NATIVE_OK' as const, source: 'native' };
        browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
        if (window.slyPreFetchRegistry) {
          window.slyPreFetchRegistry.register(state.currentTrackId, 'NATIVE_OK', { ...payload, nativeStatus: 'NATIVE_OK', reason: 'Self-Heal (DOM Evidence)' });
        }
        // Also reset the forceFallback flag so the Bridge can take back control immediately
        window.slyInternalState.forceFallback = false;
      }
    }
  }

  return state;
};
