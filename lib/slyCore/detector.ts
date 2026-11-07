// @ts-nocheck
// Port of: lyric-test/modules/core/detector.js
import { getTrackDuration } from '../utils/spotifyUtils';
import { isLikelyRomanizedFallback, nonLatinLetterRatio } from '../lyrics/romanizedDetector';
import { isNativeLookupPending } from './state';
import { NOW_PLAYING_WIDGET, getNowPlayingTitle, getThemedPanelContainer, isLyricsButtonActive, titlesMatch } from '../dom/domQueries';
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
  album: string | undefined;
  duration: number | undefined; // Duration in seconds
  albumArtUrl: string | undefined;
  preFetch: import('./preFetch').PreFetchEntry | null;
}

let lastDetectionDebugSignature = '';
let lastKeptRomanizedUri = '';
// Onset of the current DOM-vs-bridge track-id disagreement (see the desync guard).
let trackIdMismatchKey = '';
let trackIdMismatchSince = 0;
const TRACK_ID_MISMATCH_GRACE_MS = 4000;

declare global {
  interface Window {
    slyDetectNativeState: () => Promise<DetectorState>;
  }
}

/** Containers whose lyric lines are the Now Playing view preview (or other mini surfaces), never the full panel. */
const LYRICS_PREVIEW_SELECTOR = `#Desktop_PanelContainer_Id, [data-testid="lyrics-npv-section"], aside[aria-label="Now playing view"], aside.NowPlayingView, [data-testid="now-playing-bar"], footer, ${NOW_PLAYING_WIDGET}`;


/** Full-panel Spotify lyric line wrappers (excludes our takeover root and the Now Playing view preview). */
function getFullPanelLineElements(): Element[] {
  return Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
    .filter(el => !el.closest('#lyrics-root-sync') && !el.closest(LYRICS_PREVIEW_SELECTOR));
}

/**
 * Text of the full-panel lines as Spotify (or the native-script upgrade) rendered
 * them. Pipeline B rewrites textContent for Romanized/Translated modes and keeps
 * the original in data-sly-original, so prefer that attribute.
 */
export function getFullPanelLineTexts(): string[] {
  return getFullPanelLineElements()
    .map(el => {
      const original = el.getAttribute('data-sly-original') ??
        el.querySelector('[data-sly-original]')?.getAttribute('data-sly-original');
      return (original ?? el.textContent ?? '').trim();
    })
    .filter(text => text.length > 0);
}

/**
 * K3 verdict for the on-screen lines. Any native-script letter vetoes it (same rule
 * as the interceptor): mixed native/English lyrics, common in K-pop/J-pop, can fall
 * below the detector's native-script ratio and match on the language tag alone.
 */
export function classifyOnScreenLines(texts: string[], spotifyLang?: string | null) {
  const hasNativeLetters = nonLatinLetterRatio(texts) > 0;
  const verdict = isLikelyRomanizedFallback(texts, spotifyLang);
  return { romanized: verdict.romanized && !hasNativeLetters, hasNativeLetters, verdict };
}

/**
 * Current track id from the Now Playing view's "playing from" link
 * (`/playlist/…?uid=…&uri=spotify:track:<id>`). The now-playing widget only links
 * to the album and artists in the 2026 UI, so this is the only DOM source of the id.
 */
