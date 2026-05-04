// Port of: lyric-test/modules/core/messaging.js
// modules/content-messaging.js
// Handles cross-script communication and fetch triggering
//
// Adaptation note: chrome.runtime → browser.runtime (WXT polyfill, Promise-based)

declare global {
  interface Window {
    slyTriggerLyricsFetch: (title: string, artist: string, albumArtUrl: string, uri: string) => void;
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
    // Retry cascade covering slow React renders of the lyrics panel DOM.
    setTimeout(window.slyCheckNowPlaying, 100);
    setTimeout(window.slyCheckNowPlaying, 300);
    setTimeout(window.slyCheckNowPlaying, 600);

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
      window.slyPreFetchRegistry.register(trackId, 'ROMANIZED', { ...(metadata ?? {}), source: 'native' });
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
    window.slyPreFetchRegistry.register(trackId, state, {
      ...(metadata ?? {}),
      nativeStatus,
      source: 'native'
    });

  } else if (data?.type === 'SKL_NATIVE_LYRICS') {
    const trackId = data.trackId as string;
    const nativeLines = data.nativeLines as string[];
    console.log(`[sly-dom] 🤝 BRIDGE: Layer 1 (Network) successfully upgraded track ${trackId}. External fallback not required.`);

    // Update registry so we don't try to fetch Layer 2 unnecessarily
    window.slyPreFetchRegistry.register(trackId, 'NATIVE_OK', { source: 'native' });

    // Optional: Store native lines in internal state for UI tagging
    const currentTrackId = (window.spotifyState?.track as Record<string, unknown>)?.uri?.toString()?.split(':').pop();
    if (trackId === currentTrackId) {
      window.slyInternalState.nativeUpgradedLines = nativeLines;
      window.slyInternalState.pendingLyricsData = null;
      window.slyInternalState.fetchingForTitle = '';
      window.slyInternalState.fetchingForUri = '';
      if (window.slyClearStatus) window.slyClearStatus();
    }
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
window.slyTriggerLyricsFetch = function (title: string, artist: string, albumArtUrl: string, uri: string): void {
  if (window.slyInternalState.fetchingForUri === uri) return;
  window.slyInternalState.fetchingForTitle = title;
  window.slyInternalState.fetchingForUri = uri;

  // Capture the generation and URI at the moment this fetch is dispatched.
  const myGeneration = window.slyInternalState.fetchGeneration;
  const myUri = uri;

  const pinnedMetadata: Record<string, unknown> = { title, artist, albumArtUrl };

  // Show initial Status HUD immediately to prevent blank panel
  window.slyShowStatus('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Initializing external search...', false, pinnedMetadata);

  // Fast-track color extraction to upgrade the HUD asynchronously
  if (albumArtUrl) {
    safeSendMessage({ type: 'GET_COLOR', payload: { albumArtUrl } }, (r) => {
      // 1. STALE TRACK CHECK
      if (myGeneration !== window.slyInternalState.fetchGeneration) return;

      if (r?.color) {
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
        const hasRendered = !!((window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.lines);

        if (!hasPayload && !hasRendered) {
          window.slyShowStatus('Spotify Karaoke is fetching lyrics for [Title] by [Artist]', 'Initializing external search...', false, pinnedMetadata);
        }
      }
    });
  }

  console.log(`[sly] Fetching lyrics for "${title}" by ${artist} (${uri || 'no-uri'}) — sending request to service worker...`);
  safeSendMessage({ type: 'FETCH_LYRICS', payload: { title, artist, albumArtUrl, uri } }, (r) => {
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
          customStatus: state as any
        });
      }
    }

    if (r?.ok) {
      const mode = (r.data as Record<string, unknown>)?.isSynced ? 'synced (LRC)' : 'unsynced (plain)';
      console.log(`[sly] Fetch succeeded for "${title}" — got ${mode} lyrics.`);

      // We DON'T clear status here; slyInjectLyrics will handle it for a smooth transition
      window.slyInternalState.pendingLyricsData = r.data as Record<string, unknown>;
      // Kick injection immediately if the panel is already open
      setTimeout(window.slyCheckNowPlaying, 0);
    } else {
      console.warn(`[sly] Fetch failed for "${title}" — no lyrics found.`);
      window.slyInternalState.fetchingForTitle = '';
      window.slyInternalState.fetchingForUri = '';

      // Save failure state AND extracted color for immersive HUD
      window.slyInternalState.currentLyrics = {
        failed: true,
        extractedColor: (r?.data as Record<string, unknown>)?.extractedColor,
      };

      // Only show failure HUD if panel is currently open
      if (document.querySelector('[data-testid="lyrics-button"]')?.getAttribute('data-active') === 'true') {
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
