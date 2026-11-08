// @ts-nocheck
import { slyInternalState } from './state';
import { slyGetNativePanel, slyTagLayoutHost, slyUntagLayoutHost, slyGetEncorePrefix, slyStatusPlacement, slyRestoreOverlayContent } from './domEngine';
import { NOW_PLAYING_WIDGET, getThemedPanelContainer } from '../dom/domQueries';
import { getLyricsStatus, setLyricsStatus, type LyricsStatus } from './lyricsStatus';
import { syncLyricsChip, LYRICS_STATUS_ID } from './lyricsChip';
import { showToast, hideToast } from '../dom/toast';

/** How long a toast with a final status (not found) stays, when the toast is the surface. */
export const STATUS_TOAST_MS = 6000;
/** The toast currently says the status (so clear() takes it away). */
let toastIsStatus = false;

/** The native container show() hid, so clear() can give back exactly that element. */
let hudHiddenNativeRef: HTMLElement | null = null;

/**
 * Spotify's own lyrics are on screen (rows with words in its lyrics panel). Either they
 * belong to the track (unsynced or romanized lyrics the extension is upgrading: they stay
 * readable until the upgrade is ready, then one swap), or Spotify is still swapping away
 * from the previous track's panel (a status drawn there is wiped by that swap a few
 * frames later and drawn again: a flash).
 */
export function spotifyLyricsOnScreen(): boolean {
  const panel = getThemedPanelContainer();
  if (!panel) return false;
  return Array.from(panel.querySelectorAll('[data-testid="lyrics-line"]'))
    .some(l => /[\p{L}\p{N}]/u.test(l.textContent || ''));
}

/** Retry while Spotify's lyrics are on screen: the previous track's panel goes within a moment. */
const DEFER_RETRY_MS = 250;
const DEFER_MAX_RETRIES = 12;
let deferTimer: ReturnType<typeof setTimeout> | null = null;
let deferLoggedFor = '';

function cancelDeferredShow(): void {
  if (deferTimer) clearTimeout(deferTimer);
  deferTimer = null;
}

/**
 * StatusEngine: Manages the lifecycle of the extension's Status HUD.
 * Handles theme mirroring, state announcements, and DOM cleanup.
 */
