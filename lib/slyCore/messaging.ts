// @ts-nocheck
// Port of: lyric-test/modules/core/messaging.js
export {};
// modules/content-messaging.js
// Handles cross-script communication and fetch triggering
//
// Adaptation note: chrome.runtime → browser.runtime (WXT polyfill, Promise-based)

declare global {
  interface Window {
    slyTriggerLyricsFetch: (title: string, artist: string, albumArtUrl: string, uri: string, forceRefresh?: boolean) => void;
    // Forward ref from content.js (not yet ported) — guarded in source via setTimeout
    slyCheckNowPlaying?: () => void;
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
    
    // SLY FIX: Populate L0 Session Cache for instant synchronous restoration on next play.
    const uri = (message.payload as Record<string, unknown>)?.uri as string;
    if (uri) window.slyInternalState.l0Cache.set(uri, fresh);

    window.slyInternalState.pendingLyricsData = fresh;
    console.log('[sly-dom] Background fetch succeeded. Pending lyrics data updated for automatic injection.');
  }
});

// --- MAIN WORLD MESSAGE BRIDGE ---
window.addEventListener('message', (event) => {
  const data = event.data as Record<string, unknown> | undefined;

  if (data?.type === 'SLY_FETCH_START') {
    window.slyInternalState.isSpotifyFetching = true;

  } else if (data?.type === 'SLY_FETCH_END') {
    window.slyInternalState.isSpotifyFetching = false;
    // Debounced retry covering slow React renders of the lyrics panel DOM.
    setTimeout(window.slyCheckNowPlaying, 300);

  } else if (data?.type === 'SLY_INTERCEPT_START') {
    const currentTrackId = (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();
    if (data.trackId && currentTrackId && data.trackId !== currentTrackId) return;

    console.log(`[sly-dom] ⏳ Interceptor is paused, waiting for Musixmatch. Suspending DOM Engine decisions.`);
    window.slyInternalState.interceptorActive = true;

  } else if (data?.type === 'SLY_INTERCEPT_END') {
    const currentTrackId = (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();
    if (data.trackId && currentTrackId && data.trackId !== currentTrackId) return;

    console.log(`[sly-dom] ⏳ Interceptor finished. Resuming DOM Engine decisions.`);
    window.slyInternalState.interceptorActive = false;
    setTimeout(window.slyCheckNowPlaying, 100); // Give React a moment to render the result

  } else if (data?.type === 'SLY_FORCE_FALLBACK') {
    const trackId = data.trackId as string | undefined;
    const currentTrackId = (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();

    let metadata: Record<string, unknown> | null = null;
    if (trackId === currentTrackId) {
      const track = window.spotifyState?.track as Record<string, unknown>;
      metadata = {
        title: track?.name,
        artist: (track?.artists as Record<string, string>[])?.[0]?.name,
        albumArtUrl: (track?.metadata as Record<string, string>)?.image_large_url ||
                     (track?.images as Record<string, string>[])?.[0]?.url,
      };
    }

    if (trackId) {
      window.slyPreFetchRegistry.register(trackId, 'ROMANIZED', { ...(metadata ?? {}), source: 'native', reason: 'Network Intercept (Romanized)' });
    }

    if (trackId && currentTrackId && trackId !== currentTrackId) {
      return;
    }

    console.log(`[sly-dom] 🚨 Layer 1 failed to de-romanize track. Forcing Layer 2 (YTM) fallback...`);
    window.slyInternalState.forceFallback = true;
    setTimeout(window.slyCheckNowPlaying, 100);

  } else if (data?.type === 'SLY_PREFETCH_REPORT') {
    const trackId = data.trackId as string;
    const state = data.state as string;
    const nativeStatus = data.nativeStatus as 'MISSING' | 'UNSYNCED' | 'ROMANIZED' | undefined;
    const currentTrackId = (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();

    let metadata: Record<string, unknown> | null = null;
    if (trackId === currentTrackId) {
      const track = window.spotifyState?.track as Record<string, unknown>;
      metadata = {
        title: track?.name,
        artist: (track?.artists as Record<string, string>[])?.[0]?.name,
      };
    }
    if (trackId) {
      window.slyPreFetchRegistry.register(trackId, state, {
        ...(metadata ?? {}),
        nativeStatus,
        source: 'native',
        reason: state === 'MISSING' ? 'Network Intercept (404)' : 'Network Intercept'
      });
    }

    // SLY FIX: Persist interceptor discovery to Background so it survives sessions.
    if (nativeStatus && metadata) {
      safeSendMessage({
        type: 'SLY_REPORT_NATIVE_STATUS',
        payload: {
          title: metadata.title as string,
          artist: metadata.artist as string,
          uri: `spotify:track:${trackId}`,
          status: nativeStatus
        }
      });
    }

  } else if (data?.type === 'SKL_NATIVE_LYRICS') {
    const trackId = data.trackId as string;
    const nativeLines = data.nativeLines as string[];
    const isRomanizedUpgrade = data.isRomanizedUpgrade as boolean;
    
    if (isRomanizedUpgrade) {
      console.log(`[sly-dom] 🤝 BRIDGE: Layer 1 (Network) successfully de-romanized track ${trackId}.`);
    } else {
      console.log(`[sly-dom] 🤝 BRIDGE: Layer 1 (Network) successfully upgraded track ${trackId}. External fallback not required.`);
    }

    if (trackId) {
      window.slyPreFetchRegistry.register(trackId, 'NATIVE_OK', { 
        source: 'native', 
        reason: isRomanizedUpgrade ? 'De-Romanization Success' : 'Network Upgrade Success' 
      });
    }

    // Optional: Store native lines in internal state for UI tagging
    const currentTrackId = (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();
    if (trackId === currentTrackId) {
      window.slyInternalState.nativeUpgradedLines = nativeLines;
      
      // BUG-38 Fix: If a takeover was already in progress or active (e.g. from a cache hit),
      // we MUST clean it up now that the network has recovered native lyrics.
      if (window.slyInternalState.currentLyrics || window.slyInternalState.isFetchingHUD) {
        document.dispatchEvent(new CustomEvent('sly:panel_close'));
      }

      window.slyInternalState.pendingLyricsData = null;
      window.slyInternalState.fetchingForTitle = '';
      window.slyInternalState.fetchingForUri = '';
      if (window.slyClearStatus) window.slyClearStatus();
    }
  } else if (data?.type === 'SLY_MXM_WARMUP') {
    safeSendMessage({ type: 'SLY_MXM_WARMUP' });

  } else if (data?.type === 'SLY_MXM_NOTIFY_METADATA') {
    safeSendMessage({ type: 'SLY_MXM_NOTIFY_METADATA', payload: data.payload });

  } else if (data?.type === 'SLY_MXM_NEW_INTERCEPTION') {
    const { requestId, payload } = data;
    safeSendMessage({ type: 'SLY_MXM_NEW_INTERCEPTION', payload }, (r) => {
      window.postMessage({ type: 'SLY_MXM_NEW_INTERCEPTION_RESPONSE', requestId, generation: r.generation }, window.location.origin);
    });

  } else if (data?.type === 'SLY_MXM_FETCH_NATIVE') {
    const { requestId, payload } = data;
    safeSendMessage({ type: 'SLY_MXM_FETCH_NATIVE', payload }, (r) => {
      window.postMessage({ type: 'SLY_MXM_FETCH_NATIVE_RESPONSE', requestId, ok: r.ok, lines: r.lines }, window.location.origin);
    });
  }
});

// --- SAFE SEND (Promise-based browser.runtime wrapper) ---
function safeSendMessage(msg: Record<string, unknown>, callback?: (r: Record<string, unknown>) => void): void {
  if (browser.runtime?.id) {
    browser.runtime.sendMessage(msg)
      .then((r: unknown) => {
        if (callback) callback(r as Record<string, unknown>);
      })
      .catch(() => { /* Extension context invalidated or no listener */ });
  }
}

// --- FETCH TRIGGER ---
window.slyTriggerLyricsFetch = function (title: string, artist: string, albumArtUrl: string, uri: string, forceRefresh = false): void {
  if (window.slyInternalState.fetchingForUri === uri && !forceRefresh) return;

  // 0. L0 SESSION CACHE CHECK (Magical Seamless Swap)
  // If we've already played this song in the current session, the lyrics are in RAM.
  // Restore them synchronously to eliminate the 2-3 frame async stutter.
  const trackId = uri?.split(':').pop();
  const isNativeSynced = trackId ? window.slyPreFetchRegistry.getState(trackId)?.nativeStatus === 'SYNCED' : false;

  const l0Hit = window.slyInternalState.l0Cache.get(uri);
  if (l0Hit && !forceRefresh && !isNativeSynced) {
    console.log(`[sly-msg] ⚡ L0 CACHE HIT: Seamlessly restoring state for "${title}" [${uri}]`);
    
    if (l0Hit.failed) {
      window.slyInternalState.currentLyrics = { failed: true, _slyUri: uri, extractedColor: l0Hit.extractedColor };
      window.slyInternalState.pendingLyricsData = null; // SLY FIX: Clear pending to prevent stale takeover
      window.slyInternalState.fetchingForTitle = '';
      window.slyInternalState.fetchingForUri = uri;
      
      const btn = document.querySelector('[data-testid="lyrics-button"]');
      if (btn?.getAttribute('data-active') === 'true' || btn?.getAttribute('aria-pressed') === 'true') {
        window.slyShowStatus(
          "Even Spotify Karaoke couldn't find the lyrics for this song.",
          'You can help the community by adding them to the open-source database.',
          true,
          { title, artist, albumArtUrl, extractedColor: l0Hit.extractedColor }
        );
      }
      return;
    }

    window.slyInternalState.pendingLyricsData = l0Hit;
    window.slyInternalState.fetchingForTitle = ''; // Prevents HUD from firing
    window.slyInternalState.fetchingForUri = uri;
    if (window.slyCheckNowPlaying) window.slyCheckNowPlaying();
    return;
  }

  window.slyInternalState.fetchingForTitle = title;
  window.slyInternalState.fetchingForUri = uri;

  // Capturing URI for stale check
  const myGeneration = window.slyInternalState.fetchGeneration;
  const myUri = uri;

  const pinnedMetadata: Record<string, unknown> = { title, artist, albumArtUrl };

  // 1. L0 SESSION CACHE CHECK (Theme/Colors Only)
  const sessionKey = `sly_theme_${albumArtUrl}`;
  const l0Color = albumArtUrl ? sessionStorage.getItem(sessionKey) : null;
  if (l0Color) {
    pinnedMetadata.extractedColor = l0Color;
  }

  // 2. HUD GRACE PERIOD (Seamless Persistent Hits)
  // Even if not in L0 yet, the persistent cache warming in content.ts might return 
  // in 1-2 frames. We wait 150ms before showing the HUD to give it a head-start.
  const hudGracePeriod = 150;
  setTimeout(() => {
    // ABORT CONDITIONS:
    // 1. Track changed during the grace period
    if (window.slyInternalState.fetchingForUri !== myUri) return;
    // 2. Lyrics were found (L1/L2 success) during the grace period
    if ((window.slyInternalState.pendingLyricsData as any)?._slyUri === myUri || 
        (window.slyInternalState.currentLyrics as any)?._slyUri === myUri) return;
    // 3. User closed the panel during the grace period
    if (!window.slyInternalState.fetchingForTitle) return;

    window.slyShowStatus('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Initializing external search...', false, pinnedMetadata);
  }, hudGracePeriod);

  // Fast-track color extraction to upgrade the HUD asynchronously
  if (albumArtUrl) {
    safeSendMessage({ type: 'GET_COLOR', payload: { albumArtUrl } }, (r) => {
      // 1. STALE TRACK CHECK
      if (myGeneration !== window.slyInternalState.fetchGeneration) return;

      if (r?.color) {
        // Populate L0 for next time
        sessionStorage.setItem(sessionKey, r.color as string);

        // Pin to metadata for the HUD
        pinnedMetadata.extractedColor = r.color;

        // ONLY back-fill the live state if it's a REAL lyrics object (with lines)
        if ((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.lines) {
          (window.slyInternalState.currentLyrics as Record<string, unknown>).extractedColor = r.color;
        }

        // 2. ALREADY FINISHED CHECK
        // If lyrics are already being injected or are in the queue, DO NOT show a fetching HUD.
        // We check for .lines specifically to avoid "Ghost Payloads" (objects with only color but no text).
        const hasPayload = !!((window.slyInternalState.pendingLyricsData as Record<string, unknown> | null)?.lines);
        const root = document.getElementById('lyrics-root-sync');
        const hasRendered = !!((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.lines) && !!root;

        if (hasRendered && r.color) {
          const currentBg = root.style.getPropertyValue('--lyrics-color-background')?.trim();
          // ONLY upgrade if the current background is a placeholder (missing, pitch black, or the error grey 0.20).
          // This prevents overwriting a high-quality "stolen" background from an unsynced track.
          const currentLum = currentBg ? window.slyPerceivedLuminance?.(currentBg) : 0;
          const isPlaceholder = !currentBg || currentLum < 0.05 || (currentLum > 0.19 && currentLum < 0.21);

          if (isPlaceholder) {
            console.log('[sly-dom] Upgrading placeholder background with late-arriving extracted color.');
            const safeBg = window.slyPerceivedLuminance?.(r.color) > 0.25 ? '#121212' : r.color;
            root.style.setProperty('--lyrics-color-background', safeBg);
          }
        }

        if (!hasPayload && !hasRendered) {
          window.slyShowStatus('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Initializing external search...', false, pinnedMetadata);
        }
      }
    });
  }

  console.log(`[sly] Fetching lyrics for "${title}" by ${artist} (${uri || 'no-uri'}) — sending request to service worker...`);

  const knownNativeStatus = trackId ? window.slyPreFetchRegistry.getState(trackId)?.nativeStatus : null;

  safeSendMessage({ type: 'FETCH_LYRICS', payload: { title, artist, albumArtUrl, uri, nativeStatus: knownNativeStatus, forceRefresh } }, (r) => {
    // STALE CHECK 1: Generation mismatch — native recovered or track changed mid-flight
    if (myGeneration !== window.slyInternalState.fetchGeneration) {
      // If the generation was bumped but the URI still matches, this is likely a
      // bridge-scanner stabilization reset (e.g. URI went from 'N/A' -> real).
      // We allow the response to proceed to avoid a redundant 500ms re-fetch delay.
      const uriStillMatches = myUri && window.slyInternalState.lastUri && myUri === window.slyInternalState.lastUri;
      if (!uriStillMatches) {
        console.log(`[sly] Fetch response for "${title}" discarded — generation is stale.`);
        // Only clear if we aren't already fetching for a new song.
        if (!window.slyInternalState.fetchingForTitle && window.slyClearStatus) window.slyClearStatus();
        return;
      }
    }

    // STALE CHECK 2: Track URI changed while in flight (tolerates title-only corrections).
    // Guard requires both sides to be real URIs — skips if lastUri was never set (first boot,
    // or slyResetPlayerState called without a URI argument).
    if (myUri && window.slyInternalState.lastUri && myUri !== window.slyInternalState.lastUri) {
      console.log(`[sly] Fetch response for "${title}" discarded — track already changed.`);
      // Only clear if we aren't already fetching for a new song.
      if (!window.slyInternalState.fetchingForTitle && window.slyClearStatus) window.slyClearStatus();
      return;
    }

    if (r?.prefetchState || r?.ok) {
      const trackId = (uri || myUri)?.split(':').pop();
      if (trackId) {
        const state = r.prefetchState || ((r.data as any)?.isSynced ? 'SYNCED' : 'UNSYNCED');
        window.slyPreFetchRegistry.register(trackId, state, {
          title, artist, nativeStatus: (r as any).nativeStatus,
          customStatus: state as any,
          reason: 'External Fetch Result'
        });
      }
    }

    if (r?.ok) {
      const mode = (r.data as Record<string, unknown>)?.isSynced ? 'synced (LRC)' : 'unsynced (plain)';
      console.log(`[sly] Fetch succeeded for "${title}" — got ${mode} lyrics.`);

      // SLY FIX: Populate L0 Session Cache for instant synchronous restoration on next play.
      if (uri) {
        (r.data as any)._slyUri = uri; // Ensure URI is stamped for L0 consistency
        window.slyInternalState.l0Cache.set(uri, r.data);
      }

      // We DON'T clear status here; slyInjectLyrics will handle it for a smooth transition
      window.slyInternalState.pendingLyricsData = r.data as Record<string, unknown>;
      // Kick injection immediately if the panel is already open
      setTimeout(window.slyCheckNowPlaying, 0);
    } else {
      console.warn(`[sly] Fetch failed for "${title}" — no lyrics found.`);
      
      // SLY FIX: Populate L0 Session Cache with failure state.
      if (uri) window.slyInternalState.l0Cache.set(uri, { failed: true, _slyUri: uri, extractedColor: (r?.data as any)?.extractedColor });

      window.slyInternalState.fetchingForTitle = '';
      window.slyInternalState.fetchingForUri = '';

      // Save failure state AND extracted color for immersive HUD
      window.slyInternalState.currentLyrics = {
        failed: true,
        extractedColor: (r?.data as Record<string, unknown>)?.extractedColor,
      };

      // Only show failure HUD if panel is currently open
      const btn = document.querySelector('[data-testid="lyrics-button"]');
      if (btn?.getAttribute('data-active') === 'true' || btn?.getAttribute('aria-pressed') === 'true') {
        window.slyShowStatus(
          "Even Spotify Karaoke couldn't find the lyrics for this song.",
          'You can help the community by adding them to the open-source database.',
          true,
          pinnedMetadata,
        );
      }
    }
  });
};
