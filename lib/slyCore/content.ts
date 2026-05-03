// Port of: lyric-test/content.js
/* content.js: sly Pixel-Perfect DOM Engine */

declare global {
  interface Window {
    slyCheckNowPlaying: () => void;
    antigravityInterval?: NodeJS.Timeout | number;
    // from ad-manager
    slyAdManager: { getAdMessage: () => string };
  }
}

console.log('[sly] DOM Engine starting...');
if (window.slyInjectCoreStyles) window.slyInjectCoreStyles();

// --- HOT RELOAD CLEANUP PROTOCOL ---
if (window.antigravityInterval) clearTimeout(window.antigravityInterval as number);
if (window.antigravitySyncAnimFrame) cancelAnimationFrame(window.antigravitySyncAnimFrame);
document.querySelectorAll('#lyrics-root-sync, #sly-hijack-styles').forEach(node => node.remove());

// Note: Navigation Interceptor, Interaction Monitoring, and Button Hijack have been moved to modules/content-events.js

// --- STATE SYNC ---
// Note: Internal extension state is now managed by window.slyInternalState in modules/state-manager.js
window.addEventListener('sly_state_update', () => {
  window.slyCheckNowPlaying();
});

// Pipeline B (lifecycleController.ts onSongChange) detects track changes reactively
// via aria-label mutation and dispatches this event. We listen here so the poll
// no longer needs to do its own title comparison (Step 2 removed below).
document.addEventListener('sly:song_change', (e: Event) => {
  const { uri } = (e as CustomEvent<{ uri?: string }>).detail;

  // Skip if this is a repeated dispatch for the URI we already have active.
  // Covers backwards skips to a recently played track where lastUri matches.
  if (uri && uri === window.slyInternalState.lastUri) return;

  // Important: zero the panelOpenTime BEFORE detection so the grace period
  // for the new song is calculated correctly.
  window.slyInternalState.panelOpenTime = 0;

  const detection = window.slyDetectNativeState();
  if (detection.title !== 'Unknown' && detection.title !== 'AD_SILENCED') {
    window.slyResetPlayerState(detection.title, uri);

    // Fire-and-forget prefetch to warm cache and seed registry early
    if (detection.title && detection.artist && !detection.isAd) {
      browser.runtime.sendMessage({
        type: 'PREFETCH_LYRICS',
        payload: { title: detection.title, artist: detection.artist, uri }
      }).then((r: any) => {
        if (r?.prefetchState && detection.currentTrackId) {
          window.slyPreFetchRegistry.register(detection.currentTrackId, r.prefetchState, {
            title: detection.title, artist: detection.artist,
            nativeMissing: r.nativeMissing
          });
        }
      }).catch(() => {});
    }
  }
});

// Pipeline B's syncSetup() dispatches this when native lyrics are in the DOM.
// Triggers the injection gate immediately for the common case where the fetch
// completed before the panel opened, saving up to 500ms of poll latency.
// slyCheckNowPlaying() reuses all existing guards — no logic is duplicated.
document.addEventListener('sly:lyrics_injected', () => {
  // No guard — call slyCheckNowPlaying() unconditionally so it handles both:
  //   • Injection gate: pendingLyricsData ready, panel just opened (Case B)
  //   • Persistence: currentLyrics active, panel re-opened, #lyrics-root-sync missing
  // Cost for normal songs: one extra cheap call per panel open — negligible since
  // slyCheckNowPlaying() already runs every 500ms.
  window.slyCheckNowPlaying();
});

