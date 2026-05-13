// @ts-nocheck
import { isContextValid, safeClone } from '../utils/browserUtils';
import { slyAdManager } from './adManager';
import { getLyricsLines, getLyricsViewRoot } from '../dom/domQueries';

declare global {
  interface Window {
    slyCheckNowPlaying: () => void;
    antigravityInterval?: NodeJS.Timeout | number;
  }
}

console.log('[sly] DOM Engine starting...');
if (window.slyInjectCoreStyles) window.slyInjectCoreStyles();

// --- HOT RELOAD CLEANUP PROTOCOL ---
if (window.antigravityInterval) clearTimeout(window.antigravityInterval as number);
if (window.slyPreFetchInterval) clearInterval(window.slyPreFetchInterval);
if (window.antigravitySyncAnimFrame) cancelAnimationFrame(window.antigravitySyncAnimFrame);
document.querySelectorAll('#lyrics-root-sync, #sly-hijack-styles').forEach(node => node.remove());

// Note: Navigation Interceptor, Interaction Monitoring, and Button Hijack have been moved to modules/content-events.js

// --- STATE SYNC ---
// Note: Internal extension state is now managed by window.slyInternalState in modules/state-manager.js
window.slyCheckNowPlaying = slyCheckNowPlaying;

window.addEventListener('sly_state_update', async (e) => {
  await window.slyCheckNowPlaying();

  // SLY FIX (Magical Seamless Swap): Queue Pre-warming.
  // Proactively fetch lyrics for the next 2 songs in the queue so they are in L0
  // before the user even clicks "Next".
  const queue = (e as CustomEvent).detail?.queue as any[];
  if (Array.isArray(queue) && queue.length > 0) {
    const nextTracks = queue.slice(0, 2);
    nextTracks.forEach(track => {
      const { title, artist, albumArtUrl, id, uri } = track;
      const fullUri = uri || `spotify:track:${id}`;
      // Only pre-fetch if not already in L0 or currently fetching
      if (!window.slyInternalState.l0Cache.has(fullUri) && !window.slyInternalState.fetchingForUri.has(fullUri)) {
        // console.log(`[sly-queue] Pre-warming next track: ${title} [${fullUri}]`);
        if (window.slyTriggerLyricsFetch) {
          window.slyTriggerLyricsFetch(title, artist, albumArtUrl, fullUri);
        }
      }
    });
  }
});

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
setTimeout(() => {
  if (!window.slyInternalState.interceptorActive) {
    console.warn('[sly] Interceptor Heartbeat: FAILED. Falling back to passive native detection.');
    window.slyInternalState.interceptorFailed = true;
  }
}, 2000);

