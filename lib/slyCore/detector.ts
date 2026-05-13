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
    slyDetectNativeState: () => Promise<DetectorState>;
  }
}

/**
 * Analyzes Spotify's current UI and internal state to determine
 * if our fallback lyrics are needed.
 */
window.slyDetectNativeState = async function (): Promise<DetectorState> {
  const { track } = window.spotifyState || {};
  const trackRecord = track as Record<string, unknown> | null;

  const state: DetectorState = {
    isAd: false,
    isOnLyricsPage: false, // Calculated below
    hasNativeLines: false,
    hasUnavailableMessage: false,
    lyricsState: 'LOADING', // LOADING, MISSING, UNSYNCED, SYNCED, NATIVE_OK
    currentTrackId: (trackRecord?.uri as string)?.split(':').pop(),
    title: (trackRecord?.name as string) || '',
    artist: (trackRecord?.metadata as any)?.artist_name || (trackRecord?.artists as any)?.[0]?.name || '',
    albumArtUrl: (trackRecord?.metadata as Record<string, string>)?.image_large_url ||
                 ((trackRecord?.images as Record<string, string>[])?.[0]?.url),
    preFetch: null,
    currentUri: (trackRecord?.uri as string),
  };

  // 0. QUICK AD SCAN (Sovereign Check)
  // We do this first so we can bypass desync guards for ads.
  const adLink = document.querySelector('a[data-testid="now-playing-widget-ad-link"]') ||
                 document.querySelector('a[data-testid="ad-link"]');
  const adWidget = document.querySelector('[data-testid="now-playing-widget"][aria-label="Advertisement"]');
  const adBar = document.querySelector('[data-testid="now-playing-bar"][data-testadtype="ad-type-ad"]') ||
                 document.querySelector('[data-testadtype="ad-type-ad"]');

  const localizedAdStrings = ['Spotify', 'Advertisement', 'Sponsored', 'Anzeige', 'Publicité', 'Publicidad', 'Publicidade', 'Annons', 'Reklama'];
  const isLocalizedAd = localizedAdStrings.includes(state.title);

  state.isAd = trackRecord?.type === 'ad' ||
               isLocalizedAd ||
               (!!state.currentTrackId && state.currentTrackId.includes('ad:')) ||
               !!adLink || !!adWidget || !!adBar;

  // 0.1 PAGE DETECTION (Dynamic)
  const containerClass = window.SPOTIFY_CLASSES?.container;
  const mainClass = window.SPOTIFY_CLASSES?.mainContainer;

  // We check URL, Button states (Main), and Native Container presence.
  const onLyricsPath = window.location.pathname === '/lyrics';
  const mainBtnPressed = document.querySelector('[data-testid="lyrics-button"]')?.getAttribute('aria-pressed') === 'true';
  const nativeFound = !!(mainClass && containerClass && document.querySelector(`main.${mainClass} .${containerClass}:not(#lyrics-root-sync)`));

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
  
  // SLY FIX (BUG-B15): Structural Fallback.
  // If the class-based queries fail, we scan the lyrics container for "unavailable" text.
  let structuralError: HTMLElement | null = null;
  if (!errorEl && !errorElAlt) {
    const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`);
    if (main) {
      // Find elements with text matching common error patterns
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        const txt = node.textContent?.toLowerCase() || '';
        if (txt.includes('lyrics aren\'t available') || txt.includes('lyrics not available') || txt.includes('unavailable')) {
          structuralError = node.parentElement;
          break;
        }
      }
    }
  }

  const isRealError = (el: HTMLElement | null) => {
    if (!el) return false;
    const txt = (el.textContent || '').trim().toLowerCase();
    if (!txt || txt.includes('loading')) return false;
    return el.offsetParent !== null && txt.length > 0;
  };

  state.hasUnavailableMessage = !isSettling && (isRealError(errorEl) || isRealError(errorElAlt) || isRealError(structuralError));

  if (state.hasUnavailableMessage) {
    if (errorEl && isRealError(errorEl)) {
      console.log(`[sly-audit] 🚨 hasUnavailableMessage is true. Found errorEl <${errorEl.tagName}>. Classes: "${errorEl.className}". Text: "${(errorEl.textContent || '').trim().slice(0, 60)}". Visible (offsetParent): ${errorEl.offsetParent !== null}`);
    }
    if (errorElAlt && isRealError(errorElAlt)) {
      console.log(`[sly-audit] 🚨 hasUnavailableMessage is true. Found errorElAlt <${errorElAlt.tagName}>. Classes: "${errorElAlt.className}". Text: "${(errorElAlt.textContent || '').trim().slice(0, 60)}". Visible (offsetParent): ${errorElAlt.offsetParent !== null}`);
    }
  }

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
  state.preFetch = window.slyPreFetchRegistry.getState(state.currentUri ?? '') ?? null;

  if (state.preFetch && (state.preFetch.nativeStatus === 'MISSING' || state.preFetch.nativeStatus === 'ROMANIZED' || state.preFetch.nativeStatus === 'UNSYNCED')) {
    const reason = `PERSISTED_NATIVE_${state.preFetch.nativeStatus}`;
    state.lyricsState = reason; 

    if (!window.slyInternalState.forceFallback) {
      console.log(`[sly-detector] 🔎 EVIDENCE: Pre-fetch registry confirmed ${reason} state for track ${state.currentTrackId}. Triggering Fallback.`);
      window.slyInternalState.forceFallback = true;
    }
  } else if (state.preFetch?.nativeStatus === 'NATIVE_OK' || state.preFetch?.nativeStatus === 'SYNCED' || state.preFetch?.state === 'NATIVE_OK' || state.preFetch?.state === 'SYNCED') {
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
        await browser.runtime.sendMessage({
          type: 'SLY_REPORT_NATIVE_STATUS',
          payload: { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'ROMANIZED', source: 'native' }
        }).catch(() => {});
      }
    }
  }

  // 5. DECISION MATRIX
  // SLY FIX: Increase isSettled to 1000ms to allow React clearing races to resolve
  const isSettled = (Date.now() - window.slyInternalState.songChangeTime) > 1000;
  
  // Guard against re-poisoning: If the registry already confirms NATIVE_OK or SYNCED,
  // do NOT let a fleeting DOM error message downgrade it to MISSING.
  const isProtected = state.preFetch?.nativeStatus === 'NATIVE_OK' || 
                      state.preFetch?.nativeStatus === 'SYNCED' ||
                      state.preFetch?.state === 'NATIVE_OK' ||
                      state.preFetch?.state === 'SYNCED';

  // SLY TEST: Disabling the React Context Provider Timeout (timeSinceOpen > 2500) to test for false positive prevention.
  // SLY FIX: Background Throttling Guard
  // If the document is hidden, we stay in LOADING unless we have a definitive pre-fetch hit.
  // This prevents the engine from acting on throttled/stale Fiber data in the background.
  const isNativeMissing = !document.hidden &&
                           ((state.hasUnavailableMessage && isSettled && !isProtected) ||
                            state.preFetch?.nativeStatus === 'MISSING' ||
                            state.preFetch?.state === 'MISSING') && !state.hasNativeLines;

  const isNativeUnsynced = !document.hidden &&
                           ((window.spotifyState.isTimeSynced === false && 
                             window.spotifyState.lyricsProvider !== null &&
                             window.spotifyState.lyricsProvider !== undefined) || 
                            state.preFetch?.nativeStatus === 'UNSYNCED' ||
                            state.preFetch?.state === 'UNSYNCED');

  const isNativeSynced = window.spotifyState.isTimeSynced === true;

  // Determine the finalized state
  // SLY FIX: Prioritize NATIVE_OK above all other states. If we have live lines, 
  // we must trust them even if the registry previously forced a fallback.
  // This allows for Self-Healing of incorrect MISSING records in the cache.
  if (isNativeSynced) {
    state.lyricsState = 'SYNCED';
    // SLY FIX: Report SYNCED state so it's cached proactively for future plays
    if (state.currentUri && !state.isAd && state.preFetch?.nativeStatus !== 'SYNCED') {
      const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'SYNCED' as const, source: 'native' };
      if (typeof browser !== 'undefined' && browser.runtime?.id) {
        await browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
      }
      if (window.slyPreFetchRegistry) {
        window.slyPreFetchRegistry.register(state.currentUri, 'SYNCED', { ...payload, nativeStatus: 'SYNCED', reason: 'DOM Evidence (Synced)' });
      }
    }
  } else if (isNativeUnsynced) {
    state.lyricsState = state.preFetch?.nativeStatus === 'UNSYNCED' ? 'PERSISTED_UNSYNCED' : 'NATIVE_UNSYNCED';
    // SLY FIX: Always report native Unsynced state to Background to ensure persistent 0ms hijack next time,
    // even if our LOCAL preFetch registry already knows it (e.g. from Interceptor report).
    if (state.currentUri && !state.isAd) {
      const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'UNSYNCED' as const, source: 'native' };
      if (typeof browser !== 'undefined' && browser.runtime?.id) {
        await browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
      }
      // Also update local registry so concurrent fetches see it
      if (window.slyPreFetchRegistry) {
        window.slyPreFetchRegistry.register(state.currentUri, 'UNSYNCED', { ...payload, nativeStatus: 'UNSYNCED', reason: 'DOM Evidence (Unsynced)' });
      }
    }
  } else if (state.hasNativeLines) {
    state.lyricsState = 'NATIVE_OK';
    
    // SELF-HEALING: If we see native lines but the registry thought it was MISSING or ROMANIZED,
    // we have proof the registry is stale/wrong. Fix it.
    if (state.currentUri && !state.isAd && (state.preFetch?.nativeStatus === 'MISSING' || state.preFetch?.nativeStatus === 'ROMANIZED')) {
      console.log(`[sly-detector] 🩹 SELF-HEAL: Native lines found for track ${state.currentUri} which was tagged ${state.preFetch.nativeStatus}. Updating registry to NATIVE_OK.`);
      const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'NATIVE_OK' as const, source: 'native' };
      if (typeof browser !== 'undefined' && browser.runtime?.id) {
        await browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
      }
      if (window.slyPreFetchRegistry) {
        window.slyPreFetchRegistry.register(state.currentUri, 'NATIVE_OK', { ...payload, nativeStatus: 'NATIVE_OK', reason: 'Self-Heal (DOM Evidence)' });
      }
      // Also reset the forceFallback flag so the Bridge can take back control immediately
      window.slyInternalState.forceFallback = false;

      // BUG-A7: Invalidate the L0 session cache so any stale "Failed" or ROMANIZED state 
      // in memory doesn't block the native recovery verified by this DOM snapshot.
      if (window.slyInternalState.l0Cache) {
        window.slyInternalState.l0Cache.delete(state.currentUri);
      }
    }
  } else if (state.hasUnavailableMessage && isSettled && !state.hasNativeLines && !isProtected) {
    state.lyricsState = 'MISSING_DOM';
    // Report this track as missing lyrics to the Background persistent cache
    if (state.currentUri && !state.isAd && state.preFetch?.nativeStatus !== 'MISSING') {
      const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'MISSING' as const, source: 'native' };
      if (typeof browser !== 'undefined' && browser.runtime?.id) {
        await browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
      }
      // Also update local registry so concurrent fetches see it
      if (window.slyPreFetchRegistry) {
        window.slyPreFetchRegistry.register(state.currentUri, 'MISSING', { ...payload, nativeStatus: 'MISSING', reason: 'DOM Evidence (Error Message)' });
      }
    }
  } else if (!window.slyInternalState.forceFallback) {
    if (isNativeMissing) {
      const isTimeout = state.preFetch?.nativeStatus !== 'MISSING';
      state.lyricsState = isTimeout ? 'MISSING_TIMEOUT' : 'PERSISTED_MISSING';
      
      // SLY FIX: Report timeout-based missing state to Background
      if (isTimeout && state.currentUri && !state.isAd) {
        const payload = { title: state.title, artist: state.artist, uri: (window as any).spotifyState?.track?.uri, status: 'MISSING' as const, source: 'native' };
        if (typeof browser !== 'undefined' && browser.runtime?.id) {
        await browser.runtime.sendMessage({ type: 'SLY_REPORT_NATIVE_STATUS', payload }).catch(() => {});
      }
        // Also update local registry so concurrent fetches see it
        if (window.slyPreFetchRegistry) {
          window.slyPreFetchRegistry.register(state.currentUri, 'MISSING', { ...payload, nativeStatus: 'MISSING', reason: 'Missing Timeout (2.5s)' });
        }
      }
    }
  }

  return state;
};