export function getNowPlayingViewTrackId(): string | null {
  const link = document.querySelector(
    '#Desktop_PanelContainer_Id a[href*="uri=spotify:track:"], aside[aria-label="Now playing view"] a[href*="uri=spotify:track:"], aside.NowPlayingView a[href*="uri=spotify:track:"], ' +
    '#Desktop_PanelContainer_Id a[href*="uri=spotify%3Atrack%3A"], aside.NowPlayingView a[href*="uri=spotify%3Atrack%3A"]'
  );
  const href = link?.getAttribute('href') ?? '';
  let decoded = href;
  try { decoded = decodeURIComponent(href); } catch { /* keep raw href */ }
  const match = decoded.match(/spotify:track:([A-Za-z0-9]{22})/);
  return match ? match[1] : null;
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
    album: (trackRecord?.metadata as any)?.album_title || (trackRecord?.album as any)?.name || '',
    duration: getTrackDuration(trackRecord),
    albumArtUrl: (trackRecord?.metadata as Record<string, string>)?.image_large_url ||
                 ((trackRecord?.images as Record<string, string>[])?.[0]?.url),
    preFetch: null,
    currentUri: (trackRecord?.uri as string),
  };

  // 0. QUICK AD SCAN (Sovereign Check)
  // We do this first so we can bypass desync guards for ads.
  const adLink = document.querySelector('a[data-testid="now-playing-widget-ad-link"]') ||
                 document.querySelector('a[data-testid="ad-link"]');
  const adWidget = document.querySelector(NOW_PLAYING_WIDGET.split(', ').map(s => `${s}[aria-label="Advertisement"]`).join(', '));
  // Locale-independent: the now-playing bar carries data-testadtype="ad-type-none" while music plays
  // (verified 2026-10 and 2026-11); any other value means an ad is playing.
  const adTypeAttr = document.querySelector('[data-testid="now-playing-bar"]')?.getAttribute('data-testadtype');
  const adBar = (!!adTypeAttr && adTypeAttr !== 'ad-type-none') ||
                 !!document.querySelector('[data-testadtype="ad-type-ad"]');

  const localizedAdStrings = ['Spotify', 'Advertisement', 'Sponsored', 'Anzeige', 'Publicité', 'Publicidad', 'Publicidade', 'Annons', 'Reklama'];
  const isLocalizedAd = localizedAdStrings.includes(state.title);

  state.isAd = trackRecord?.type === 'ad' ||
               isLocalizedAd ||
               (!!state.currentTrackId && state.currentTrackId.includes('ad:')) ||
               !!adLink || !!adWidget || !!adBar;

  // 0.1 PAGE DETECTION (Dynamic)
  // 2026 UI: lyrics live in aside sidebar overlay, pathname stays
  // /collection/tracks etc. Keep legacy /lyrics path as fallback for A/B.
  const containerClass = window.SPOTIFY_CLASSES?.container;
  const mainClass = window.SPOTIFY_CLASSES?.mainContainer;

  // We check URL, Button states (Main), and Native Container presence.
  const onLyricsPath = window.location.pathname === '/lyrics' || window.location.pathname.startsWith('/lyrics');
  const mainBtnPressed = document.querySelector('[data-testid="lyrics-button"]')?.getAttribute('aria-pressed') === 'true' ||
                         document.querySelector('[data-testid="lyrics-button"]')?.getAttribute('data-active') === 'true';
  // Do not treat the persistent Now Playing preview or a mounted-but-closed
  // themed shell as the full lyrics panel. In the new UI, the button's active
  // state is authoritative; DOM evidence is only a fallback for old layouts
  // where Spotify removes/replaces the button.
  const fullPanelLines = getFullPanelLineElements();
  const legacyPanel = document.querySelector(`main.${mainClass || 'J6wP3V0xzh0Hj_MS'} .${containerClass || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync)`);
  const nativeFound = !document.querySelector('[data-testid="lyrics-button"]') &&
    (fullPanelLines.some(el => el.getClientRects().length > 0) || !!legacyPanel?.getClientRects().length);

  const isInCooldown = Date.now() < (window.slyInternalState.panelIntentCooldown || 0);
  state.isOnLyricsPage = !isInCooldown && (onLyricsPath || mainBtnPressed || nativeFound);

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

  // 2026 UI: the now-playing widget has no track link (only album/artist links), so
  // the DOM track id comes from the Now Playing view's "playing from" link. When the
  // ids agree the DOM and the bridge are on the same track; when they disagree a
  // switch is in progress. A disagreement that outlives the grace window is treated
  // as a stale link and the bridge URI wins.
  const domTrackId = !state.isAd ? getNowPlayingViewTrackId() : null;
  const bridgeTrackId = state.currentTrackId;
  if (domTrackId && bridgeTrackId && domTrackId !== bridgeTrackId) {
    const key = `${domTrackId}|${bridgeTrackId}`;
    if (key !== trackIdMismatchKey) {
      trackIdMismatchKey = key;
      trackIdMismatchSince = Date.now();
    }
    if (Date.now() - trackIdMismatchSince < TRACK_ID_MISMATCH_GRACE_MS) {
      state.lyricsState = 'LOADING';
      return state;
    }
  } else {
    trackIdMismatchKey = '';
  }

  // Title fallback when the Now Playing view link is not mounted.
  if (!state.isAd && !(domTrackId && domTrackId === bridgeTrackId)) {
    const domTitle = getNowPlayingTitle();
    if (domTitle && trackRecord.name && !titlesMatch(domTitle, trackRecord.name as string)) {
      state.lyricsState = 'LOADING';
      return state;
    }
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
  // If the class-based queries fail, scan the full lyrics panel for Spotify's error text.
  // Only while the lyrics button is active, only inside the full-panel themed container
  // (never div#main: playlist rows, the now-playing widget or the Now Playing view can
  // show a title such as "Unavailable"), never when that container shows Spotify's lyric
  // lines, and only lyrics-specific phrases (no bare "unavailable").
  let structuralError: HTMLElement | null = null;
  if (!errorEl && !errorElAlt && isLyricsButtonActive()) {
    const panel = getThemedPanelContainer();
    const panelHasLines = !!panel && Array.from(panel.querySelectorAll('[data-testid="lyrics-line"]'))
      .some(el => !el.closest('#lyrics-root-sync'));
    if (panel && !panelHasLines && !panel.closest(LYRICS_PREVIEW_SELECTOR)) {
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        if (node.parentElement?.closest('#lyrics-root-sync')) continue;
        const txt = (node.textContent || '').toLowerCase().replace(/\u2019/g, '\'');
        if (txt.includes('lyrics aren\'t available') || txt.includes('lyrics not available')) {
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

  const debugLineElements = getFullPanelLineElements();
  state.hasNativeLines = !isSettling && debugLineElements.length > 0;
  const lyricsButton = document.querySelector('[data-testid="lyrics-button"]');
  const lyricsButtonActive = lyricsButton?.getAttribute('data-active') === 'true' || lyricsButton?.getAttribute('aria-pressed') === 'true';
  const panelRoot = Array.from(document.querySelectorAll('div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)'))
    .find(el => !el.closest(LYRICS_PREVIEW_SELECTOR));
  const previewLineCount = document.querySelectorAll('#Desktop_PanelContainer_Id [data-testid="lyrics-line"], aside[aria-label="Now playing view"] [data-testid="lyrics-line"]').length;
  const debugSignature = [state.title, state.currentTrackId, state.isOnLyricsPage, lyricsButtonActive, debugLineElements.length, !!panelRoot, previewLineCount].join('|');
  if (debugSignature !== lastDetectionDebugSignature) {
    lastDetectionDebugSignature = debugSignature;
    console.info('[sly-debug] Panel/track state', {
      title: state.title,
      trackId: state.currentTrackId,
      path: location.pathname,
      panelOpen: state.isOnLyricsPage,
      lyricsButtonActive,
      fullPanelLineCount: debugLineElements.length,
      themedPanelFound: !!panelRoot,
      nowPlayingPreviewLineCount: previewLineCount,
      firstPanelLines: debugLineElements.slice(0, 3).map(el => el.textContent?.trim()),
    });
  }

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
  state.preFetch = (window as any).slyPreFetchRegistry?.getState(state.currentUri ?? '') ?? null;

  // K3 verdict for the on-screen full-panel lines, computed at most once per pass.
  // DOM lines existing is NOT proof the script is right: a romanized fallback renders
  // lines too. Any native-script letter counts as native (classifyOnScreenLines' veto).
  let onScreenVerdictCache: ReturnType<typeof classifyOnScreenLines> | undefined;
  const onScreenVerdict = () => {
    if (onScreenVerdictCache === undefined) {
      onScreenVerdictCache = classifyOnScreenLines(getFullPanelLineTexts(), window.spotifyState?.language);
    }
    return onScreenVerdictCache;
  };
  const onScreenIsNativeScript = (): boolean => onScreenVerdict().hasNativeLetters;

  // K5: the interceptor's Musixmatch lookup for this track has not reported back yet
  // (it can outlive SLY_INTERCEPT_END when the hold budget expires and finish "late"
  // with SKL_NATIVE_LYRICS or SLY_FORCE_FALLBACK). Until then, Spotify's romanized
  // lines are not final: do not arm the fallback or record a verdict from them.
  const nativeLookupPending = isNativeLookupPending(state.currentTrackId);

  // Live full-panel lyrics are stronger evidence than a previously persisted
  // MISSING result. NPV preview lines are excluded from hasNativeLines above.
  // If those lines are a romanized fallback, record ROMANIZED instead of NATIVE_OK
  // so the native-script fallback (and its quiet stand-down) still applies.
  if (state.hasNativeLines && (state.preFetch?.nativeStatus === 'MISSING' || state.preFetch?.state === 'MISSING')) {
    const healedStatus = onScreenVerdict().romanized
      ? 'ROMANIZED'
      : 'NATIVE_OK';
    console.log(`[sly-detector] 🩹 Live native lines override stale MISSING cache for ${state.currentUri} → ${healedStatus}.`);
    state.preFetch.nativeStatus = healedStatus;
    state.preFetch.state = healedStatus;
    if (healedStatus === 'NATIVE_OK') {
      // Clear the stale fallback flag before it can force Pipeline A to fetch again.
      window.slyInternalState.forceFallback = false;
    }
    if (state.currentUri) {
      window.slyPreFetchRegistry?.register(state.currentUri, healedStatus, {
        title: state.title,
        artist: state.artist,
        uri: state.currentUri,
        nativeStatus: healedStatus,
        reason: 'Self-Heal (Live full-panel DOM evidence)',
      });
      if (healedStatus === 'NATIVE_OK') window.slyInternalState.l0Cache?.delete(state.currentUri);
    }
    if (state.currentUri && typeof browser !== 'undefined' && browser.runtime?.id) {
      await browser.runtime.sendMessage({
        type: 'SLY_REPORT_NATIVE_STATUS',
        payload: { title: state.title, artist: state.artist, uri: state.currentUri, status: healedStatus, source: 'native' },
      }).catch(() => {});
    }
  }

  // A failed fallback fetch (FetchEngine) stands down to Spotify's lines; never re-arm it this session.
  const alreadyFailedThisSession = !!state.currentUri && !!window.slyInternalState.failedFetchUris?.has(state.currentUri);

  if (state.preFetch && (state.preFetch.nativeStatus === 'MISSING' || state.preFetch.nativeStatus === 'UNSYNCED')) {
    const reason = `PERSISTED_NATIVE_${state.preFetch.nativeStatus}`;
    state.lyricsState = reason; 

    if (!window.slyInternalState.forceFallback && !alreadyFailedThisSession) {
      console.log(`[sly-detector] 🔎 EVIDENCE: Pre-fetch registry confirmed ${reason} state for track ${state.currentTrackId}. Triggering Fallback.`);
      window.slyInternalState.forceFallback = true;
    }
  } else if (state.preFetch?.nativeStatus === 'ROMANIZED') {
    // Known-ROMANIZED (interceptor report, persisted cache or forensic scan): Spotify
    // shows Latin transliterations, so fall back at registry-check time instead of
    // waiting for the 1000ms forensic scan. Skipped while the interceptor's
    // native-script upgrade for this track is in flight or still pending a late
    // result (K5): SLY_FORCE_FALLBACK arms the fallback itself if that lookup fails.
    if (!window.slyInternalState.forceFallback && !alreadyFailedThisSession &&
        !window.slyInternalState.interceptorActive && !nativeLookupPending) {
      console.log(`[sly-detector] 🔎 EVIDENCE: Pre-fetch registry confirmed ROMANIZED for track ${state.currentTrackId}. Triggering Fallback.`);
      window.slyInternalState.forceFallback = true;
    }
  } else if (state.preFetch?.nativeStatus === 'NATIVE_OK' || state.preFetch?.nativeStatus === 'SYNCED' || state.preFetch?.state === 'NATIVE_OK' || state.preFetch?.state === 'SYNCED') {
    // SLY FIX: If the interceptor successfully upgraded the track, stand down and reset fallback.
    if (window.slyInternalState.forceFallback) {
      console.log(`[sly-detector] ✅ EVIDENCE: Pre-fetch registry confirmed NATIVE_OK for track ${state.currentTrackId}. Resetting Fallback.`);
      window.slyInternalState.forceFallback = false;
    }
  }

  // 4.5 NATIVE ROMANIZATION DETECTION (Forensic Scan of the on-screen lines)
  // We don't trust Spotify's isDenseTypeface flag or its language tag (romanized
  // Hindi arrives tagged "id"); K3: judge the actual full-panel text, with the tag
  // only as a hint. Runs only when nothing stronger has decided yet: no fallback in
  // progress, no failed fallback this session, no native-script upgrade in flight or
  // pending (K5), and the registry does not say NATIVE_OK (script confirmed: a
  // de-romanization success or a self-heal on native-script lines).
  // nativeStatus SYNCED is not script evidence: it is the bridge's isTimeSynced flag
  // recorded as "DOM Evidence (Synced)", and records persisted by older builds carry
  // it for romanized tracks too. So the scan still runs over SYNCED and, when it
  // fires, demotes the entry to ROMANIZED (see below).
  const registryConfirmsNative = state.preFetch?.nativeStatus === 'NATIVE_OK';
  if (state.hasNativeLines && timeSinceOpen > 1000 &&
      !window.slyInternalState.forceFallback &&
      !alreadyFailedThisSession &&
      !window.slyInternalState.interceptorActive &&
      !nativeLookupPending &&
      !registryConfirmsNative &&
      state.preFetch?.nativeStatus !== 'ROMANIZED' &&
      window.spotifyState?.lyricsProvider !== 'LRCLIB') {
    const { romanized, verdict } = onScreenVerdict();

    if (romanized) {
      console.log(`[sly-detector] 🔎 EVIDENCE: Forensic DOM scan: on-screen lines look like a romanized fallback (${verdict.reason}, lang=${verdict.lang}, tag=${window.spotifyState?.language ?? 'none'}). Triggering Fallback.`);
      window.slyInternalState.forceFallback = true;
      const liveEntry = state.currentUri ? window.slyPreFetchRegistry?.getState(state.currentUri) : null;
      if (state.preFetch?.nativeStatus === 'SYNCED' || liveEntry?.nativeStatus === 'SYNCED') {
        // ROMANIZED (priority 1) cannot outrank SYNCED (3) through register(), and the
        // NATIVE_OK/SYNCED branch above would reset the fallback on the next tick.
        // Same direct correction as the stale-MISSING self-heal.
        console.log(`[sly-detector] ⚠️ Registry SYNCED for ${state.currentUri} was not native script; demoting to ROMANIZED.`);
        if (state.preFetch?.nativeStatus === 'SYNCED') state.preFetch.nativeStatus = 'ROMANIZED';
        if (liveEntry?.nativeStatus === 'SYNCED') liveEntry.nativeStatus = 'ROMANIZED';
      }
      if (state.currentUri && !state.isAd) {
        // Record it locally so the registry check keeps the fallback armed and a
        // failed fallback fetch stands down quietly to Spotify's lines.
        window.slyPreFetchRegistry?.register(state.currentUri, 'ROMANIZED', {
          title: state.title,
          artist: state.artist,
          uri: state.currentUri,
          nativeStatus: 'ROMANIZED',
          source: 'native',
          reason: `Forensic DOM scan (${verdict.reason})`,
        });
        // Report Romanization failure for persistent 0ms hijack next time
        if (typeof browser !== 'undefined' && browser.runtime?.id) {
          await browser.runtime.sendMessage({
            type: 'SLY_REPORT_NATIVE_STATUS',
            payload: { title: state.title, artist: state.artist, uri: state.currentUri, status: 'ROMANIZED', source: 'native' }
          }).catch(() => {});
        }
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

  const isNativeSynced = window.spotifyState.isTimeSynced === true && !window.slyInternalState.forceFallback;

  // Determine the finalized state
  // SLY FIX: Prioritize NATIVE_OK above all other states. If we have live lines, 
  // we must trust them even if the registry previously forced a fallback.
  // This allows for Self-Healing of incorrect MISSING records in the cache.
  if (isNativeSynced) {
    state.lyricsState = 'SYNCED';
    // SLY FIX: Report SYNCED state so it's cached proactively for future plays.
    // Not for a ROMANIZED track showing Latin lines (e.g. after a failed fallback
    // stood down): synced romanized lines are not native script, and SYNCED would
    // outrank ROMANIZED in the registry and the persisted cache.
    const keepRomanized = state.preFetch?.nativeStatus === 'ROMANIZED' && !onScreenIsNativeScript();
    // isTimeSynced only says the lines are timed, not that they are native script.
    // Record SYNCED only after the forensic scan has had its chance on the same
    // lines (full panel visible past its 1000ms grace, no Layer-1 result pending)
    // and they do not look like a romanized fallback. Otherwise a first-tick SYNCED
    // would block the scan for the rest of the session and persist.
    const syncedEvidenceVerified = state.hasNativeLines && timeSinceOpen > 1000 &&
      !nativeLookupPending && !onScreenVerdict().romanized;
    if (state.currentUri && !state.isAd && state.preFetch?.nativeStatus !== 'SYNCED' && !keepRomanized && syncedEvidenceVerified) {
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
    // the registry may be stale. ROMANIZED tracks ALSO have DOM lines (Latin
    // transliterations), so ROMANIZED is only healed when the on-screen lines are
    // actually native script; otherwise the registry keeps ROMANIZED (and forceFallback).
    const wasRomanized = state.preFetch?.nativeStatus === 'ROMANIZED';
    const keepRomanized = wasRomanized && !onScreenIsNativeScript();
    if (keepRomanized && state.currentUri && lastKeptRomanizedUri !== state.currentUri) {
      lastKeptRomanizedUri = state.currentUri;
      console.log(`[sly-detector] ⚠️ ROMANIZED track ${state.currentUri} has Latin DOM lines — keeping ROMANIZED, not promoting to NATIVE_OK.`);
    }
    if (state.currentUri && !state.isAd && !keepRomanized && (state.preFetch?.nativeStatus === 'MISSING' || state.preFetch?.state === 'MISSING' || wasRomanized)) {
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

export interface TrackStateResolution {
  trackId: string;
  sourceState: 'SYNCED' | 'UNSYNCED' | 'ROMANIZED' | 'MISSING' | 'LOADING';
  action: 'NATIVE_ORIGINAL' | 'NATIVE_UPGRADED' | 'TAKEOVER_SYNCED' | 'TAKEOVER_UNSYNCED' | 'STANDBY';
  provider: 'SPOTIFY' | 'YTM' | 'LRCLIB' | 'MUSIXMATCH' | 'NONE';
}

export function resolveTrackState(
  detector: DetectorState,
  preFetch: any,
  cachedEntry: any
): TrackStateResolution {
  const trackId = detector.currentTrackId || '';
  
  const resolution: TrackStateResolution = {
    trackId,
    sourceState: 'LOADING',
    action: 'STANDBY',
    provider: 'NONE',
  };

  if (detector.isAd) {
    resolution.action = 'STANDBY';
    resolution.sourceState = 'LOADING';
    return resolution;
  }

  // 1. Determine Source State from Spotify DOM/Prefetch Evidence
  let spotifyStatus: 'SYNCED' | 'UNSYNCED' | 'ROMANIZED' | 'MISSING' | 'LOADING' = 'LOADING';
  
  if (preFetch) {
    if (preFetch.nativeStatus === 'MISSING' || preFetch.state === 'MISSING') {
      spotifyStatus = 'MISSING';
    } else if (preFetch.nativeStatus === 'UNSYNCED' || preFetch.state === 'UNSYNCED') {
      spotifyStatus = 'UNSYNCED';
    } else if (preFetch.nativeStatus === 'ROMANIZED' || preFetch.state === 'ROMANIZED') {
      spotifyStatus = 'ROMANIZED';
    } else if (preFetch.nativeStatus === 'SYNCED' || preFetch.nativeStatus === 'NATIVE_OK' || preFetch.state === 'SYNCED' || preFetch.state === 'NATIVE_OK') {
      spotifyStatus = 'SYNCED';
    }
  }

  // Fallback to DOM evidence if preFetch is still loading
  if (spotifyStatus === 'LOADING') {
    if (detector.hasNativeLines) {
      spotifyStatus = 'SYNCED';
    } else if (detector.hasUnavailableMessage) {
      spotifyStatus = 'MISSING';
    }
  }

  // 2026 UI: live DOM truth wins over stale preFetch MISSING.
  // Startup NPV failure reports MISSING to the background (7-day cache); when the
  // user later opens the lyrics panel with 37 native lines, preFetch still says
  // MISSING and forces a fetch loop + suppresses the pill. hasNativeLines already
  // excludes NPV preview/aside, so it is authoritative for the full panel.
  if (detector.hasNativeLines && spotifyStatus === 'MISSING') {
    spotifyStatus = 'SYNCED';
  }

  resolution.sourceState = spotifyStatus;

  // 2. Decision Logic ("God List" Priority Resolution)

  // Priority 1: Spotify Synced + Not Romanized -> Use native original!
  if (spotifyStatus === 'SYNCED' && !window.slyInternalState.forceFallback) {
    resolution.action = 'NATIVE_ORIGINAL';
    resolution.provider = 'SPOTIFY';
    return resolution;
  }

  // Priority 1b: Spotify only has a romanized fallback and the native-script
  // fallback fetch already failed and stood down this session (FetchEngine):
  // Spotify's own lines are the final answer, so stand down and let Pipeline B
  // (Romanized/Translated modes) work on them. The registry keeps ROMANIZED.
  if (spotifyStatus === 'ROMANIZED' && !window.slyInternalState.forceFallback && detector.hasNativeLines &&
      !!detector.currentUri && !!window.slyInternalState.failedFetchUris?.has(detector.currentUri)) {
    resolution.action = 'NATIVE_ORIGINAL';
    resolution.provider = 'SPOTIFY';
    return resolution;
  }

  // Priority 2: Spotify is Synced but Romanized -> Musixmatch native upgrade.
  if (spotifyStatus === 'ROMANIZED') {
    if (window.slyInternalState.pendingNativeLines?.has(trackId)) {
      resolution.action = 'NATIVE_UPGRADED';
      resolution.provider = 'MUSIXMATCH';
      return resolution;
    }
  }

  // Priority 3: If we have cached YTM/LRCLIB synced lyrics, we takeover immediately!
  if (cachedEntry) {
    if (cachedEntry.lyrics?.syncedLyrics) {
      resolution.action = 'TAKEOVER_SYNCED';
      resolution.provider = cachedEntry.lyrics.source || 'LRCLIB';
      return resolution;
    } else if (cachedEntry.lyrics?.plainLyrics) {
      if (spotifyStatus === 'MISSING' || spotifyStatus === 'UNSYNCED') {
        resolution.action = 'TAKEOVER_UNSYNCED';
        resolution.provider = cachedEntry.lyrics.source || 'LRCLIB';
        return resolution;
      }
    }
  }

  // Priority 4: Spotify Unsynced or Missing -> Standby/Trigger search.
  if (spotifyStatus === 'UNSYNCED' || spotifyStatus === 'MISSING') {
    resolution.action = 'STANDBY';
  }

  return resolution;
}