// Relay messages from Bridge (MAIN world) to Background (Extension world)
window.addEventListener('message', (event) => {
  if (event.data?.type === 'SLY_INTERCEPTOR_READY') {
    window.slyInternalState.interceptorFailed = false;
    window.slyInternalState.interceptorActive = true;
    console.log('[sly] Interceptor Heartbeat: Confirmed Healthy.');
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

// BUG-31 Fix: Listen for results from the bridge (Extension world)
window.addEventListener('message', (event) => {
  const data = event.data as Record<string, any>;
  if (data?.source === 'SLY_BRIDGE_CACHE_RESULT') {
    const { uri, result, error } = data;
    
    // Guard: Song changed while we were asking the background script
    // Guard: Song changed while we were asking the background script
    const currentUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;
    
    // BUG-C10 Fix: Always clear the warming flag if we received a response for it,
    // regardless of whether the track changed, to prevent stale blocking.
    if (window.slyInternalState.warmingUri === uri) {
      window.slyInternalState.warmingUri = undefined;
    }

    if (currentUri !== uri) return;

    window.slyInternalState.warmedUri = uri; // Mark as settled

    if (error) return;

    if (result?.found) {
       console.log(`[sly] 🧠 Proactive Cache Hit: Native=${result.nativeStatus || 'N/A'}, Custom=${result.prefetchState || 'N/A'}`);
       
       // SLY FIX: Hydrate L0 session cache from the persistent result.
       // This allows the next "skip" to this song to be a synchronous 0ms swap.
       // We now cache failures as well to eliminate the async flash.
       if (result.ok && result.data) {
         const mutableData = safeClone(result.data);
         mutableData._slyUri = uri; // Ensure URI is stamped for L0 consistency
         window.slyInternalState.l0Cache.delete(uri); // BUG-C2/C8: Refresh LRU
         window.slyInternalState.l0Cache.set(uri, mutableData);
       } else {
         // Even if result.data exists (e.g. for color), if ok is false, it's a failure.
         window.slyInternalState.l0Cache.delete(uri);
         window.slyInternalState.l0Cache.set(uri, { failed: true, _slyUri: uri, extractedColor: result.data?.extractedColor || result.extractedColor });
       }

       // BUG-C8: Cap l0Cache size to prevent memory leaks in long sessions
       if (window.slyInternalState.l0Cache.size > 50) {
         const oldestKey = window.slyInternalState.l0Cache.keys().next().value;
         if (oldestKey) window.slyInternalState.l0Cache.delete(oldestKey);
       }

          const targetState = (result.nativeStatus === 'SYNCED' || result.nativeStatus === 'NATIVE_OK')
            ? 'NATIVE_OK'
            : (result.prefetchState || 'MISSING');
          window.slyPreFetchRegistry.register(uri, targetState, {
            title: data.title, 
            nativeStatus: result.nativeStatus,
            customStatus: result.prefetchState,
            reason: 'Persistent Cache Hit'
          });
    } else {
       console.log(`[sly] 🆕 First Play: No cache record found for ${data.title}.`);
    }
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
  await window.slyCheckNowPlaying();
});

// Pipeline B's domObserver dispatches this when [data-testid="lyrics-button"] loses
// its data-active="true" attribute. Handles panel close cleanup immediately instead
// of waiting up to 500ms for the poll.
document.addEventListener('sly:panel_close', () => {
  
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
  if (window.slyClearStatus) window.slyClearStatus();

  const root = document.getElementById('lyrics-root-sync');
  if (root) {
    console.log('[sly-lifecycle] 🧹 Cleaning up injected #lyrics-root-sync and restoring native UI.');
    
    // SLY FIX (BUG-35): Manually rescue the mode pill to document.body before removing the root.
    // This prevents the pill from being destroyed while allowing us to dispatch 'sly:release'
    // AFTER the DOM has settled, avoiding stale layout reads in Pipeline B.
    const pill = document.getElementById('sly-mode-pill');
    if (pill) document.body.appendChild(pill);

    root.remove();
  }

  // SLY FIX (BUG-35): Dispatch release AFTER removing root so listeners see the final DOM state.
  document.dispatchEvent(new CustomEvent('sly:release'));

  const syncBtn = document.getElementById('sly-sync-button');
  if (syncBtn) syncBtn.remove();
  
  const main = getLyricsViewRoot() as HTMLElement | null;
  if (main) { main.classList.remove('sly-active'); main.style.display = ''; }
  
  const errCls1 = window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP';
  const errCls2 = window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM';
  document.querySelectorAll(`.${errCls1}, .${errCls2}`)
    .forEach(n => ((n as HTMLElement).style.display = ''));

  const nativeContainerClass = window.SPOTIFY_CLASSES?.container;
  if (main && nativeContainerClass) {
    const nativeContainer = main.querySelector(`.${nativeContainerClass}:not(#lyrics-root-sync)`) as HTMLElement | null;
    if (nativeContainer) nativeContainer.style.display = '';
  }
});

// slyCore records the incoming lyrics object when Pipeline B signals injection.
// lyricsObj.lines will be populated by slyBuildLyricsList later (same object reference).
document.addEventListener('sly:inject', (e: Event) => {
  const { lyricsObj } = (e as CustomEvent<{ lyricsObj: Record<string, unknown> }>).detail;
  // Stamp the URI at injection time so Step 1.5 can check if the skip target
  // is already the track we have lyrics for.
  const currentUri = (window.spotifyState?.track as Record<string, unknown>)?.uri as string | undefined;
  if (currentUri) lyricsObj._slyUri = currentUri;
  window.slyInternalState.currentLyrics = lyricsObj;
  window.slyInternalState.isTransitioning = false; // Transition complete
});

document.addEventListener('sly:song_change', async (e) => {
  const { uri } = (e as CustomEvent).detail;
  console.log(`[sly-lifecycle] ⚡ Reactive Song Change Detected: ${uri}. Re-evaluating state.`);
  window.slyInternalState.isTransitioning = true;
  
  // Clear the HUD immediately on skip to prevent ghost error messages
  if (window.slyClearStatus) window.slyClearStatus();
  
  // Reset the poll loop to start fresh for the new song
  if (window.slyStartThrottledPoll) window.slyStartThrottledPoll();
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

    // 0. PROACTIVE CACHE WARMING
    // Try to seed the registry from the background database as soon as we have a URI.
    // This runs on every tick until warmedUri matches fullUri, covering cold starts.
    if (fullUri && fullUri.startsWith('spotify:track:') && window.slyInternalState.warmedUri !== fullUri && window.slyInternalState.warmingUri !== fullUri) {
      // SLY FIX: Set flag synchronously and use a separate 'warming' flag to prevent race conditions
      window.slyInternalState.warmingUri = fullUri;

      // BUG-31 Fix: browser.runtime is undefined in MAIN world in Chrome.
      // Route via window.postMessage to slyBridge.ts (Extension world).
      // SLY FIX (BUG-38): Use window.location.origin instead of '*' for better security.
      window.postMessage({ 
        type: 'SLY_CHECK_CACHE', 
        payload: { title, artist, uri: fullUri } 
      }, window.location.origin);
    }

    // 0. UNIVERSAL ORPHAN GUARD
    // Runs before the ad check so it catches the case where the button was
    // removed entirely (e.g. during an ad) rather than deactivated — the
    // MutationObserver in events.ts only fires on attribute changes, not removal.
    if (!detection.isOnLyricsPage && document.getElementById('lyrics-root-sync')) {
      console.log('[sly-lifecycle] 🛡️ Orphan guard: Detection confirms panel closed, but #lyrics-root-sync is still in DOM. Triggering cleanup.');
      document.dispatchEvent(new CustomEvent('sly:panel_close'));
      return;
    }

    // 1. AD SILENCER
    if (detection.isAd) {
      if (window.slyInternalState.lastTitle !== 'AD_SILENCED') {
        window.slyResetPlayerState('AD_SILENCED', fullUri || 'ad');
      }

      // If on lyrics page, ensure the "Ad Break" HUD is active
      if (detection.isOnLyricsPage) {
        const hud = document.getElementById('sly-status-hud');

        // If it's missing or we haven't marked it active yet, show it.
        if (!hud || !window.slyInternalState.isAdHUDActive) {
          console.log('[sly] Ad HUD: Injecting/Restoring...');
          window.slyShowStatus('Ad Break', slyAdManager.getAdMessage(), false, { isAd: true });
        }
      }
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


    // RE-INJECTION CHECK: If we are searching, failed, or in an ad, but the panel was re-rendered, restore the HUD.
    if ((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.failed || 
        window.slyInternalState.isFetchingHUD || 
        window.slyInternalState.isAdHUDActive ||
        window.slyInternalState.fetchingForTitle) {
      if (!document.getElementById('sly-status-hud')) {
        // Safety Exit: If we actually have valid lyrics in the state, do not restore a loading HUD.
        if ((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.lines) {
          window.slyInternalState.isFetchingHUD = false;
          return;
        }

        if (detection.lyricsState === 'SYNCED' && !window.slyInternalState.forceFallback && window.slyInternalState.isFetchingHUD) {
          console.log('[sly] Re-injection suppressed: Spotify native lyrics recovered.');
          // Fall through to Decision Engine
        } else {
          if (window.slyInternalState.isAdHUDActive) {
            console.log('[sly] Restore: Re-injecting Ad HUD...');
            window.slyShowStatus('Ad Break', window.slyAdManager.getAdMessage(), false, { isAd: true });
          } else if ((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.failed) {
            console.log('[sly] Restore: Re-injecting failure HUD...');
            window.slyShowStatus(
              "Even Spotify Karaoke couldn't find the lyrics for this song.",
              'You can help the community by adding them to the open-source database.',
              true
            );
          } else {
            console.log('[sly] Restore: Re-injecting loading HUD (Continuing fetch)...');
            window.slyShowStatus('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Continuing external search...', false, { title, artist, albumArtUrl });
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

    // Abort if native recovered to synced mid-fetch
    if (lyricsState === 'SYNCED' && window.slyInternalState.fetchingForTitle === title && !window.slyInternalState.forceFallback) {
      console.warn(`[sly] Aborting fetch for "${title}" — Spotify recovered to native synced lyrics.`);
      window.slyInternalState.fetchGeneration++;
      window.slyInternalState.fetchingForTitle = '';
      window.slyInternalState.nativeRecoveryPending = true;
      if (window.slyClearStatus) window.slyClearStatus();
      return;
    }

    // 3. GRACE PERIOD HANDLING
    const isMissingOrUnsynced = (lyricsState.includes('MISSING') || 
                                 lyricsState.includes('UNSYNCED') || 
                                 lyricsState.includes('ROMANIZED') || 
                                 window.slyInternalState.forceFallback) && 
                                lyricsState !== 'LOADING';

    if (!window.slyInternalState.currentLyrics && !window.slyInternalState.fetchingForTitle && !window.slyInternalState.pendingLyricsData) {
      if (isMissingOrUnsynced) {
        // Issue 2 Fix: Defer MISSING decision if we have weak evidence and just changed songs.
        // This prevents the extension from jumping to a "lyrics unavailable" display while
        // Spotify's own UI is still settling or loading.
        const registryIsEmpty = !window.slyPreFetchRegistry.getState(fullUri || '');
        const onlyDomEvidence = detection.hasUnavailableMessage && !detection.preFetch;
        const timeSinceSongChange = Date.now() - window.slyInternalState.songChangeTime;

        if (registryIsEmpty && onlyDomEvidence && timeSinceSongChange < 1000) {
          return;
        }

        const decision = `${lyricsState.toLowerCase()}:${title}`;
        if (window.slyInternalState.lastDecision !== decision) {
          console.log(`[sly-dom] 🚨 DECISION: Fallback needed (${lyricsState}). Attempting fetch...`);
          window.slyInternalState.lastDecision = decision;
        }
        window.slyTriggerLyricsFetch(title, artist, albumArtUrl || '', fullUri || '');
      } else if (lyricsState === 'SYNCED' || lyricsState === 'NATIVE_OK') {
        const decision = `synced_or_ok:${title}`;
        if (window.slyInternalState.lastDecision !== decision) {
          console.log(`[sly-dom] ✅ DECISION: Native lyrics are ${lyricsState} for "${title}" [${fullUri?.split(':').pop() || 'N/A'}]. Engine standing down.`);
          window.slyInternalState.lastDecision = decision;
          // Cleanup custom state if we were previously taking over
          if (window.slyInternalState.currentLyrics || window.slyInternalState.isFetchingHUD) {
            document.dispatchEvent(new CustomEvent('sly:panel_close'));
          }
          // Notify the bridge immediately to ensure the pill appears without MutationObserver latency
          document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
        }
        // Emit NATIVE_OK on every standing-down tick (not just on transition).
        // lifecycleController's syncPill('NATIVE_OK') is idempotent — if the pill is
        // already correctly placed, this is a no-op. If React re-rendered the lyrics
        // container and removed the pill without removing the lyrics-line nodes
        // (meaning onLyricsInjected won't fire), this provides a periodic recovery
        // path with a maximum delay of one poll interval (5s in standing-down mode).
        document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: 'NATIVE_OK' } }));
        if (window.slyInternalState.nativeRecoveryPending && detection.hasNativeLines) {
          window.slyInternalState.nativeRecoveryPending = false;
        }
      }
    }

    // 5. INJECTION GATE: We have fresh lyrics data waiting for the panel to be ready.
    if (window.slyInternalState.pendingLyricsData && detection.isOnLyricsPage) {
      const data = window.slyInternalState.pendingLyricsData as Record<string, unknown>;

      // Stand down if native lyrics are still being discovered by the bridge
      if (lyricsState === 'LOADING' && !window.slyInternalState.forceFallback) {
        return;
      }

      // Stand down if native lyrics suddenly became synced/recovered or we are unsynced vs unsynced
      const isNativeFunctional = lyricsState === 'SYNCED' || lyricsState === 'NATIVE_OK';
      if (isNativeFunctional && !window.slyInternalState.forceFallback) {
        window.slyPreFetchRegistry.register(fullUri || '', 'NATIVE_OK', { 
          title: title, 
          artist: artist, 
          nativeStatus: 'NATIVE_OK',
          reason: 'De-Romanization Success' 
        });
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        window.slyInternalState.fetchingForUri.clear();
        if (window.slyClearStatus) window.slyClearStatus();
        document.dispatchEvent(new CustomEvent('sly:panel_close'));
        return;
      }

      const hasExtraContent = !!(data.translated || data.romanized);
      if (lyricsState === 'UNSYNCED' && !data.isSynced && !hasExtraContent && !window.slyInternalState.forceFallback) {
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        window.slyInternalState.fetchingForUri.clear();
        if (window.slyClearStatus) window.slyClearStatus();
        return;
      }

      console.log(`[sly] Taking over! | Takeover Reason: ${detection.lyricsState}`);
      // Safety: Only inject if the data actually has content.
      const hasContent = !!(data.plainLyrics || data.syncedLyrics) && (data.ok !== false);

      if (hasContent) {
        const currentUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;
        const payloadUri = (data as any)._slyUri;
        if (payloadUri && currentUri && payloadUri !== currentUri) {
          console.warn(`[sly] Taking over aborted: pendingLyricsData URI (${payloadUri}) does not match current track URI (${currentUri})`);
          window.slyInternalState.pendingLyricsData = null;
          window.slyInternalState.fetchingForTitle = '';
          window.slyInternalState.fetchingForUri.clear();
          return;
        }

        window.slyInternalState.currentLyrics = data;
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        window.slyInternalState.fetchingForUri.clear();
        if (window.slyClearStatus) window.slyClearStatus();

        console.log(`[sly] Takeover complete. Current Lyrics:`, window.slyInternalState.currentLyrics);
        
        document.dispatchEvent(new CustomEvent('sly:inject', {
          detail: { lyricsObj: safeClone(data) },
        }));
      } else {
        // SLY FIX: If we "took over" but have no content, we must mark as failed 
        // to prevent the Decision Engine from re-triggering infinitely.
        console.warn('[sly] Taking over but no content found. Marking as failed.');
        const failedUri = (data as any)._slyUri || currentUri;
        window.slyInternalState.currentLyrics = { failed: true, _slyUri: failedUri };
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        window.slyInternalState.fetchingForUri.clear();
        if (window.slyClearStatus) window.slyClearStatus();
      }
    }

    // 6. PERSISTENCE & RE-INJECTION: We already have lyrics active or a HUD, ensure they stay there.
    const hasActiveTakeover = window.slyInternalState.currentLyrics || window.slyInternalState.statusHUDActive;
    if (detection.isOnLyricsPage && hasActiveTakeover) {
      const root = document.getElementById('lyrics-root-sync');
      const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`);
      
      // RECOVERY GUARD: If native lyrics become SYNCED or NATIVE_OK (and we're not in forceFallback), release the takeover.
      if ((detection.lyricsState === 'SYNCED' || detection.lyricsState === 'NATIVE_OK') && !window.slyInternalState.forceFallback) {
        console.log(`[sly-lifecycle] 🩹 Recovery: Native lyrics became ${detection.lyricsState} while in Pipeline A. Releasing takeover.`);
        
        // SLY FIX: Explicitly clear the custom state so the Persistence Engine doesn't immediately 
        // try to re-inject the abandoned DOM in the next poll frame (which causes an infinite loop).
        window.slyInternalState.currentLyrics = null;
        window.slyInternalState.fetchingForUri.clear();
        window.slyInternalState.statusHUDActive = false;
        window.slyInternalState.isFetchingHUD = false;
        window.slyInternalState.isAdHUDActive = false;
        
        document.dispatchEvent(new CustomEvent('sly:panel_close'));
        return;
      }

      // If the panel was re-opened and our DOM was wiped by React, re-inject
      if (!root || !root.isConnected || root.innerHTML === '') {
        const cl = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
        const currentUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;
        const hasValidLyrics = cl && Array.isArray((cl as any).lines) && (cl as any).lines.length > 0;
        if ((detection.lyricsState !== 'LOADING' || hasValidLyrics) && cl && currentUri && cl._slyUri === currentUri) {
          console.log('[sly] Restore: Panel re-opened. Re-injecting lyrics DOM...');
          // Route through Pipeline B's unified injection path (sly:inject → setupSlyBridge).
          // slyInjectLyrics is no longer the executor — sly:inject is the contract.
          document.dispatchEvent(new CustomEvent('sly:inject', {
            detail: { lyricsObj: safeClone(cl) },
          }));
        }
      } else {
        // Ensure visibility and hijack classes are active
        root.style.display = '';
        if (main) main.classList.add('sly-active');

        document.querySelectorAll(`.${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'}, .${window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM'}`).forEach(n => ((n as HTMLElement).style.display = 'none'));
        const nativeContainer = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container}:not(#lyrics-root-sync)`) as HTMLElement | null;
        if (nativeContainer) {
          nativeContainer.style.display = 'none';
          // Re-mirror theme to handle transitions (e.g. MISSING -> UNSYNCED)
          const sly = (window as any);
          sly.slyMirrorNativeTheme?.(root, window.slyInternalState.currentLyrics as Record<string, unknown>, nativeContainer);
        }
      }
    }
    if (window.slyUpdateButtonState) window.slyUpdateButtonState();
  } catch (e) {
    console.error('[sly] Uncaught error in checkNowPlaying:', e);
  }
};

async function startThrottledPoll() {
  if (window.antigravityInterval) clearTimeout(window.antigravityInterval as number);
  
  await window.slyCheckNowPlaying();
  
  // Determine standing-down interval using slyInternalState fields set by the
  // slyCheckNowPlaying() call above — no second slyDetectNativeState() DOM call needed.
  // lastDecision is set to 'synced:<title>' by the SYNCED branch and reset to ''
  // by slyResetPlayerState() on every track change, so this correctly reads false
  // after any song transition.
  const isStandingDown = (window.slyInternalState.lastDecision?.startsWith('synced:') ?? false) &&
                         !window.slyInternalState.forceFallback &&
                         !window.slyInternalState.fetchingForTitle &&
                         !window.slyInternalState.nativeRecoveryPending;
                         
  const interval = isStandingDown ? 5000 : 500;
  window.antigravityInterval = setTimeout(startThrottledPoll, interval) as unknown as number;
}
window.slyStartThrottledPoll = startThrottledPoll;

if (!document.body) {
  document.addEventListener('DOMContentLoaded', startThrottledPoll);
} else {
  startThrottledPoll();
}

console.log('[sly] DOM Engine booted. Adaptive polling active.');