// Pipeline B's domObserver dispatches this when [data-testid="lyrics-button"] loses
// its data-active="true" attribute. Handles panel close cleanup immediately instead
// of waiting up to 500ms for the poll.
document.addEventListener('sly:panel_close', () => {
  // Clear any failed states or manual overrides on panel close so users can recover
  if (window.slyInternalState.currentLyrics) {
    const cl = window.slyInternalState.currentLyrics as Record<string, unknown>;
    cl.failed = false;
    if (!cl.lines) {
      window.slyInternalState.currentLyrics = null;
    }
  }
  window.slyInternalState.forceFallback = false;

  const root = document.getElementById('lyrics-root-sync');
  if (!root) return; // slyCore wasn't active, nothing to clean
  console.log('[sly] Clean-up: Panel closed reactively, removing custom root.');
  if (window.slyClearStatus) window.slyClearStatus();
  root.remove();
  // Preserve fetching state: if a fetch is in-flight, re-mark isFetchingHUD = true
  // so the Re-injection Check can restore the loading screen if the panel re-opens.
  if (window.slyInternalState.fetchingForTitle) {
    window.slyInternalState.isFetchingHUD = true;
  }
  const syncBtn = document.getElementById('sly-sync-button');
  if (syncBtn) syncBtn.remove();
  const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`) as HTMLElement | null;
  if (main) { main.classList.remove('sly-active'); main.style.display = ''; }
  document.querySelectorAll(`.${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'}, .${window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM'}`)
    .forEach(n => ((n as HTMLElement).style.display = ''));
  const nativeContainer = document.querySelector(
    `main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container}:not(#lyrics-root-sync)`
  ) as HTMLElement | null;
  if (nativeContainer) nativeContainer.style.display = '';
  // Notify Pipeline B to stop its sync renderer and clear slyActiveContainer.
  document.dispatchEvent(new CustomEvent('sly:release'));
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
});

// sly:takeover only fires when injection fully succeeded (all four DOM steps complete).
// slyCore clears its own pending state here — no longer Pipeline B's responsibility.
document.addEventListener('sly:takeover', () => {
  window.slyInternalState.pendingLyricsData = null;
  window.slyInternalState.fetchingForTitle = '';
});

