// Port of: lyric-test/modules/core/ui.js
/* modules/core/ui.js: Synchronized Lyrics UI Controller */
/* Note: findMediaRecursively, slySeekTo, and slyGetPlaybackSeconds have been moved to modules/playback-engine.js */

declare global {
  interface Window {
    slyParseLRC: (lrc: string) => { time: number; text: string }[];
    slyResetPlayerState: (newTitle: string, uri?: string) => void;
    slyUpdateButtonState: () => void;
    slyUpdateSync: () => void;
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
  window.slyInternalState.lastActiveIndex = -1;
  window.slyInternalState.currentLyrics = null;
  window.slyInternalState.fetchingForTitle = '';
  window.slyInternalState.isUserScrolling = false;
  window.slyInternalState.lastDecision = '';
  window.slyInternalState.panelOpenTime = 0;
  window.slyInternalState.forceFallback = false;
  window.slyInternalState.fetchGeneration++;
  window.slyInternalState.nativeUpgradedLines = undefined; // Note: original used null, but we type as optional string[]

  // 2. DOM Cleanup
  if (window.slyClearStatus) window.slyClearStatus();

  // Nuclear Cleanup: Remove ALL custom root instances and reset the main container
  document.querySelectorAll('#lyrics-root-sync').forEach(el => el.remove());
  window.slyInternalState.customRoot = null;

  const main = document.querySelector('main.J6wP3V0xzh0Hj_MS') as HTMLElement | null;
  if (main) {
    main.classList.remove('sly-active');
    main.style.display = '';
    main.style.position = '';
  }

  const syncBtn = document.getElementById('sly-sync-button');
  if (syncBtn) syncBtn.remove();

  // 3. Restore Spotify Native UI visibility
  const containerClass = window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x';
  const nativeContainer = document.querySelector(`main.J6wP3V0xzh0Hj_MS .${containerClass}:not(#lyrics-root-sync)`) as HTMLElement | null;
  if (nativeContainer) {
    nativeContainer.style.display = '';
    nativeContainer.style.opacity = '';
    nativeContainer.style.pointerEvents = '';
  }

  // Restore native error messages/providers
  document.querySelectorAll('.hfTlyhd7WCIk9xmP, .bRNotDNzO2suN6vM').forEach(n => {
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

window.slyUpdateSync = function (): void {
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

  const syncBtn = document.getElementById('sly-sync-button');
  if (syncBtn && domElements[activeIndex]) {
    const activeEl = domElements[activeIndex];
    const elRect = activeEl.getBoundingClientRect();

    const viewportHeight = window.innerHeight;
    const topSafe = viewportHeight * 0.2;
    const bottomSafe = viewportHeight * 0.8;
    const isInView = (elRect.top >= topSafe) && (elRect.bottom <= bottomSafe);

    const viewportRect = window.slyInternalState.customRoot.closest('[data-overlayscrollbars-viewport]')?.getBoundingClientRect()
      || document.querySelector('main.J6wP3V0xzh0Hj_MS')?.getBoundingClientRect()
      || window.slyInternalState.customRoot.getBoundingClientRect();

    const screenBottom = window.innerHeight;
    const visibleBottom = Math.min(screenBottom, viewportRect.bottom);

    syncBtn.style.left = `${viewportRect.left + viewportRect.width / 2}px`;
    syncBtn.style.bottom = `${screenBottom - visibleBottom + 16}px`;

    if (window.slyInternalState.isUserScrolling) {
      if (isInView) {
        window.slyInternalState.isUserScrolling = false;
        syncBtn.classList.remove('visible');
      } else {
        syncBtn.classList.add('visible');
      }
    } else {
      syncBtn.classList.remove('visible');
    }
  }

  window.slyInternalState.syncAnimFrame = requestAnimationFrame(window.slyUpdateSync);
  window.antigravitySyncAnimFrame = window.slyInternalState.syncAnimFrame;
};
