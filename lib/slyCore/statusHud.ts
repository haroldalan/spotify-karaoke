// @ts-nocheck
// Port of: lyric-test/modules/core/status-hud.js
export {};
/* modules/core/status-hud.js: Spotify Karaoke Status and Error Overlay */

declare global {
  interface Window {
    slyShowStatus: (message: string, subtext: string, isError?: boolean, metadata?: Record<string, unknown> | null) => void;
    slyClearStatus: () => void;
    // Forward ref from dom-engine (loaded before this module)
    slyInjectCoreStyles: () => void;
    slyPrepareContainer: () => HTMLElement | null;
    slyMirrorNativeTheme: (root: HTMLElement, lyricsObj: Record<string, unknown>, nativeReference: HTMLElement | null) => void;
  }
}

(function () {
  window.slyShowStatus = function (message: string, subtext: string, isError = false, metadata: Record<string, unknown> | null = null): void {
    // 0. Ensure styles are injected
    if (window.slyInjectCoreStyles) window.slyInjectCoreStyles();

    // 1. Prepare our shielded container
    const root = window.slyPrepareContainer();
    if (!root) return;

    // 2. Mirror theme and hide the native Spotify container
    const nativeRef = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync)`) as HTMLElement | null;

    // Ensure we have the color even on failure/loading
    const extractedColor = (metadata?.extractedColor as string) ||
                           (window.slyInternalState.pendingLyricsData as Record<string, unknown> | null)?.extractedColor as string ||
                           (window.slyInternalState.currentLyrics as Record<string, unknown> | null)?.extractedColor as string;

    const dummyLyrics = { extractedColor };
    window.slyMirrorNativeTheme(root, dummyLyrics, nativeRef);

    let hud = document.getElementById('sly-status-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'sly-status-hud';
      root.appendChild(hud);
    }

    const isAd = metadata?.isAd === true;
    hud.className = isError ? 'sly-hud-error' : (isAd ? 'sly-hud-ad' : 'sly-hud-loading');

    const track = window.spotifyState.track as Record<string, unknown> | null;

    // Ad Metadata Scavenging: Ads often have null metadata in the bridge,
    // so we scavenge from the DOM if we are in an ad state.
    let title = (metadata?.title as string) || (track?.name as string);
    let artist = (metadata?.artist as string) || ((track?.artists as Record<string, string>[])?.[0]?.name);
    let album = (metadata?.album as string) || (track?.album as Record<string, unknown>)?.name as string || '';

    if (isAd && (!title || title === 'Unknown' || title === 'Spotify' || title === 'Advertisement')) {
      const domTitle = document.querySelector('[data-testid="context-item-info-title"]')?.textContent;
      const domArtist = document.querySelector('[data-testid="context-item-info-ad-subtitle"]')?.textContent ||
                        document.querySelector('[data-testid="context-item-info-subtitles"]')?.textContent;
      if (domTitle) title = domTitle;
      if (domArtist) artist = domArtist;
    }

    title = title || 'this song';
    artist = artist || 'unknown artist';

    // Duration Extraction: Try DOM first (most reliable), then metadata
    const durationEl = document.querySelector('[data-testid="playback-duration"]');
    let duration = 0;
    if (durationEl && durationEl.textContent?.includes(':')) {
      const parts = durationEl.textContent.split(':');
      duration = (parseInt(parts[0]) * 60) + parseInt(parts[1]);
    } else {
      duration = Math.floor(((track?.duration_ms as number) || 0) / 1000);
    }

    const artUrl = (metadata?.albumArtUrl as string) ||
                   (track?.metadata as Record<string, string>)?.image_large_url ||
                   ((track?.images as Record<string, string>[])?.[0]?.url) || '';

    let content = `
            <div class="sly-hud-bg-blur" style="background-image: url('${artUrl}')"></div>
            <div class="sly-hud-overlay"></div>
            <div class="sly-hud-container">
                <div class="sly-hud-brand encore-text-body-small">${isAd ? 'Intermission' : 'Spotify Karaoke'}</div>
                <div class="sly-hud-message encore-text-title-large">${message.replace('[Title]', title).replace('[Artist]', artist)}</div>
                <div class="sly-hud-subtext encore-text-body-medium">${subtext}</div>
        `;

    if (isError) {
      const lrcLibUrl = new URL('https://lrclibup.boidu.dev/');
      lrcLibUrl.searchParams.set('title', title);
      lrcLibUrl.searchParams.set('artist', artist);
      if (album) lrcLibUrl.searchParams.set('album', album);
      if (duration) lrcLibUrl.searchParams.set('duration', String(duration));

      // Full Native Encore Button Anatomy:
      content += `
                <div class="sly-hud-cta-wrapper">
                    <a href="${lrcLibUrl.toString()}" target="_blank" class="encore-text-body-medium-bold ${window.SPOTIFY_CLASSES?.btnPrimary || 'e-10451-legacy-button e-10451-legacy-button-primary'}">
                        <span class="e-10451-overflow-wrap-anywhere ${window.SPOTIFY_CLASSES?.btnPrimaryInner || 'e-10451-button-primary__inner'} encore-inverted-light-set e-10451-legacy-button--medium">
                            Add lyrics to LRCLIB
                        </span>
                    </a>
                </div>
            `;
    } else {
      content += `<div class="sly-hud-pulse ${isAd ? 'sly-pulse-ad' : ''}"></div>`;
    }

    content += `</div>`;
    hud.innerHTML = content;

    window.slyInternalState.statusHUDActive = true;
    window.slyInternalState.isFetchingHUD = !isError && !isAd;
    window.slyInternalState.isAdHUDActive = isAd;

    // Announce HUD state to Pipeline B via the sly:state event bus.
    // lifecycleController subscribes and hides the mode pill immediately.
    const hudState = isError ? 'FAILED' : (isAd ? 'AD' : 'FETCHING');
    document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: hudState } }));
  };

  window.slyClearStatus = function (): void {
    const hud = document.getElementById('sly-status-hud');
    if (!hud) return;

    // Restore native container visibility
    const nativeRef = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync)`) as HTMLElement | null;
    if (nativeRef) nativeRef.style.display = '';

    // Release the scroll lock
    const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`);
    if (main) main.classList.remove('sly-active');

    hud.remove();

    // Remove the empty shell. If it has no real lyrics content,
    // it will sit with min-height:100% and push native lyrics off-screen.
    const root = document.getElementById('lyrics-root-sync');
    if (root && !root.querySelector('[data-testid="lyrics-line"]')) {
      root.remove();
    }

    window.slyInternalState.statusHUDActive = false;
    window.slyInternalState.isFetchingHUD = false;
    window.slyInternalState.isAdHUDActive = false;
  };
})();
