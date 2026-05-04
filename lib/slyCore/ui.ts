// Port of: lyric-test/modules/core/ui.js
/* modules/core/ui.js: Synchronized Lyrics UI Controller */
/* Note: findMediaRecursively, slySeekTo, and slyGetPlaybackSeconds have been moved to modules/playback-engine.js */

declare global {
  interface Window {
    slyParseLRC: (lrc: string) => { time: number; text: string }[];
    slyResetPlayerState: (newTitle: string, uri?: string) => void;
    slyUpdateButtonState: () => void;
    slyUpdateSync: () => void;
    slyUpdateSyncButton: () => void;
    // Ensure we know about these globals
    slyGetPlaybackSeconds: () => number;
    antigravitySyncAnimFrame?: number;
  }
}

window.slyParseLRC = function (lrc: string): { time: number; text: string }[] {
  if (!lrc) return [];
  const result: { time: number; text: string }[] = [];
  const lines = lrc.split('\n');
  const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/;
  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      result.push({
        time: parseInt(match[1]) * 60 + parseFloat(match[2]),
        text: line.replace(timeRegex, '').trim() || '♪',
      });
    }
  }
  return result;
};

let lastScavengeTime = 0;

/**
 * Resets the entire extension UI and internal state.
 * Usually called when a track change or an ad is detected.
 */
window.slyResetPlayerState = function (newTitle: string, uri = 'N/A'): void {
  console.log(`[sly-ui] 🔄 TRACK SWITCH: ${newTitle} [ID: ${uri}]`);

  // 1. Internal State Cleanup
  window.slyInternalState.lastTitle = newTitle;
  window.slyInternalState.lastUri = uri;
  window.slyInternalState.lastActiveIndex = -1;
  window.slyInternalState.currentLyrics = null;
  window.slyInternalState.fetchingForTitle = '';
  window.slyInternalState.fetchingForUri = '';
  window.slyInternalState.isUserScrolling = false;
  window.slyInternalState.lastDecision = '';
  window.slyInternalState.songChangeTime = Date.now();
  window.slyInternalState.songSettlingUntil = Date.now() + 150;
  window.slyInternalState.panelOpenTime = 0;
  window.slyInternalState.forceFallback = false;
  window.slyInternalState.fetchGeneration++;
  window.slyInternalState.nativeUpgradedLines = undefined; // Note: original used null, but we type as optional string[]

  // Reset playback extrapolator so the first slyGetPlaybackSeconds() call after
  // a skip reads the live progress bar DOM instead of extrapolating from the
  // previous track's position (fixes sync mismatch on mid-song skip).
  if (window.slyResetPlaybackExtrapolator) window.slyResetPlaybackExtrapolator();

  // 2. DOM Cleanup
  if (window.slyClearStatus) window.slyClearStatus();

  // Notify Pipeline B that the custom container is about to be gone. 
  // It will "rescue" the mode pill to document.body before we destroy the root.
  document.dispatchEvent(new CustomEvent('sly:release'));

  // Nuclear Cleanup: Remove ALL custom root instances and reset the main container
  document.querySelectorAll('#lyrics-root-sync').forEach(el => el.remove());
  window.slyInternalState.customRoot = null;

  const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`) as HTMLElement | null;
  if (main) {
    main.classList.remove('sly-active');
    main.style.display = '';
    main.style.position = '';
  }

  const syncBtn = document.getElementById('sly-sync-button');
  if (syncBtn) syncBtn.remove();

  // 3. Restore Spotify Native UI visibility
  const containerClass = window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x';
  const nativeContainer = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${containerClass}:not(#lyrics-root-sync)`) as HTMLElement | null;
  if (nativeContainer) {
    nativeContainer.style.display = '';
    nativeContainer.style.opacity = '';
    nativeContainer.style.pointerEvents = '';
  }

  // Restore native error messages/providers
  document.querySelectorAll(`.${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'}`).forEach(n => {
    (n as HTMLElement).style.display = '';
    (n as HTMLElement).style.opacity = '';
    (n as HTMLElement).style.pointerEvents = '';
  });

  // 4. Maintenance: Periodic Class Scavenge
  const now = Date.now();
  if (now - lastScavengeTime > 10000) {
    if (typeof window.slyScavengeClasses === 'function') {
      window.slyScavengeClasses();
    }
    lastScavengeTime = now;
  }
};

window.slyUpdateButtonState = function (): void {
  // Note: Visual state is now handled by the Bridge's Unbreakable Shield pulse.
};

/**
 * Independent RAF loop that positions and shows/hides the floating Sync button.
 * Runs regardless of whether slyUpdateSync has yielded to Pipeline B — decoupled
 * so synced tracks using Pipeline B's renderer still get a functional Sync button.
 * Self-terminating: stops when the button element is removed from the DOM.
 */
