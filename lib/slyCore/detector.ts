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

  // We check URL, Button states (Main and Sidebar), and Native Container presence.
  // CRITICAL: We do NOT check for !!document.getElementById('lyrics-root-sync') here
  // to avoid a circular dependency that prevents the extension from switching off.
  state.isOnLyricsPage = (window.location.pathname === '/lyrics') ||
                         (document.querySelector('[data-testid="lyrics-button"]')?.getAttribute('aria-pressed') === 'true') ||
                         (document.querySelector('[data-testid="now-playing-view-lyrics-button"]')?.getAttribute('aria-pressed') === 'true') ||
                         !!document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${containerClass}:not(#lyrics-root-sync)`);

  if (!trackRecord || !trackRecord.name) {
    if (state.isAd) return state; // Ad without metadata is still an ad
    state.lyricsState = 'NONE';
    state.title = 'Unknown';
    return state;
  }

  // 1. DESYNC GUARD (Bypassed for Ads)
  const domTitle = document.querySelector('[data-testid="now-playing-widget-track-link"]')?.textContent ||
                   document.querySelector('[data-testid="context-item-info-title"]')?.textContent;

  if (!state.isAd && domTitle && trackRecord.name && domTitle !== trackRecord.name) {
    state.lyricsState = 'LOADING';
    return state;
  }

  if (state.isAd) return state;

  // 2. DOM SCANNING
  // Scavenge or fallback to known error containers
  state.hasUnavailableMessage = !!document.querySelector('.' + (window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP')) || !!document.querySelector('.' + (window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM'));

  // Check for native lines while ignoring our own injected lines.
  // GHOST GUARD: Ignore lines for 150ms after a song change to allow React to settle.
  const isSettling = window.slyInternalState.songSettlingUntil && Date.now() < window.slyInternalState.songSettlingUntil;
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
  
  const isNativeMissing = ((state.hasUnavailableMessage && isSettled) ||
                           state.preFetch?.nativeStatus === 'MISSING' ||
                           state.preFetch?.state === 'MISSING' ||
                           (window.spotifyState.lyricsProvider === null && (Date.now() - window.slyInternalState.songChangeTime) > 2500)) && !state.hasNativeLines;

  const isNativeUnsynced = (window.spotifyState.isTimeSynced === false || 
                            state.preFetch?.nativeStatus === 'UNSYNCED' ||
                            state.preFetch?.state === 'UNSYNCED') &&
                           window.spotifyState.lyricsProvider !== null &&
                           window.spotifyState.lyricsProvider !== undefined;

  const isNativeSynced = window.spotifyState.isTimeSynced === true;

  // Determine the finalized state
  // IMMEDIATE HIJACK: If Spotify explicitly says it's missing (and we've settled), bypass all grace periods.
  if (state.hasUnavailableMessage && isSettled && !state.hasNativeLines) {
    state.lyricsState = 'MISSING_DOM';
    // Report this track as missing lyrics to the Background persistent cache
    if (state.currentTrackId && !state.isAd && state.preFetch?.nativeStatus !== 'MISSING') {
      browser.runtime.sendMessage({
        type: 'SLY_REPORT_NATIVE_STATUS',
        payload: { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'MISSING', source: 'native' }
      }).catch(() => {});
    }
  } else if (!window.slyInternalState.forceFallback) {
    if (isNativeMissing) {
      state.lyricsState = state.preFetch?.nativeStatus === 'MISSING' ? 'PERSISTED_MISSING' : 'MISSING_TIMEOUT';
    } else if (isNativeUnsynced) {
      state.lyricsState = state.preFetch?.nativeStatus === 'UNSYNCED' ? 'PERSISTED_UNSYNCED' : 'NATIVE_UNSYNCED';
      // SLY FIX: Always report native Unsynced state to Background to ensure persistent 0ms hijack next time,
      // even if our LOCAL preFetch registry already knows it (e.g. from Interceptor report).
      if (state.currentTrackId && !state.isAd && window.spotifyState.lyricsProvider !== null) {
        browser.runtime.sendMessage({
          type: 'SLY_REPORT_NATIVE_STATUS',
          payload: { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'UNSYNCED', source: 'native' }
        }).catch(() => {});
      }
    } else if (isNativeSynced) {
      state.lyricsState = 'SYNCED';
    } else if (state.hasNativeLines) {
      state.lyricsState = 'NATIVE_OK';
    }
  }

  return state;
};
