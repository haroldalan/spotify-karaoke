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
if (window.antigravityInterval) clearInterval(window.antigravityInterval);
if (window.antigravitySyncAnimFrame) cancelAnimationFrame(window.antigravitySyncAnimFrame);
document.querySelectorAll('#lyrics-root-sync, #sly-hijack-styles').forEach(node => node.remove());

// Note: Navigation Interceptor, Interaction Monitoring, and Button Hijack have been moved to modules/content-events.js

// --- STATE SYNC ---
// Note: Internal extension state is now managed by window.slyInternalState in modules/state-manager.js
window.addEventListener('sly_state_update', () => {
  window.slyCheckNowPlaying();
});

window.slyCheckNowPlaying = function (): void {
  try {
    const detection = window.slyDetectNativeState();
    const { title, artist, albumArtUrl } = detection;
    const fullUri = (window.spotifyState?.track as Record<string, unknown> | null)?.uri as string | undefined;

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

    // 2. TRACK CHANGE RESET
    if (title !== 'Unknown' && title !== window.slyInternalState.lastTitle && title !== 'AD_SILENCED') {
      window.slyResetPlayerState(title, fullUri);
    }

    // 2. PANEL STATUS CHECK
    if (!detection.isOnLyricsPage) {
      const root = document.getElementById('lyrics-root-sync');
      if (root) {
        console.log('[sly] Clean-up: Leaving lyrics page, removing custom root.');
        if (window.slyClearStatus) window.slyClearStatus();
        root.remove();

        // Explicitly remove active markers from main container
        const main = document.querySelector('main.J6wP3V0xzh0Hj_MS') as HTMLElement | null;
        if (main) {
          main.classList.remove('sly-active');
          main.style.display = ''; // Restore Spotify's original display
        }

        // Restore visibility of any hidden native components
        document.querySelectorAll('.hfTlyhd7WCIk9xmP, .bRNotDNzO2suN6vM').forEach(n => ((n as HTMLElement).style.display = ''));
        const nativeContainer = document.querySelector(`main.J6wP3V0xzh0Hj_MS .${window.SPOTIFY_CLASSES?.container}:not(#lyrics-root-sync)`) as HTMLElement | null;
        if (nativeContainer) nativeContainer.style.display = '';
      }
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
      return;
    }

    // 3. GRACE PERIOD HANDLING
    const isMissingOrUnsynced = (lyricsState === 'MISSING' || lyricsState === 'UNSYNCED' || window.slyInternalState.forceFallback);

    if (!window.slyInternalState.currentLyrics && !window.slyInternalState.fetchingForTitle && !window.slyInternalState.pendingLyricsData) {
      if (isMissingOrUnsynced) {
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
      }
    }

    // 5. INJECTION GATE: We have fresh lyrics data waiting for the panel to be ready.
    if (window.slyInternalState.pendingLyricsData && detection.isOnLyricsPage) {
      const data = window.slyInternalState.pendingLyricsData as Record<string, unknown>;

      // Stand down if native lyrics suddenly became synced or we are unsynced vs unsynced
      if (lyricsState === 'SYNCED' && !window.slyInternalState.forceFallback) {
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        return;
      }

      if (lyricsState === 'UNSYNCED' && !data.isSynced && !window.slyInternalState.forceFallback) {
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
        return;
      }

      console.log(`[sly] Taking over! | Native State: ${lyricsState}`);
      // Safety: Only inject if the data actually has content.
      const hasContent = !!(data.plainLyrics || data.syncedLyrics);

      if (hasContent) {
        if (window.slyInjectLyrics) {
          const success = window.slyInjectLyrics(data);
          if (success) {
            window.slyInternalState.pendingLyricsData = null;
            window.slyInternalState.fetchingForTitle = '';
          }
        }
      } else {
        // If data is invalid (no content), clear it anyway to avoid looping
        window.slyInternalState.pendingLyricsData = null;
        window.slyInternalState.fetchingForTitle = '';
      }
    }

    // 6. PERSISTENCE & RE-INJECTION: We already have lyrics active, ensure they stay there.
    if (detection.isOnLyricsPage && (window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.lines) {
      const root = document.getElementById('lyrics-root-sync');
      const main = document.querySelector('main.J6wP3V0xzh0Hj_MS');

      // If the panel was re-opened and our DOM was wiped by React, re-inject
      if (!root || !root.isConnected || root.innerHTML === '') {
        console.log('[sly] Restore: Panel re-opened. Re-injecting lyrics DOM...');
        if (window.slyInjectLyrics) window.slyInjectLyrics(window.slyInternalState.currentLyrics as Record<string, unknown>);
      } else {
        // Ensure visibility and hijack classes are active
        root.style.display = '';
        if (main) main.classList.add('sly-active');

        document.querySelectorAll('.hfTlyhd7WCIk9xmP, .bRNotDNzO2suN6vM').forEach(n => ((n as HTMLElement).style.display = 'none'));
        const nativeContainer = document.querySelector(`main.J6wP3V0xzh0Hj_MS .${window.SPOTIFY_CLASSES.container}:not(#lyrics-root-sync)`) as HTMLElement | null;
        if (nativeContainer) nativeContainer.style.display = 'none';
      }
    }
    if (window.slyUpdateButtonState) window.slyUpdateButtonState();
  } catch (e) {
    console.error('[sly] Uncaught error in checkNowPlaying:', e);
  }
};

window.antigravityInterval = setInterval(window.slyCheckNowPlaying, 500);
console.log('[sly] DOM Engine booted. Polling every 500ms.');
