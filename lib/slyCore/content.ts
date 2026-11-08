declare const browser: any;
import { isContextValid, safeClone } from '../utils/browserUtils';
import { getFallbackLayoutHost, getLyricsLines, getThemedPanelContainer, isLyricsButtonActive, playingTrackUri } from '../dom/domQueries';
import { purgeSlyDOM } from '../dom/lyricsDOM';
import { slyRestoreOverlayContent } from './domEngine';
import { isPillDocked } from '../dom/lyricsControls';
import { loadLyricsKitSnapshot } from './scavenger';
import { WarmingEngine } from './warmingEngine';
import { StatusEngine } from './statusEngine';
import { resolveTrackState } from './detector';
import { traceEvent } from '../testHooks';

console.log('[sly] DOM Engine starting...');
if (window.slyInjectCoreStyles) window.slyInjectCoreStyles();

// Learn Spotify's lyrics class names right away (last live panel on this build, then
// Spotify's stylesheet), so lyrics shown where Spotify has none use Spotify's own look
// even before any native lyrics panel has been on screen.
const startLyricsKit = () => {
  void loadLyricsKitSnapshot().finally(() => window.slyDeepScavengeStyles?.());
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLyricsKit, { once: true });
else startLyricsKit();

const LEGACY_MAIN_CLASS = 'J6wP3V0xzh0Hj_MS';

/**
 * K11: the element that carries the "sly-active" / "sly-hud-active" layout classes.
 * 2026 UI: the parent of the full-panel themed container (the slot slyPrepareContainer
 * inserts #lyrics-root-sync into). Without a themed panel: the Now Playing overlay
 * (legacy UI: the <main> container), see getFallbackLayoutHost.
 */
function getSlyLayoutHost(): HTMLElement | null {
  const themed = getThemedPanelContainer();
  if (themed?.parentElement) return themed.parentElement as HTMLElement;
  return getFallbackLayoutHost();
}