export const StatusEngine = {
  /**
   * Shows the Status HUD with a specific message and subtext.
   */
  show(message: string, subtext: string, isError = false, metadata: Record<string, any> | null = null): void {
    cancelDeferredShow();
    if (spotifyLyricsOnScreen()) {
      // Never over Spotify's own lyrics: they stay until the extension's are ready (or, for
      // the previous track's panel, until Spotify has swapped it away: then shown once).
      const uri = String(window.spotifyState?.track?.uri ?? '');
      const retries = Number(metadata?.__slyDeferRetries ?? 0);
      if (deferLoggedFor !== uri) {
        deferLoggedFor = uri;
        console.log(`[StatusEngine] Spotify's lyrics are on screen: not covering them with "${message}".`);
      }
      if (retries < DEFER_MAX_RETRIES) {
        deferTimer = setTimeout(() => {
          deferTimer = null;
          if (String(window.spotifyState?.track?.uri ?? '') !== uri) return;
          StatusEngine.show(message, subtext, isError, { ...(metadata ?? {}), __slyDeferRetries: retries + 1 });
        }, DEFER_RETRY_MS);
      }
      return;
    }
    const placement = slyStatusPlacement();
    if (!placement) return;
    const { title, artist, artUrl } = this._describeTrack(metadata);

    // Spotify's expanded Now Playing view shows its own artwork and cards (a song it has
    // no lyrics for): the status goes on our Lyrics button in its media switch, never over
    // that content.
    if (placement === 'overlay') {
      this._showOnLyricsButton(message, subtext, isError, metadata, title, artist, artUrl);
      return;
    }
    this._dropButtonStatus();

    if (window.slyInjectCoreStyles) window.slyInjectCoreStyles();

    const root = window.slyPrepareContainer();
    if (!root) return;
    root.classList.remove('sly-root-notice');

    // 1. Theme Mirroring (2026 UI: full-panel themed DIV, NPV preview excluded; legacy main selector as fallback)
    const nativeRef = slyGetNativePanel();

    // Check sessionStorage for late-arriving or persistent theme colors
    const sessionKey = `sly_theme_${metadata?.albumArtUrl}`;
    const l0Color = metadata?.albumArtUrl ? sessionStorage.getItem(sessionKey) : null;

    const extractedColor = (metadata?.extractedColor as string) ||
                           l0Color ||
                           (slyInternalState.pendingLyricsData as Record<string, any> | null)?.extractedColor ||
                           (slyInternalState.currentLyrics as Record<string, any> | null)?.extractedColor;

    window.slyMirrorNativeTheme(root, { extractedColor }, nativeRef);
    // slyMirrorNativeTheme hid nativeRef; remember it so clear() restores this exact node.
    if (nativeRef) hudHiddenNativeRef = nativeRef;

    // SLY FIX: Explicitly mark the layout host as HUD-active to trigger layout locking.
    // This replaces the finicky CSS :has() selector which was causing scroll-freeze in Firefox.
    // K11: the host is the themed panel's parent (legacy fallback: main.<mainContainer>).
    slyTagLayoutHost('sly-hud-active');

    // 2. HUD Construction
    let hud = document.getElementById('sly-status-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'sly-status-hud';
      root.appendChild(hud);
    }

    hud.className = isError ? 'sly-hud-error' : 'sly-hud-loading';

    let content = `
      <div class="sly-hud-bg-blur" style="background-image: url('${artUrl}')"></div>
      <div class="sly-hud-overlay"></div>
      <div class="sly-hud-container">
        <div class="sly-hud-brand encore-text-body-small">Spotify Karaoke</div>
        <div class="sly-hud-message encore-text-title-large">${message.replace('[Title]', title).replace('[Artist]', artist)}</div>
        <div class="sly-hud-subtext encore-text-body-medium">${subtext}</div>
    `;

    if (isError) {
      content += this._buildErrorCta(title, artist, metadata);
    } else {
      content += `<div class="sly-hud-pulse"></div>`;
    }

    content += `</div>`;
    hud.innerHTML = content;

    if (isError) this._attachErrorListeners(hud, title, artist, artUrl, metadata?.uri, metadata);

    // 3. State Management
    slyInternalState.statusHUDActive = true;
    slyInternalState.isFetchingHUD = !isError;

    const hudState = isError ? 'FAILED' : 'FETCHING';
    document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: hudState } }));
    
    console.log(`[StatusEngine] 📝 Showing ${hudState} HUD for: "${title}"`);
  },

  /**
   * Clears the Status HUD and restores native UI visibility.
   *
   * Accepts the legacy `preserveState` boolean or an options object.
   * `restoreNative: false` (HUD → takeover handoff): remove only the HUD node and the
   * sly-hud-active lock. #lyrics-root-sync, sly-active and the hidden native panel stay,
   * so Spotify's panel does not flash while the takeover is built. The hidden-panel
   * reference is kept too: if the takeover never renders lines, a later clear() still
   * gives that panel back.
   */
  clear(opts: boolean | { preserveState?: boolean; restoreNative?: boolean } = false): void {
    const { preserveState = false, restoreNative = true } =
      typeof opts === 'boolean' ? { preserveState: opts } : (opts ?? {});

    cancelDeferredShow();
    this._dropButtonStatus();

    const hud = document.getElementById('sly-status-hud');
    const hiddenNativeRef = hudHiddenNativeRef;

    if (!restoreNative) {
      if (hud) {
        console.log('[StatusEngine] 🧹 Removing HUD for takeover handoff (native panel stays hidden).');
        hud.remove();
      }
      slyUntagLayoutHost('sly-hud-active');
    } else if (hud || hiddenNativeRef) {
      // hiddenNativeRef also covers a HUD that was wiped by a rebuild of #lyrics-root-sync
      // (slyBuildLyricsList empties the root) but whose native panel is still hidden.
      const root = document.getElementById('lyrics-root-sync');
      const rootHasLines = !!root?.querySelector('[data-testid="lyrics-line"]');
      if (!rootHasLines) {
        console.log(`[StatusEngine] 🧹 Clearing HUD and restoring native visibility (Preserve State: ${preserveState}).`);
      } else if (hud) {
        console.log('[StatusEngine] 🧹 Clearing HUD; takeover lines are on screen, native panel stays hidden.');
      }

      if (hud) hud.remove();

      // Clean up empty sync shell
      if (root && !rootHasLines) {
        root.remove();
        if (slyInternalState.customRoot === root) slyInternalState.customRoot = null;
      }

      // The HUD is gone: release the layout lock (K11 element).
      slyUntagLayoutHost('sly-hud-active');

      // Restore native container — only when no custom lyrics are on screen. If a
      // takeover already rendered lines into #lyrics-root-sync, it owns the hiding.
      if (!rootHasLines) {
        const targets = new Set<HTMLElement>();
        if (hiddenNativeRef?.isConnected) targets.add(hiddenNativeRef);
        const current = slyGetNativePanel();
        if (current) targets.add(current);
        targets.forEach(el => { el.style.display = ''; });
        slyUntagLayoutHost('sly-active');
      }
      hudHiddenNativeRef = null;
    }

    if (!preserveState) {
      slyInternalState.statusHUDActive = false;
      slyInternalState.isFetchingHUD = false;
    }
  },

  /**
   * A status is on screen: the panel's status screen, or the status on our Lyrics button
   * (its label is in the page; after the view is closed and reopened it is not, and the
   * restore loop shows it again), or the toast.
   */
  isShowing(): boolean {
    return !!document.getElementById('sly-status-hud') ||
      (!!getLyricsStatus() && (!!document.getElementById(LYRICS_STATUS_ID) || toastIsStatus));
  },

  /** Title, artist and artwork for the status (metadata first, then the bridge, then the page). */
  _describeTrack(metadata: Record<string, any> | null): { title: string; artist: string; artUrl: string } {
    const track = window.spotifyState?.track as Record<string, any> | null;
    const title = (metadata?.title as string) || (track?.name as string) || 'this song';
    const artist = (metadata?.artist as string) || (track?.artists?.[0]?.name) || 'unknown artist';
    let domArtUrl = '';
    try {
      const img = (document.querySelector(`${NOW_PLAYING_WIDGET.split(', ').map(s => `${s} img`).join(', ')}`)) as HTMLImageElement | null;
      if (img && img.src) domArtUrl = img.src;
      // Fallback: the cover art in the sidebar (Now Playing View)
      if (!domArtUrl) {
        const sideImg = (document.querySelector('aside[aria-label="Now playing view"] img[data-testid="cover-art-image"]') ||
                         document.querySelector('[data-testid="cover-art-image"]') ||
                         document.querySelector('.NowPlayingView img')) as HTMLImageElement | null;
        if (sideImg && sideImg.src) domArtUrl = sideImg.src;
      }
    } catch (e) {}
    const artUrl = (metadata?.albumArtUrl as string) || domArtUrl || track?.metadata?.image_large_url || track?.images?.[0]?.url || '';
    return { title, artist, artUrl };
  },

  /**
   * The status on our Lyrics button in Spotify's media switch (lyricsChip.ts), or in the
   * toast when that switch is not there. Nothing is drawn over Spotify's content.
   */
  _showOnLyricsButton(message: string, subtext: string, isError: boolean, metadata: Record<string, any> | null,
    title: string, artist: string, artUrl: string): void {
    // A status screen or an empty root of ours left in Spotify's view goes (never a layer over it).
    document.getElementById('sly-status-hud')?.remove();
    const root = document.getElementById('lyrics-root-sync');
    if (root && !root.querySelector('[data-testid="lyrics-line"]')) {
      root.remove();
      if (slyInternalState.customRoot === root) slyInternalState.customRoot = null;
      // Spotify's artwork and cards, hidden for lyrics placed in its slot, come back.
      slyRestoreOverlayContent();
      slyUntagLayoutHost('sly-active');
    }
    slyUntagLayoutHost('sly-hud-active');

    const uri = String(metadata?.uri || window.spotifyState?.track?.uri || '');
    const kind: LyricsStatus['kind'] = isError ? 'notFound' : metadata?.noticeFade === true ? 'info' : 'searching';
    const status: LyricsStatus = kind === 'notFound'
      ? {
          kind, uri, label: 'No lyrics found',
          message: 'No lyrics found for this song',
          subtext: 'Spotify Karaoke looked on YouTube Music and LRCLIB. You can add them to LRCLIB, the open lyrics database, for everyone.',
          actions: [
            { label: 'Add lyrics', href: this._lrclibUrl(title, artist, metadata), primary: true },
            { label: 'Retry', run: () => window.slyTriggerLyricsFetch?.(title, artist, artUrl, uri, true, metadata?.album, metadata?.duration) },
          ],
        }
      : kind === 'info'
        ? { kind, uri, label: 'Lyrics found', message: message.replace('[Title]', title).replace('[Artist]', artist), subtext, actions: [] }
        : { kind, uri, label: 'Finding lyrics…', message: `Finding lyrics for ${title}`, subtext: 'Searching YouTube Music and LRCLIB.', actions: [] };

    const changed = setLyricsStatus(status);
    const onButton = syncLyricsChip();
    if (onButton) {
      if (toastIsStatus) { hideToast(); toastIsStatus = false; }
    } else if (changed || !toastIsStatus) {
      // No media switch to carry it: a toast, short-lived once there is nothing left to wait for.
      showToast(kind === 'searching' ? 'Finding lyrics…' : status.message, kind === 'searching' ? 0 : STATUS_TOAST_MS);
      toastIsStatus = true;
    }

    slyInternalState.statusHUDActive = true;
    slyInternalState.isFetchingHUD = !isError;
    document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: isError ? 'FAILED' : 'FETCHING' } }));
    if (changed) console.log(`[StatusEngine] 📝 ${status.label} (on the Lyrics button${onButton ? '' : ': not available, toast'}) for: "${title}"`);
  },

  /** Takes a status off our Lyrics button and out of the toast. */
  _dropButtonStatus(): void {
    if (!getLyricsStatus() && !toastIsStatus) return;
    setLyricsStatus(null);
    syncLyricsChip();
    if (toastIsStatus) { hideToast(); toastIsStatus = false; }
  },

  _lrclibUrl(title: string, artist: string, metadata: any): string {
    const lrcLibUrl = new URL('https://lrclibup.boidu.dev/');
    lrcLibUrl.searchParams.set('title', title);
    lrcLibUrl.searchParams.set('artist', artist);
    if (metadata?.album) lrcLibUrl.searchParams.set('album', metadata.album);
    if (metadata?.duration) lrcLibUrl.searchParams.set('duration', metadata.duration.toString());
    return lrcLibUrl.toString();
  },

  _buildErrorCta(title: string, artist: string, metadata: any) {
    const lrcLibUrl = new URL('https://lrclibup.boidu.dev/');
    lrcLibUrl.searchParams.set('title', title);
    lrcLibUrl.searchParams.set('artist', artist);
    if (metadata?.album) lrcLibUrl.searchParams.set('album', metadata.album);
    
    // Duration Logic: Ensure we have a valid number
    if (metadata?.duration) {
      lrcLibUrl.searchParams.set('duration', metadata.duration.toString());
    }
    
    // Encore prefix of the running build (e.g. "e-10860-"), read from a live [data-encore-id] element.
    const ep = slyGetEncorePrefix();
    return `
      <div class="sly-hud-cta-wrapper" style="display: flex; gap: 12px; margin-top: 16px; justify-content: flex-start; flex-wrap: wrap;">
        <a id="sly-hud-lrc-btn" href="${lrcLibUrl.toString()}" target="_blank" class="encore-text-body-medium-bold ${window.SPOTIFY_CLASSES?.btnPrimary || `${ep}legacy-button ${ep}legacy-button-primary`}">
          <span class="${ep}overflow-wrap-anywhere ${window.SPOTIFY_CLASSES?.btnPrimaryInner || `${ep}button-primary__inner`} encore-inverted-light-set ${ep}legacy-button--medium">Add lyrics to LRCLIB</span>
        </a>
        <a id="sly-hud-retry-btn" href="#" class="encore-text-body-medium-bold ${window.SPOTIFY_CLASSES?.btnSecondary || `${ep}legacy-button ${ep}legacy-button-secondary`}" style="cursor: pointer; transition: transform 0.2s ease; text-decoration: none;">
          <span class="${ep}overflow-wrap-anywhere ${window.SPOTIFY_CLASSES?.btnSecondaryInner || `${ep}button-secondary__inner`} ${ep}legacy-button--medium">Retry Fetch</span>
        </a>
      </div>
    `;
  },

  _attachErrorListeners(hud: HTMLElement, title: string, artist: string, artUrl: string, uri: string, metadata: any) {
    const lrcBtn = hud.querySelector('#sly-hud-lrc-btn');
    if (lrcBtn) {
      lrcBtn.addEventListener('click', () => {
        console.log('[StatusEngine] 📊 LRCLIB contribution metadata:', {
          title,
          artist,
          album: metadata?.album,
          duration: metadata?.duration,
          uri,
          url: lrcBtn.getAttribute('href')
        });
      });
    }

    const retryBtn = hud.querySelector('#sly-hud-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[StatusEngine] 🔄 User triggered manual retry...');
        if (window.slyTriggerLyricsFetch) {
          window.slyTriggerLyricsFetch(title, artist, artUrl, uri, true, metadata?.album, metadata?.duration);
        }
      });
    }
  }
};
