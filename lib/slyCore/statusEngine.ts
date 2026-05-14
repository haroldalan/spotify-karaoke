// @ts-nocheck
import { slyInternalState } from './state';

/**
 * StatusEngine: Manages the lifecycle of the extension's Status HUD.
 * Handles theme mirroring, state announcements, and DOM cleanup.
 */
export const StatusEngine = {
  /**
   * Shows the Status HUD with a specific message and subtext.
   */
  show(message: string, subtext: string, isError = false, metadata: Record<string, any> | null = null): void {
    if (window.slyInjectCoreStyles) window.slyInjectCoreStyles();

    const root = window.slyPrepareContainer();
    if (!root) return;

    // 1. Theme Mirroring
    const nativeRef = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync)`) as HTMLElement | null;
    
    // Check sessionStorage for late-arriving or persistent theme colors
    const sessionKey = `sly_theme_${metadata?.albumArtUrl}`;
    const l0Color = metadata?.albumArtUrl ? sessionStorage.getItem(sessionKey) : null;

    const extractedColor = (metadata?.extractedColor as string) ||
                           l0Color ||
                           (slyInternalState.pendingLyricsData as Record<string, any> | null)?.extractedColor ||
                           (slyInternalState.currentLyrics as Record<string, any> | null)?.extractedColor;

    window.slyMirrorNativeTheme(root, { extractedColor }, nativeRef);

    // 2. HUD Construction
    let hud = document.getElementById('sly-status-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'sly-status-hud';
      root.appendChild(hud);
    }

    const isAd = metadata?.isAd === true;
    hud.className = isError ? 'sly-hud-error' : (isAd ? 'sly-hud-ad' : 'sly-hud-loading');

    const track = window.spotifyState?.track as Record<string, any> | null;
    let title = (metadata?.title as string) || (track?.name as string) || 'this song';
    let artist = (metadata?.artist as string) || (track?.artists?.[0]?.name) || 'unknown artist';
    const artUrl = (metadata?.albumArtUrl as string) || track?.metadata?.image_large_url || track?.images?.[0]?.url || '';

    let content = `
      <div class="sly-hud-bg-blur" style="background-image: url('${artUrl}')"></div>
      <div class="sly-hud-overlay"></div>
      <div class="sly-hud-container">
        <div class="sly-hud-brand encore-text-body-small">${isAd ? 'Intermission' : 'Spotify Karaoke'}</div>
        <div class="sly-hud-message encore-text-title-large">${message.replace('[Title]', title).replace('[Artist]', artist)}</div>
        <div class="sly-hud-subtext encore-text-body-medium">${subtext}</div>
    `;

    if (isError) {
      content += this._buildErrorCta(title, artist, metadata);
    } else {
      content += `<div class="sly-hud-pulse ${isAd ? 'sly-pulse-ad' : ''}"></div>`;
    }

    content += `</div>`;
    hud.innerHTML = content;

    if (isError) this._attachErrorListeners(hud, title, artist, artUrl, metadata?.uri);

    // 3. State Management
    slyInternalState.statusHUDActive = true;
    slyInternalState.isFetchingHUD = !isError && !isAd;
    slyInternalState.isAdHUDActive = isAd;

    const hudState = isError ? 'FAILED' : (isAd ? 'AD' : 'FETCHING');
    document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: hudState } }));
    
    console.log(`[StatusEngine] 📝 Showing ${hudState} HUD for: "${title}"`);
  },

  /**
   * Clears the Status HUD and restores native UI visibility.
   */
  clear(): void {
    const hud = document.getElementById('sly-status-hud');
    if (!hud) return;

    console.log('[StatusEngine] 🧹 Clearing HUD and restoring native visibility.');

    // Restore native container
    const nativeRef = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync)`) as HTMLElement | null;
    if (nativeRef) nativeRef.style.display = '';

    const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`);
    if (main) main.classList.remove('sly-active');

    hud.remove();

    // Clean up empty sync shell
    const root = document.getElementById('lyrics-root-sync');
    if (root && !root.querySelector('[data-testid="lyrics-line"]')) {
      root.remove();
    }

    slyInternalState.statusHUDActive = false;
    slyInternalState.isFetchingHUD = false;
    slyInternalState.isAdHUDActive = false;
  },

  _buildErrorCta(title: string, artist: string, metadata: any) {
    const lrcLibUrl = new URL('https://lrclibup.boidu.dev/');
    lrcLibUrl.searchParams.set('title', title);
    lrcLibUrl.searchParams.set('artist', artist);
    
    return `
      <div class="sly-hud-cta-wrapper" style="display: flex; gap: 12px; margin-top: 16px; justify-content: flex-start; flex-wrap: wrap;">
        <a href="${lrcLibUrl.toString()}" target="_blank" class="encore-text-body-medium-bold ${window.SPOTIFY_CLASSES?.btnPrimary || 'e-10451-legacy-button e-10451-legacy-button-primary'}">
          <span class="e-10451-overflow-wrap-anywhere ${window.SPOTIFY_CLASSES?.btnPrimaryInner || 'e-10451-button-primary__inner'} encore-inverted-light-set e-10451-legacy-button--medium">Add lyrics to LRCLIB</span>
        </a>
        <a id="sly-hud-retry-btn" href="#" class="encore-text-body-medium-bold ${window.SPOTIFY_CLASSES?.btnSecondary || 'e-10451-legacy-button e-10451-legacy-button-secondary'}" style="cursor: pointer; transition: transform 0.2s ease; text-decoration: none;">
          <span class="e-10451-overflow-wrap-anywhere ${window.SPOTIFY_CLASSES?.btnSecondaryInner || 'e-10451-button-secondary__inner'} e-10451-legacy-button--medium">Retry Fetch</span>
        </a>
      </div>
    `;
  },

  _attachErrorListeners(hud: HTMLElement, title: string, artist: string, artUrl: string, uri: string) {
    const retryBtn = hud.querySelector('#sly-hud-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[StatusEngine] 🔄 User triggered manual retry...');
        if (window.slyTriggerLyricsFetch) {
          window.slyTriggerLyricsFetch(title, artist, artUrl, uri, true);
        }
      });
    }
  }
};