/** Native lyrics container to hide behind / restore after a takeover (themed panel first, legacy fallback). */
function getNativeLyricsContainer(): HTMLElement | null {
  return (getThemedPanelContainer() ??
    document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || LEGACY_MAIN_CLASS} .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync)`)) as HTMLElement | null;
}

// Start of the current run of ignored sly:panel_close events (see the guard below).
let panelCloseIgnoredSince = 0;

/** currentLyrics is a failure marker for this track (FetchEngine's failure object carries no _slyUri). */
function isFailedForCurrent(currentLyrics: unknown, fullUri: string | undefined): boolean {
  const cl = currentLyrics as Record<string, unknown> | null;
  return !!cl?.failed && (!cl._slyUri || cl._slyUri === fullUri);
}

// --- HOT RELOAD CLEANUP PROTOCOL ---
if (window.antigravityInterval) clearTimeout(window.antigravityInterval as number);
if (window.slyPreFetchInterval) clearInterval(window.slyPreFetchInterval);
if (window.antigravitySyncAnimFrame) cancelAnimationFrame(window.antigravitySyncAnimFrame);
if (window.antigravitySyncButtonAnimFrame) cancelAnimationFrame(window.antigravitySyncButtonAnimFrame);
document.querySelectorAll('#lyrics-root-sync, #sly-hijack-styles, #sly-status-hud, #sly-mode-pill, #sly-sync-button').forEach(node => node.remove());

// Note: Navigation Interceptor, Interaction Monitoring, and Button Hijack have been moved to modules/content-events.js

// --- STATE SYNC ---

// Note: Internal extension state is now managed by window.slyInternalState in modules/state-manager.js
window.slyCheckNowPlaying = slyCheckNowPlaying;

// 0. Initialize Warming Engine (Proactive Hydration)
WarmingEngine.init();

// (Formerly sly_state_update listener for queue warming - now handled by WarmingEngine)

// 1. Session & Entry Point Detection
const isFirstLoad = !sessionStorage.getItem('sly_session_active');
const isLyricsEntryPoint = window.location.pathname.startsWith('/lyrics') && isFirstLoad;

if (isFirstLoad) {
  sessionStorage.setItem('sly_session_active', 'true');
  if (isLyricsEntryPoint) {
    console.log('[sly] 🛡️ Entry Point detected on /lyrics. Marking for Safety Bounce.');
    browser.runtime.sendMessage({ type: 'SLY_MARK_ENTRY_POINT' }).catch(() => {});
  }
}

// BUG-B11: Interceptor Heartbeat
// We wait 2 seconds for the MAIN world interceptor to signal readiness. 
// If it fails (e.g. CSP block), we fall back to a safer native detection mode.
// Ping the interceptor immediately to initiate an active handshake (fixes reload race condition).
window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_PING_INTERCEPTOR' } }, '*');

// K4: the heartbeat reads interceptorReady, which only SLY_INTERCEPTOR_READY (or an
// actual intercept) sets and track resets never clear. interceptorActive is the
// separate in-flight flag (SLY_INTERCEPT_START..END, see messaging.ts).
setTimeout(() => {
  if (!window.slyInternalState.interceptorReady) {
    console.warn('[sly] Interceptor Heartbeat: FAILED. Falling back to passive native detection.');
    window.slyInternalState.interceptorFailed = true;
  }
}, 2000);

// Relay messages from Bridge (MAIN world) to Background (Extension world)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'SLY_INTERCEPTOR_READY' || event.data?.action?.type === 'SLY_INTERCEPTOR_READY') {
    window.slyInternalState.interceptorFailed = false;
    if (!window.slyInternalState.interceptorReady) {
      console.log('[sly] Interceptor Heartbeat: Confirmed Healthy.');
    }
    window.slyInternalState.interceptorReady = true;
  }
  if (event.data?.source === 'SLY_NAV_RELAY' && event.data?.type === 'SLY_NAV_BACK') {
    // BUG-14 Fix: Include entry point flag in message. sessionStorage survives 
    // tab reloads, while SW state (slyEntryPoints) is lost on restart.
    browser.runtime.sendMessage({ 
      type: 'SLY_NAV_BACK',
      isEntryPoint: isLyricsEntryPoint
    }).catch(() => {});
  }
});

// Note: Pipeline B's lifecycleController.ts onSongChange detects track changes reactively
// via aria-label mutation and dispatches 'sly:song_change'. Our own 500ms poll (Step 1.5)
// and the 'sly_state_update' bridge listener (line 26) ensure redundant coverage.

// Pipeline B's syncSetup() dispatches this when native lyrics are in the DOM.
// Triggers the injection gate immediately for the common case where the fetch
// completed before the panel opened, saving up to 500ms of poll latency.
// slyCheckNowPlaying() reuses all existing guards — no logic is duplicated.
document.addEventListener('sly:lyrics_injected', async () => {
  // No guard — call slyCheckNowPlaying() unconditionally so it handles both:
  //   • Injection gate: pendingLyricsData ready, panel just opened (Case B)
  //   • Persistence: currentLyrics active, panel re-opened, #lyrics-root-sync missing
  // Cost for normal songs: one extra cheap call per panel open — negligible since
  // slyCheckNowPlaying() already runs every 500ms.
  await window.slyCheckNowPlaying!();
});

// Pipeline B's domObserver dispatches this when [data-testid="lyrics-button"] loses
// its data-active="true" attribute. Handles panel close cleanup immediately instead
// of waiting up to 500ms for the poll.
// 2026 UI: pathname no longer changes to /lyrics (aside overlay), so use button state.
document.addEventListener('sly:panel_close', () => {
  // SLY RACE-CONDITION FIX: Ignore panel close events triggered during song transitions
  // if we are actively on the lyrics page and currently fetching or showing a failure HUD.
  // Spotify's React app temporarily clears the lyrics button's active attributes during track skips,
  // which falsely triggers this event and clears our active HUD.
  // 2026 UI: "still on the lyrics panel" = button active, legacy /lyrics route, or the
  // full panel still mounted (themed container / full-panel lines; both exclude the
  // Now Playing view preview). Preview lines in the aside mean the full panel is
  // CLOSED, so they must never count here.
  const fullPanelMounted = !!getThemedPanelContainer() || getLyricsLines().length > 0;
  const isOnLyricsPage = isLyricsButtonActive() || window.location.pathname.startsWith('/lyrics') || fullPanelMounted;
  if (isOnLyricsPage && (window.slyInternalState.isFetchingHUD || window.slyInternalState.statusHUDActive)) {
    // Bound the ignore window: a genuine close that leaves the panel mounted (e.g. a
    // close animation) is retried by the orphan guard every tick and must get through.
    const now = Date.now();
    if (!panelCloseIgnoredSince || now - panelCloseIgnoredSince > 5000) panelCloseIgnoredSince = now;
    if (now - panelCloseIgnoredSince < 1500) {
      console.log('[sly-lifecycle] 🛡️ Ignoring sly:panel_close during song transition to prevent HUD flicker.');
      return;
    }
  }
  panelCloseIgnoredSince = 0;

  // BUG-38 Fix (REGRESSION FIX): We no longer clear currentLyrics here.
  // Before: Clearing currentLyrics on panel close broke the "Recovery" feature, 
  // forcing a re-fetch and causing synced lyrics to revert to unsynced on reopen.
  // After: currentLyrics is preserved; only pending metadata is cleared.
  window.slyInternalState.forceFallback = false;
  // BUG-38 Fix: Only clear pendingLyricsData on panel close to prevent stale injections.
  // We PRESERVE fetchingForTitle/Uri and isFetchingHUD so that reopening the panel
  // can "continue" an in-flight fetch visually (HUD recovery).
  window.slyInternalState.pendingLyricsData = null;

  // SLY FIX (BUG-36): Always clear the status HUD on panel close to prevent orphaned overlays.
  // We use preserveState=true so that reopening the panel can recover the "Fetching" HUD.
  StatusEngine.clear(true);

  const root = document.getElementById('lyrics-root-sync');
  // K11: collect the layout-class host before the root is removed. The root's own
  // parent is the same slot; it covers a themed container React already unmounted.
  const layoutHosts = new Set<HTMLElement>();
  const layoutHost = getSlyLayoutHost();
  if (layoutHost) layoutHosts.add(layoutHost);
  if (root?.parentElement) layoutHosts.add(root.parentElement as HTMLElement);
  if (root) {
    console.log('[sly-lifecycle] 🧹 Cleaning up injected #lyrics-root-sync and restoring native UI.');
    
    // SLY FIX (BUG-35): Manually rescue the mode pill to document.body before removing the root.
    // This prevents the pill from being destroyed while allowing us to dispatch 'sly:release'
    // AFTER the DOM has settled, avoiding stale layout reads in Pipeline B.
    // BUG-2 Fix: Was using wrong ID 'sly-mode-pill' — actual ID is 'sly-lyrics-controls'.
    const pill = document.getElementById('sly-lyrics-controls');
    // A pill in its home on the view stays while the view is open (a release, not a close).
    if (pill && !(isPillDocked(pill) && isLyricsButtonActive())) document.body.appendChild(pill);

    slyRestoreOverlayContent();
    root.remove();
  }

  // Spotify's own Now Playing content comes back even when the root was already gone.
  slyRestoreOverlayContent();

  // SLY FIX (BUG-35): Dispatch release AFTER removing root so listeners see the final DOM state.
  document.dispatchEvent(new CustomEvent('sly:release'));

  // BUG-2 Fix: sly:release → parkPill() moves the pill to document.body with display:''
  // (visible). That's correct for SONG TRANSITIONS where we want the pill to persist.
  // But this is a PANEL CLOSE — no lyrics container exists, so the pill must be hidden.
  // Without this, the pill's CSS (position:fixed/absolute) renders a visible sliver
  // at the bottom of the viewport after the panel is closed.
  const pillAfterRelease = document.getElementById('sly-lyrics-controls');
  if (pillAfterRelease && pillAfterRelease.parentElement === document.body) {
    pillAfterRelease.style.display = 'none';
  }

  const syncBtn = document.getElementById('sly-sync-button');
  if (syncBtn) syncBtn.remove();
  
  layoutHosts.forEach(host => host.classList.remove('sly-active', 'sly-hud-active'));

  const errCls1 = window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP';
  const errCls2 = window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM';
  document.querySelectorAll(`.${errCls1}, .${errCls2}`)
    .forEach(n => ((n as HTMLElement).style.display = ''));

  // Un-hide the native panel that the HUD/takeover hid (themed container first, legacy fallback).
  const nativeContainer = getNativeLyricsContainer();
  if (nativeContainer) nativeContainer.style.display = '';

  // SLY FIX: Physically remove all injected spans and attributes from the native DOM
  // when the panel is closed. This prevents stale state from interfering with 
  // future track detections or React reconciliations.
  // Other songs' panels keep their paint: closing on a skip to a song without lyrics showed
  // the song being left in its original lines as it slid out (live 2026-11-08).
  purgeSlyDOM({ keepSongsOtherThan: playingTrackUri() || null });
});

// slyCore records the incoming lyrics object when Pipeline B signals injection.
// lyricsObj.lines will be populated by slyBuildLyricsList later (same object reference).
document.addEventListener('sly:inject', (e: Event) => {
  const { lyricsObj } = (e as CustomEvent<{ lyricsObj: Record<string, unknown> }>).detail;
  // Stamp the URI at injection time so Step 1.5 can check if the skip target
  // is already the track we have lyrics for.
  // Cached lyrics put in before the bridge names the track carry their own (right) URI.
  const currentUri = (lyricsObj as any)._slyEarly
    ? (lyricsObj as any)._slyUri as string
    : (window.spotifyState?.track as Record<string, unknown>)?.uri as string | undefined || (lyricsObj as any)._slyUri;
  if (currentUri) lyricsObj._slyUri = currentUri;
  window.slyInternalState.currentLyrics = lyricsObj;
  window.slyInternalState.isTransitioning = false; // Transition complete
});

document.addEventListener('sly:song_change', async (e) => {
  const { uri } = (e as CustomEvent).detail;
  if (!uri || uri === 'undefined' || uri === 'null') return;
  
  console.log(`[sly-lifecycle] ⚡ Reactive Song Change Detected: ${uri}. Re-evaluating state.`);
  window.slyInternalState.isTransitioning = true;
  
  // Clear the HUD immediately on skip to prevent ghost error messages
  StatusEngine.clear();

  // SLY FIX: Synchronously clear all fetching state flags here for redundancy.
  // This ensures that even if the poll tick runs before the bridge syncs,
  // it won't see a "zombie" fetching state from the previous song.
  window.slyInternalState.isFetchingHUD = false;
  window.slyInternalState.statusHUDActive = false;
  window.slyInternalState.fetchingForTitle = '';
  window.slyInternalState.fetchingForUri.clear();
  
  // Check the new song now (a kick never starts a second poll next to a running one).
  window.slyKickPoll?.();
});

// sly:takeover only fires when injection fully succeeded (all four DOM steps complete).
// slyCore clears its own pending state here — no longer Pipeline B's responsibility.
document.addEventListener('sly:takeover', () => {
  window.slyInternalState.fetchingForTitle = '';
});

/**
 * Checks the current playback state and triggers lyrics injection if necessary.
 * SMOOTH TRANSITION FIX: Removed 50ms debounce.
 * Before: Used a setTimeout(() => ..., 50) to aggregate multiple state updates.
 * After: Calls slyCheckNowPlayingInternal() synchronously.
 * Why: To eliminate the ~3-frame delay when opening the lyrics panel, reducing visible "pop-in" flicker.
 */
async function slyCheckNowPlaying(): Promise<void> {
  await slyCheckNowPlayingInternal();
}

async function slyCheckNowPlayingInternal(): Promise<void> {
  // SLY FIX: If the extension was reloaded/updated, the context is invalidated.
  // Abort immediately to prevent "Extension context invalidated" errors.
  if (typeof browser === 'undefined' || !browser.runtime?.id) return;

  try {
    const detection = await window.slyDetectNativeState();
    const { title, artist, albumArtUrl, lyricsState } = detection;
    const fullUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;

    // BUG-C20 Fix: Desync Guard.
    // detection.title comes from the DOM (sync); window.spotifyState comes from the Bridge (async).
    // If they don't match, the Bridge is still on the PREVIOUS track. Abort this tick 
    // to prevent paired operations (fetching, reporting) using mismatched URI/Title pairs.
    const bridgeTitle = (window.spotifyState?.track as Record<string, unknown> | null)?.name as string | undefined;
    if (bridgeTitle && title && bridgeTitle !== title && !detection.isAd) {
      // console.log(`[sly-dom] ⏳ Desync Guard: DOM ("${title}") vs Bridge ("${bridgeTitle}"). Waiting for Bridge sync...`);
      return;
    }

    // (Formerly PROACTIVE CACHE WARMING - now handled by WarmingEngine)

    // 0. UNIVERSAL ORPHAN GUARD
    // Runs before the ad check so it catches the case where the button was
    // removed entirely (e.g. during an ad) rather than deactivated — the
    // MutationObserver in events.ts only fires on attribute changes, not removal.
    if (!detection.isOnLyricsPage && document.getElementById('lyrics-root-sync')) {
      console.log('[sly-lifecycle] 🛡️ Orphan guard: Detection confirms panel closed, but #lyrics-root-sync is still in DOM. Triggering cleanup.');
      document.dispatchEvent(new CustomEvent('sly:panel_close'));
      return;
    }

    // 1. ADS: Spotify replaces the lyrics view with its own full-screen ad page and removes
    // the lyrics button (2026 UI, live 2026-11-08). Nothing of ours is shown over it: the
    // extension resets, removes any status screen of its own, and picks up the lyrics view
    // Spotify reopens after the break. (An "Intermission" screen used to be shown here; on
    // this UI it only flashed for a moment as the ad started and again as it ended.)
    if (detection.isAd) {
      window.slyInternalState.lastAdSeenAt = Date.now();
      if (window.slyInternalState.lastTitle !== 'AD_SILENCED') {
        window.slyResetPlayerState('AD_SILENCED', fullUri || 'ad');
      }
      if (StatusEngine.isShowing()) StatusEngine.clear();
      return;
    }

    // 1.5 FALLBACK TRACK CHANGE DETECTION
    // Primary path: sly:song_change event from Pipeline B's lifecycleController.
    // This fallback catches the edge case where that event was missed entirely, or
    // fired while the bridge scanner still had stale fiber data — causing the
    // desync guard in slyDetectNativeState() to return the OLD track's title, which
    // equalled lastTitle and silently skipped slyResetPlayerState().
    //
    // Fix: read spotifyState.track directly (same source as the bridge scanner),
    // bypassing the desync guard. Compare by URI — more reliable than title.
    //
    // Double-reset safety: first caller updates lastUri; poll or event whichever
    // fires second sees fullUri === lastUri and skips. Exactly one reset fires.
    //
    // Port of: lyric-test/content.js lines 44-46 (TRACK CHANGE RESET block).
    {
      const scannerTitle = (window.spotifyState?.track as Record<string, unknown>)?.name as string | undefined;
      // Cached lyrics put in at the song change, before the bridge names the track: the
      // bridge still naming the previous track is not a track change (it reset to the
      // previous song and took them down, live 2026-11-08).
      const early = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
      if (early?._slyEarly && fullUri && fullUri === early._slyPrevUri) return;
      if (
        fullUri &&
        fullUri !== window.slyInternalState.lastUri &&
        scannerTitle &&
        scannerTitle !== 'AD_SILENCED'
      ) {
        // Don't reset if we already have valid lyrics loaded for this exact URI.
        // This covers backwards skips: fullUri is "new" vs lastUri but currentLyrics
        // may already be correct for it from a prior play in this session.
        const cl = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
        // SLY FIX: Recognize both successful (lines) and failed states as valid loaded states.
        // Also ensure _slyUri matches to prevent stale restores.
        const isAlreadyCorrect = cl && cl.lines && cl._slyUri === fullUri;

        if (isAlreadyCorrect) {
          // Already correct — just sync lastUri forward
          window.slyInternalState.lastUri = fullUri;
          window.slyInternalState.panelOpenTime = 0;
        } else {
          // Track changed — reset state and abort this tick.
          // Zeroing panelOpenTime here ensures the NEXT poll tick starts a fresh grace period.
          window.slyInternalState.panelOpenTime = 0;
          window.slyResetPlayerState(scannerTitle, fullUri);
          // The bridge has caught up with a song whose cached lyrics are staged: check again now.
          if (window.slyInternalState.stagedTakeover?.uri === fullUri) window.slyKickPoll?.();
          return;
        }
      }
    }

    // 2. PANEL STATUS CHECK
    // Primary cleanup: events.ts lyrics button MutationObserver dispatches sly:panel_close.
    // Orphan guard (belt-and-suspenders): handled above by Step 0 UNIVERSAL ORPHAN GUARD.
    // Port of: lyric-test/content.js Step 2 (lines 48-68), now event-driven first.
    if (!detection.isOnLyricsPage) {
      return;
    }


    // CACHED NEXT SONG: lyrics staged at the song change (Pipeline B's onSongChange) go in
    // now that the bridge names that song, without waiting for Spotify's panel to load.
    const staged = window.slyInternalState.stagedTakeover;
    if (staged && staged.uri === fullUri) {
      window.slyInternalState.stagedTakeover = null;
      const cl = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
      const alreadyOurs = !!document.getElementById('lyrics-root-sync') && cl?._slyUri === fullUri;
      if (!alreadyOurs && !window.slyInternalState.pendingLyricsData) {
        window.slyInternalState.pendingLyricsData = staged.data;
      }
    }

    // RE-INJECTION CHECK: If we are searching or failed, but the panel was re-rendered, restore the HUD.
    // SLY FIX: Added !isTransitioning guard to prevent "HUD recovery" during track skips.
    if (!window.slyInternalState.isTransitioning && (
        (window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.failed || 
        window.slyInternalState.isFetchingHUD || 
        window.slyInternalState.fetchingForTitle ||
        window.slyInternalState.fetchingForUri.size > 0)) {
      if (!StatusEngine.isShowing()) {
        // Safety Exit: If we actually have valid lyrics in the state, do not restore a loading HUD.
        if ((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.lines) {
          window.slyInternalState.isFetchingHUD = false;
          return;
        }

        if (detection.lyricsState === 'SYNCED' && !window.slyInternalState.forceFallback && window.slyInternalState.isFetchingHUD) {
          console.log('[sly] Re-injection suppressed: Spotify native lyrics recovered.');
          // Fall through to Decision Engine
        } else {
          if (isFailedForCurrent(window.slyInternalState.currentLyrics, fullUri)) {
            // A recorded failure for this track is final; test it before the "fetching"
            // flags so a stale flag cannot turn the error HUD (with Retry) into a spinner.
            console.log('[sly] Restore: Re-injecting failure HUD...');
            StatusEngine.show(
              "Even Spotify Karaoke couldn't find the lyrics for this song.",
              'You can help the community by adding them to the open-source database.',
              true,
              { title, artist, album: detection.album, duration: detection.duration, albumArtUrl, uri: fullUri }
            );
          } else if (window.slyInternalState.isFetchingHUD || (fullUri && window.slyInternalState.fetchingForUri.has(fullUri))) {
            console.log('[sly] Restore: Re-injecting loading HUD (Continuing fetch)...');
            StatusEngine.show('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Continuing external search...', false, { title, artist, album: detection.album, duration: detection.duration, albumArtUrl, uri: fullUri });
          }
          return;
        }
      }
    }

    // 3. NETWORK SAFETY
    if (window.slyInternalState.interceptorActive || window.slyInternalState.isSpotifyFetching) {
      // SLY FIX: Reset the grace period clock while the interceptor is active so 
      // the 2.5s timeout doesn't expire during slow network/token hydration.
      window.slyInternalState.panelOpenTime = 0;
      return;
    }

    // BUG-B11 Fix: If the interceptor failed to load, we lose the isSpotifyFetching signal.
    // We add an extra 1s safety buffer to the native detection grace period to prevent 
    // redundant external fetches from racing against slow native fetches.
    if (window.slyInternalState.interceptorFailed && lyricsState === 'LOADING') {
      const timeSinceSongChange = Date.now() - window.slyInternalState.songChangeTime;
      if (timeSinceSongChange < 3500) {
        return;
      }
    }

    // 4. DECISION ENGINE
    const cachedEntry = window.slyRuntimeCache?.get(fullUri || '');
    const resolution = resolveTrackState(detection, detection.preFetch, cachedEntry);

    const stateString = `${resolution.action}|${resolution.sourceState}|${resolution.provider}`;
    if (window.slyInternalState.lastResolvedStateString !== stateString) {
      console.log(`[sly-coherence] 🧭 Resolved Track State Action: ${resolution.action} | Source: ${resolution.sourceState} | Provider: ${resolution.provider}`);
      window.slyInternalState.lastResolvedStateString = stateString;
    }

    // A stand-down decision no longer holds: drop it so the poll returns from 5 s to 500 ms.
    if (resolution.action !== 'NATIVE_ORIGINAL' && window.slyInternalState.lastDecision?.startsWith('synced_or_ok:')) {
      window.slyInternalState.lastDecision = '';
    }

    // If resolution action is NATIVE_ORIGINAL (Perfect native Spotify synced lyrics), stand down!
    if (resolution.action === 'NATIVE_ORIGINAL') {
      const decision = `synced_or_ok:${title}`;
      if (window.slyInternalState.lastDecision !== decision) {
        console.log(`[sly-dom] ✅ DECISION: Native lyrics are synced for "${title}". Engine standing down.`);
        window.slyInternalState.lastDecision = decision;
        // Cleanup custom takeover state if active
        if (window.slyInternalState.currentLyrics || window.slyInternalState.isFetchingHUD) {
          document.dispatchEvent(new CustomEvent('sly:panel_close'));
        }
        document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
      }
      document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: 'NATIVE_OK' } }));
      if (window.slyInternalState.nativeRecoveryPending && detection.hasNativeLines) {
        window.slyInternalState.nativeRecoveryPending = false;
      }
    } 
    // If TAKEOVER_SYNCED or TAKEOVER_UNSYNCED, trigger 0ms takeover using cache/pending lyrics
    else if (resolution.action === 'TAKEOVER_SYNCED' || resolution.action === 'TAKEOVER_UNSYNCED') {
      // If we don't have this currently injected or staged, stage it from the cache!
      if (!window.slyInternalState.currentLyrics && !window.slyInternalState.pendingLyricsData) {
        const mutableData = {
          lines: cachedEntry.lyrics?.syncedLyrics 
            ? (window as any).slyParseLRC?.(cachedEntry.lyrics.syncedLyrics) || []
            : (cachedEntry.lyrics?.plainLyrics || '').split('\n').map((text: string) => ({ text, time: 0 })),
          isSynced: !!cachedEntry.lyrics?.syncedLyrics,
          plainLyrics: cachedEntry.lyrics?.plainLyrics || '',
          syncedLyrics: cachedEntry.lyrics?.syncedLyrics || '',
          _slyUri: fullUri,
          extractedColor: cachedEntry.extractedColor,
          isInstant: true,
          processed: cachedEntry.processed
        };
        window.slyInternalState.pendingLyricsData = mutableData;
        console.log(`[sly-coherence] ⚡ God List takeover triggered synchronously from cache for track ${fullUri}`);
        traceEvent(`takeover:fromCache(${resolution.sourceState})`);
      }
    } 
    // If NATIVE_UPGRADED, trigger Pipeline B upgraded lines override
    else if (resolution.action === 'NATIVE_UPGRADED') {
      // Pipeline B handles native upgraded override in syncSetup / reapplyMode!
      // Stand down content takeover, let native render, and trigger native override event
      document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
    } 
    // If STANDBY, we might need to search/trigger fetch or wait
    else if (resolution.action === 'STANDBY') {
      const isMissingOrUnsynced = (lyricsState.includes('MISSING') || 
                                   lyricsState.includes('UNSYNCED') || 
                                   lyricsState.includes('ROMANIZED') || 
                                   window.slyInternalState.forceFallback) && 
                                  lyricsState !== 'LOADING';
      const fetchAlreadyFailed = !!fullUri && window.slyInternalState.failedFetchUris?.has(fullUri);
      if (isMissingOrUnsynced && !fetchAlreadyFailed && !window.slyInternalState.currentLyrics && !window.slyInternalState.fetchingForTitle && !window.slyInternalState.pendingLyricsData) {
        const registryIsEmpty = !(window as any).slyPreFetchRegistry?.getState(fullUri || '');
        const onlyDomEvidence = detection.hasUnavailableMessage && !detection.preFetch;
        const timeSinceSongChange = Date.now() - window.slyInternalState.songChangeTime;

        if (registryIsEmpty && onlyDomEvidence && timeSinceSongChange < 1000) {
          return;
        }

        const decision = `${lyricsState.toLowerCase()}:${title}`;
        if (window.slyInternalState.lastDecision !== decision) {
          console.log(`[sly-dom] 🚨 DECISION: Fallback needed (${lyricsState}). Attempting fetch...`);
          traceEvent(`fetch:${lyricsState}`);
          window.slyInternalState.lastDecision = decision;
        }
        window.slyTriggerLyricsFetch(title, artist, albumArtUrl || '', fullUri || '', false, detection.album, detection.duration);
      }
    }

    // 5. INJECTION GATE: We have fresh lyrics data waiting for the panel to be ready.
    if (window.slyInternalState.pendingLyricsData && detection.isOnLyricsPage) {
      const data = window.slyInternalState.pendingLyricsData as Record<string, unknown>;

      // Stand down if native lyrics are still being discovered by the bridge, unless these
      // are cached lyrics of a song already known to need ours (isInstant: L0 cache).
      if (lyricsState === 'LOADING' && !window.slyInternalState.forceFallback && !data.isInstant) {
        return;
      }

      // Stand down if native lyrics suddenly became synced/recovered or we are unsynced vs unsynced
      const isNativeFunctional = lyricsState === 'SYNCED' || lyricsState === 'NATIVE_OK';
      if (isNativeFunctional && !window.slyInternalState.forceFallback) {
        (window as any).slyPreFetchRegistry?.register(fullUri || '', 'NATIVE_OK', { 
          title: title, 
          artist: artist, 
          nativeStatus: 'NATIVE_OK',
          reason: 'De-Romanization Success' 
        });
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        const targetUri = (data as any)._slyUri || fullUri;
        if (targetUri) window.slyInternalState.fetchingForUri.delete(targetUri);
        StatusEngine.clear();
        document.dispatchEvent(new CustomEvent('sly:panel_close'));
        return;
      }

      const hasExtraContent = !!(data.translated || data.romanized);
      if (lyricsState === 'UNSYNCED' && !data.isSynced && !hasExtraContent && !window.slyInternalState.forceFallback) {
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        const targetUri = (data as any)._slyUri || fullUri;
        if (targetUri) window.slyInternalState.fetchingForUri.delete(targetUri);
        StatusEngine.clear();
        return;
      }

      console.log(`[sly] Taking over! | Takeover Reason: ${detection.lyricsState}`);
      traceEvent(`takeover:${detection.lyricsState}`);
      // Safety: Only inject if the data actually has content.
      const hasContent = !!(data.plainLyrics || data.syncedLyrics) && (data.ok !== false);

      if (hasContent) {
        const currentUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;
        const payloadUri = (data as any)._slyUri;
        if (payloadUri && currentUri && payloadUri !== currentUri) {
          console.warn(`[sly] Taking over aborted: pendingLyricsData URI (${payloadUri}) does not match current track URI (${currentUri})`);
          window.slyInternalState.pendingLyricsData = null;
          window.slyInternalState.fetchingForTitle = '';
          const targetUri = (data as any)._slyUri || currentUri;
          if (targetUri) window.slyInternalState.fetchingForUri.delete(targetUri);
          return;
        }

        window.slyInternalState.currentLyrics = data;
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        const targetUri = (data as any)._slyUri || fullUri;
        if (targetUri) window.slyInternalState.fetchingForUri.delete(targetUri);
        // Handoff to the takeover: drop the HUD but keep Spotify's panel hidden
        // (sly:inject may await storage before executeTakeover hides it again).
        StatusEngine.clear({ restoreNative: false });

        console.log(`[sly] Takeover complete. Current Lyrics:`, window.slyInternalState.currentLyrics);
        
        document.dispatchEvent(new CustomEvent('sly:inject', {
          detail: { 
            lyricsObj: safeClone(data),
            isInstant: !!data.isInstant 
          },
        }));
      } else {
        // SLY FIX: If we "took over" but have no content, we must mark as failed 
        // to prevent the Decision Engine from re-triggering infinitely.
        console.warn('[sly] Taking over but no content found. Marking as failed.');
        const failedUri = (data as any)._slyUri || fullUri;
        window.slyInternalState.currentLyrics = { failed: true, _slyUri: failedUri };
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        const targetUri = (data as any)._slyUri || fullUri;
        if (targetUri) window.slyInternalState.fetchingForUri.delete(targetUri);
        StatusEngine.clear();
      }
    }

    // 6. PERSISTENCE & RE-INJECTION: We already have lyrics active or a HUD, ensure they stay there.
    const hasActiveTakeover = window.slyInternalState.currentLyrics || window.slyInternalState.statusHUDActive;
    if (detection.isOnLyricsPage && hasActiveTakeover) {
      const root = document.getElementById('lyrics-root-sync');

      // RECOVERY GUARD: If native lyrics become SYNCED or NATIVE_OK (and we're not in forceFallback), release the takeover.
      if ((detection.lyricsState === 'SYNCED' || detection.lyricsState === 'NATIVE_OK') && !window.slyInternalState.forceFallback) {
        console.log(`[sly-lifecycle] 🩹 Recovery: Native lyrics became ${detection.lyricsState} while in Pipeline A. Releasing takeover.`);
        
        // SLY FIX: Explicitly clear the custom state so the Persistence Engine doesn't immediately 
        // try to re-inject the abandoned DOM in the next poll frame (which causes an infinite loop).
        window.slyInternalState.currentLyrics = null;
        if (fullUri) window.slyInternalState.fetchingForUri.delete(fullUri);
        window.slyInternalState.statusHUDActive = false;
        window.slyInternalState.isFetchingHUD = false;
        
        document.dispatchEvent(new CustomEvent('sly:panel_close'));
        return;
      }

      // If the panel was re-opened and our DOM was wiped by React, re-inject (not while a
      // status for this song is on show: the takeover already said why it cannot show them).
      if (!root || !root.isConnected || root.innerHTML === '') {
        const cl = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
        const currentUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;
        const hasValidLyrics = cl && Array.isArray((cl as any).lines) && (cl as any).lines.length > 0;
        if (!StatusEngine.isShowing() && (detection.lyricsState !== 'LOADING' || hasValidLyrics) && cl && currentUri && cl._slyUri === currentUri) {
          console.log('[sly] Restore: Panel re-opened. Re-injecting lyrics DOM...');
          // Route through Pipeline B's unified injection path (sly:inject → setupSlyBridge).
          // slyInjectLyrics is no longer the executor — sly:inject is the contract.
          document.dispatchEvent(new CustomEvent('sly:inject', {
            detail: { lyricsObj: safeClone(cl) },
          }));
        }
      } else if (!root.classList.contains('sly-root-notice') && root.querySelector('[data-testid="lyrics-line"]')) {
        // Our lyrics are on screen: keep them visible and Spotify's panel hidden. Only what
        // changed is written (this runs every tick; rewriting unchanged state re-ran styles
        // and raced the cleanup code that removes the same class: visible flicker).
        if (root.style.display) root.style.display = '';
        const host = getSlyLayoutHost();
        if (host && !host.classList.contains('sly-active')) host.classList.add('sly-active');

        document.querySelectorAll(`.${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'}, .${window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM'}`)
          .forEach(n => { if ((n as HTMLElement).style.display !== 'none') (n as HTMLElement).style.display = 'none'; });
        // Themed full panel only (never the Now Playing view preview), legacy fallback.
        const nativeContainer = getNativeLyricsContainer();
        if (nativeContainer) {
          // Re-mirror theme to handle transitions (e.g. MISSING -> UNSYNCED); writes only changes.
          const sly = (window as any);
          sly.slyMirrorNativeTheme?.(root, window.slyInternalState.currentLyrics as Record<string, unknown>, nativeContainer);
        }
      }
    }
    if (window.slyUpdateButtonState) window.slyUpdateButtonState('original');
  } catch (e) {
    console.error('[sly] Uncaught error in checkNowPlaying:', e);
  }
};

let consecutivePollErrors = 0;
/** A poll is running (the chain must never fork: only one setTimeout chain at a time). */
let pollInFlight = false;
/** Something asked for a check while one was running: the next one runs at once. */
let kickPending = false;

/**
 * Runs the check now instead of at the next tick (up to 5 s away when standing down):
 * when the lyrics view reopens, our lyrics take Spotify's panel's place without waiting.
 */
window.slyKickPoll = (): void => {
  if (pollInFlight) { kickPending = true; return; }
  if (window.antigravityInterval) clearTimeout(window.antigravityInterval as number);
  void startThrottledPoll();
};

async function startThrottledPoll() {
  if (window.antigravityInterval) clearTimeout(window.antigravityInterval as number);
  
  pollInFlight = true;
  try {
    await window.slyCheckNowPlaying!();
    consecutivePollErrors = 0; // Reset on success
  } catch (e) {
    consecutivePollErrors++;
    console.error(`[sly] Poll error #${consecutivePollErrors}:`, e);
  } finally {
    pollInFlight = false;
  }
  
  // Back off if we're failing repeatedly
  if (consecutivePollErrors >= 5) {
    const backoff = 30000; // 30 seconds
    console.warn(`[sly] Too many consecutive errors. Backing off for ${backoff/1000}s.`);
    window.antigravityInterval = setTimeout(startThrottledPoll, backoff) as unknown as number;
    return;
  }
  
  // Determine standing-down interval using slyInternalState fields set by the
  // slyCheckNowPlaying() call above — no second slyDetectNativeState() DOM call needed.
  // lastDecision is set to 'synced:<title>' by the SYNCED branch and reset to ''
  // by slyResetPlayerState() on every track change, so this correctly reads false
  // after any song transition.
  const isStandingDown = (window.slyInternalState.lastDecision?.startsWith('synced_or_ok:') ?? false) &&
                         !window.slyInternalState.forceFallback &&
                         !window.slyInternalState.fetchingForTitle &&
                         !window.slyInternalState.nativeRecoveryPending;
                         
  const interval = kickPending ? 0 : (isStandingDown ? 5000 : 500);
  kickPending = false;
  window.antigravityInterval = setTimeout(startThrottledPoll, interval) as unknown as number;
}
window.slyStartThrottledPoll = startThrottledPoll;

if (!document.body) {
  document.addEventListener('DOMContentLoaded', startThrottledPoll);
} else {
  startThrottledPoll();
}

console.log('[sly] DOM Engine booted. Adaptive polling active.');