window.slyCheckNowPlaying = function (): void {
  try {
    const detection = window.slyDetectNativeState();
    const { title, artist, albumArtUrl } = detection;
    const fullUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;

    // 0. UNIVERSAL ORPHAN GUARD
    // Runs before the ad check so it catches the case where the button was
    // removed entirely (e.g. during an ad) rather than deactivated — the
    // MutationObserver in events.ts only fires on attribute changes, not removal.
    if (!detection.isOnLyricsPage && document.getElementById('lyrics-root-sync')) {
      console.log('[sly] Orphan guard: panel closed but #lyrics-root-sync still present — triggering cleanup.');
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
          window.slyShowStatus('Ad Break', window.slyAdManager.getAdMessage(), false, { isAd: true });
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
        if (cl?.lines && cl._slyUri === fullUri) {
          // Already correct — just sync lastUri forward so this branch doesn't re-evaluate
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
    if ((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.failed || window.slyInternalState.isFetchingHUD || window.slyInternalState.isAdHUDActive) {
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
            console.log('[sly] Restore: Re-injecting loading HUD...');
            window.slyShowStatus('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Resuming external search...');
          }
          return;
        }
      }
    }

    // 3. NETWORK SAFETY
    if (window.slyInternalState.interceptorActive || window.slyInternalState.isSpotifyFetching) {
      return;
    }

    // 4. DECISION ENGINE
    const { lyricsState } = detection;

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
    const isMissingOrUnsynced = (lyricsState === 'MISSING' || lyricsState === 'UNSYNCED' || window.slyInternalState.forceFallback);

    if (!window.slyInternalState.currentLyrics && !window.slyInternalState.fetchingForTitle && !window.slyInternalState.pendingLyricsData) {
      if (isMissingOrUnsynced) {
        // Issue 2 Fix: Defer MISSING decision if we have weak evidence and just changed songs.
        // This prevents the extension from jumping to a "lyrics unavailable" display while
        // Spotify's own UI is still settling or loading.
        const registryIsEmpty = !window.slyPreFetchRegistry.getState(detection.currentTrackId ?? '');
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
      } else if (lyricsState === 'SYNCED') {
        const decision = `synced:${title}`;
        if (window.slyInternalState.lastDecision !== decision) {
          console.log(`[sly-dom] ✅ DECISION: Native lyrics are synced for "${title}" [${fullUri?.split(':').pop() || 'N/A'}]. Engine standing down.`);
          window.slyInternalState.lastDecision = decision;
        }
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

      // Stand down if native lyrics suddenly became synced or we are unsynced vs unsynced
      if (lyricsState === 'SYNCED' && !window.slyInternalState.forceFallback) {
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        window.slyInternalState.fetchingForUri = '';
        if (window.slyClearStatus) window.slyClearStatus();
        return;
      }

      if (lyricsState === 'UNSYNCED' && !data.isSynced && !window.slyInternalState.forceFallback) {
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        window.slyInternalState.fetchingForUri = '';
        if (window.slyClearStatus) window.slyClearStatus();
        return;
      }

      console.log(`[sly] Taking over! | Native State: ${lyricsState}`);
      // Safety: Only inject if the data actually has content.
      const hasContent = !!(data.plainLyrics || data.syncedLyrics);

      if (hasContent) {
        // Hand off execution to Pipeline B. Clearing of pendingLyricsData moves to
        // the sly:takeover handler — it only fires when injection succeeded, so the
        // poll-retry-on-failure behaviour is preserved.
        document.dispatchEvent(new CustomEvent('sly:inject', {
          detail: { lyricsObj: data },
        }));
      } else {
        // If data is invalid (no content), clear it anyway to avoid looping
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        window.slyInternalState.fetchingForUri = '';
        if (window.slyClearStatus) window.slyClearStatus();
      }
    }

    // 6. PERSISTENCE & RE-INJECTION: We already have lyrics active, ensure they stay there.
    if (detection.isOnLyricsPage && (window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.lines) {
      const root = document.getElementById('lyrics-root-sync');
      const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`);

      // If the panel was re-opened and our DOM was wiped by React, re-inject
      if (!root || !root.isConnected || root.innerHTML === '') {
        console.log('[sly] Restore: Panel re-opened. Re-injecting lyrics DOM...');
        // Route through Pipeline B's unified injection path (sly:inject → setupSlyBridge).
        // slyInjectLyrics is no longer the executor — sly:inject is the contract.
        document.dispatchEvent(new CustomEvent('sly:inject', {
          detail: { lyricsObj: window.slyInternalState.currentLyrics as Record<string, unknown> },
        }));
      } else {
        // Ensure visibility and hijack classes are active
        root.style.display = '';
        if (main) main.classList.add('sly-active');

        document.querySelectorAll(`.${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'}, .${window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM'}`).forEach(n => ((n as HTMLElement).style.display = 'none'));
        const nativeContainer = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container}:not(#lyrics-root-sync)`) as HTMLElement | null;
        if (nativeContainer) nativeContainer.style.display = 'none';
      }
    }
    if (window.slyUpdateButtonState) window.slyUpdateButtonState();
  } catch (e) {
    console.error('[sly] Uncaught error in checkNowPlaying:', e);
  }
};

function startThrottledPoll() {
  if (window.antigravityInterval) clearTimeout(window.antigravityInterval as number);
  
  window.slyCheckNowPlaying();
  
  // Throttle to 5000ms if native lyrics are perfectly synced and we aren't fetching/forcing
  const isStandingDown = window.slyDetectNativeState().lyricsState === 'SYNCED' && 
                         !window.slyInternalState.forceFallback && 
                         !window.slyInternalState.fetchingForTitle &&
                         !window.slyInternalState.nativeRecoveryPending;
                         
  const interval = isStandingDown ? 5000 : 500;
  window.antigravityInterval = setTimeout(startThrottledPoll, interval) as unknown as number;
}
startThrottledPoll();
console.log('[sly] DOM Engine booted. Adaptive polling active.');