window.slyUpdateSyncButton = function (): void {
  const syncBtn = document.getElementById('sly-sync-button');
  if (!syncBtn) return; // button removed (song change / reset) — loop terminates

  // Self-Destruct Guard: If the lyrics panel was closed (either by our cleanup or
  // by React unmounting the full-page route), this button is an orphan. Remove it.
  const lyricsRoot = (document.getElementById('lyrics-root-sync') as HTMLElement | null)
    ?? (window.slyInternalState.customRoot as HTMLElement | null);
  if (!lyricsRoot) {
    syncBtn.remove();
    return;
  }

  const currentLyrics = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
  const activeIndex = window.slyInternalState.lastActiveIndex;
  const domElements = currentLyrics?.domElements as HTMLElement[] | undefined;

  if (domElements?.[activeIndex]) {
    const activeEl = domElements[activeIndex];
    const elRect = activeEl.getBoundingClientRect();

    const viewportHeight = window.innerHeight;
    const topSafe = viewportHeight * 0.2;
    const bottomSafe = viewportHeight * 0.8;
    const isInView = (elRect.top >= topSafe) && (elRect.bottom <= bottomSafe);

    // Use lyricsRoot calculated at the top for viewport rect math.
    const viewportRect =
      lyricsRoot?.closest('[data-overlayscrollbars-viewport]')?.getBoundingClientRect()
      ?? document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`)?.getBoundingClientRect()
      ?? (lyricsRoot ?? activeEl).getBoundingClientRect();

    const screenBottom = window.innerHeight;
    const visibleBottom = Math.min(screenBottom, viewportRect.bottom);

    syncBtn.style.left = `${viewportRect.left + viewportRect.width / 2}px`;
    syncBtn.style.bottom = `${screenBottom - visibleBottom + 16}px`;

    if (window.slyInternalState.isUserScrolling && !isInView) {
      syncBtn.classList.add('visible');
    } else {
      syncBtn.classList.remove('visible');
    }
  }

  requestAnimationFrame(window.slyUpdateSyncButton);
};

window.slyUpdateSync = function (): void {
  // Yield to Pipeline B's syncedLyricsRenderer when it's active.
  // Without this, both RAF loops would fight over className on the same elements.
  // This loop self-terminates (no RAF rescheduled) — zero ongoing cost.
  if (window.slyInternalState.slySyncedRendererActive) return;

  const currentLyrics = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
  if (!currentLyrics || !currentLyrics.isSynced || !window.slyInternalState.customRoot) return;

  const isPanelOpen = document.querySelector('[data-testid="lyrics-button"]')?.getAttribute('data-active') === 'true';
  if (document.visibilityState !== 'visible' || !isPanelOpen || window.slyInternalState.customRoot.style.display === 'none') {
    window.slyInternalState.syncAnimFrame = requestAnimationFrame(window.slyUpdateSync);
    return;
  }

  const listObj = window.slyInternalState.customRoot.querySelector(`.${window.SPOTIFY_CLASSES.lyricsList}`);
  const wrapperObj = window.slyInternalState.customRoot.querySelector(`.${window.SPOTIFY_CLASSES.wrapper}`);

  if (!listObj || !wrapperObj) {
    window.slyInternalState.syncAnimFrame = requestAnimationFrame(window.slyUpdateSync);
    return;
  }

  const t = window.slyGetPlaybackSeconds();
  let activeIndex = 0;
  const lines = currentLyrics.lines as { time: number; text: string }[];
  for (let i = 0; i < lines.length; i++) {
    if (t >= lines[i].time) activeIndex = i;
    else break;
  }

  const previousIndex = window.slyInternalState.lastActiveIndex;
  const domElements = currentLyrics.domElements as HTMLElement[];
  if (activeIndex !== window.slyInternalState.lastActiveIndex) {
    domElements.forEach((el, i) => {
      if (i === activeIndex) {
        el.className = `${window.SPOTIFY_CLASSES.lineBase} ${window.SPOTIFY_CLASSES.activeLine}`;
      } else if (i < activeIndex) {
        el.className = `${window.SPOTIFY_CLASSES.lineBase} ${window.SPOTIFY_CLASSES.passedLine}`;
      } else {
        el.className = `${window.SPOTIFY_CLASSES.lineBase} ${window.SPOTIFY_CLASSES.futureLine}`;
      }
      el.style.color = '';
      el.style.opacity = '';
    });
    window.slyInternalState.lastActiveIndex = activeIndex;

    if (domElements[activeIndex]) {
      const activeEl = domElements[activeIndex];
      if (!window.slyInternalState.isUserScrolling) {
        activeEl.scrollIntoView({
          behavior: previousIndex === -1 ? 'instant' : 'smooth',
          block: 'center',
        });
      }
    }
  }

  // Sync button position + visibility is handled by slyUpdateSyncButton (its own RAF loop).


  window.slyInternalState.syncAnimFrame = requestAnimationFrame(window.slyUpdateSync);
  window.antigravitySyncAnimFrame = window.slyInternalState.syncAnimFrame;
};
