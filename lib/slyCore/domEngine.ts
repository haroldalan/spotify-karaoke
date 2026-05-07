// @ts-nocheck
// Port of: lyric-test/modules/core/dom-engine.js
export {};
/* modules/dom-engine.js: sly DOM Construction & Theme Engine */

/* Note: SPOTIFY_CLASSES and slyScavengeClasses have been moved to scavenger.ts */

declare global {
  interface Window {
    slyCreateDOMLine: (text: string, index: number, isSynced: boolean, onClick?: (() => void) | null) => HTMLDivElement;
    slyInjectCoreStyles: () => void;
    slyPrepareContainer: () => HTMLElement | null;
    slyMirrorNativeTheme: (root: HTMLElement, lyricsObj: Record<string, unknown>, nativeReference: HTMLElement | null) => void;
    slyBuildLyricsList: (root: HTMLElement, lyricsObj: Record<string, unknown>) => void;
    slySetupSyncButton: (lyricsObj: Record<string, unknown>) => void;
    // Forward refs from ui.js (not yet ported — guarded in source)
    slyParseLRC?: (lrc: string) => { time: number; text: string }[];
    slyUpdateSync?: () => void;
    slyClearStatus?: () => void;
  }
}

/**
 * Creates a single line of lyrics (synced or unsynced).
 */
window.slyCreateDOMLine = function (text: string, _index: number, isSynced: boolean, onClick?: (() => void) | null): HTMLDivElement {
  const div = document.createElement('div');
  div.dir = 'auto';
  div.dataset.testid = 'lyrics-line';

  const isEmpty = !text.trim();
  if (isSynced) {
    div.className = `${window.SPOTIFY_CLASSES.lineBase} ${window.SPOTIFY_CLASSES.futureLine} ${isEmpty ? window.SPOTIFY_CLASSES.paddingLineHelper : ''}`.trim();
  } else {
    div.className = `${window.SPOTIFY_CLASSES.lineBase} ${window.SPOTIFY_CLASSES.unsynced} ${isEmpty ? window.SPOTIFY_CLASSES.paddingLineHelper : ''}`.trim();
  }

  const inner = document.createElement('div');
  inner.className = window.SPOTIFY_CLASSES.textInner;
  inner.textContent = text;
  div.appendChild(inner);

  if (isSynced && onClick) {
    div.addEventListener('click', onClick);
  }
  return div;
};

/**
 * Injects core CSS for the sync button and custom transitions.
 */
window.slyInjectCoreStyles = function (): void {
  if (document.getElementById('sly-core-styles')) return;
  const style = document.createElement('style');
  style.id = 'sly-core-styles';
  style.textContent = window.slyGetCoreStyles();
  document.head.appendChild(style);
};

/**
 * Prepares the main #lyrics-root-sync container.
 */
window.slyPrepareContainer = function (): HTMLElement | null {
  const rootParent = document.querySelector(`main.${window.SPOTIFY_CLASSES.mainContainer}`) as HTMLElement | null;
  if (!rootParent) return null;

  let root = document.getElementById('lyrics-root-sync') as HTMLElement | null;
  if (!root) {
    root = document.createElement('div');
    root.className = window.SPOTIFY_CLASSES.container;
    root.id = 'lyrics-root-sync';
    root.style.minHeight = '100%';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    rootParent.appendChild(root);
  }
  rootParent.classList.add('sly-active');
  return root;
};

/**
 * Calculates the perceived luminance of a CSS color string.
 */
window.slyPerceivedLuminance = function (cssColor: string): number {
  const tmp = document.createElement('div');
  tmp.style.color = cssColor;
  document.body.appendChild(tmp);
  try {
    const rgb = getComputedStyle(tmp).color;
    const match = rgb.match(/\d+/g);
    if (!match) return 0;
    const [r, g, b] = match.map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  } finally {
    // BUG-29 Fix: Always remove the temporary element even if getComputedStyle throws.
    document.body.removeChild(tmp);
  }
};

/**
 * Mirrors the native Spotify theme and applies fallback upgrades.
 */
window.slyMirrorNativeTheme = function (root: HTMLElement, lyricsObj: Record<string, unknown>, nativeReference: HTMLElement | null): void {
  const trackId = (window as any).spotifyState?.track?.uri?.split(':').pop();
  const registryEntry = trackId ? window.slyPreFetchRegistry.getState(trackId) : null;

  // 1. CAPTURE & APPLY: If we have a native reference, steal its truth and learn it.
  // NEW: Skip copying from nativeReference if this track has MISSING lyrics.
  // The native container is an error DOM with grey placeholder colours, not real theme colours.
  const isMissingTrack = registryEntry?.state === 'MISSING' || registryEntry?.nativeStatus === 'MISSING';
  const hasNativeError = nativeReference?.querySelector(`.${window.SPOTIFY_CLASSES?.errorContainer}`);

  let didSteal = false;
  if (nativeReference && (nativeReference as HTMLElement).style.cssText && !isMissingTrack && !hasNativeError) {
    // Only mirror CSS Variables (colors). NEVER mirror layout styles like
    // 'display' or 'position' as they will reset the scrollbar if the native
    // container is hidden.
    const vars = (nativeReference as HTMLElement).style.cssText
      .split(';')
      .filter(s => s.trim().startsWith('--'))
      .join(';');
    root.style.cssText = vars;
    didSteal = true;
    
    // Save the "Official" colors to the registry for the next time we skip back to this song
    if (registryEntry) {
      registryEntry.savedTheme = {
        background: nativeReference.style.getPropertyValue('--lyrics-color-background'),
        inactive: nativeReference.style.getPropertyValue('--lyrics-color-inactive'),
        active: nativeReference.style.getPropertyValue('--lyrics-color-active'),
        passed: nativeReference.style.getPropertyValue('--lyrics-color-passed')
      };
    }
  } 
  // 2. RECALL: If native is missing but we've played this song before, use the learned theme.
  else if (registryEntry?.savedTheme) {
    const t = registryEntry.savedTheme as any;
    root.style.setProperty('--lyrics-color-background', t.background);
    root.style.setProperty('--lyrics-color-inactive', t.inactive);
    root.style.setProperty('--lyrics-color-active', t.active);
    root.style.setProperty('--lyrics-color-passed', t.passed);
  }

  // 3. FALLBACK: Standard upgrade logic for missing or invalid colors
  const inactive = root.style.getPropertyValue('--lyrics-color-inactive')?.trim();
  if (!inactive || inactive === '#000000' || inactive.includes('rgba(0,0,0,1)') || inactive === 'rgb(0, 0, 0)') {
    root.style.setProperty('--lyrics-color-inactive', 'rgba(255, 255, 255, 0.7)');
    root.style.setProperty('--lyrics-color-passed', 'rgba(255, 255, 255, 1)');
    root.style.setProperty('--lyrics-color-active', '#ffffff');
  }

  const bg = root.style.getPropertyValue('--lyrics-color-background')?.trim();
  
  // SEAMLESS HIJACK GUARD: If we successfully stole from a legitimate native source,
  // we TRUST its choice and skip the luminance fallback to prevent flickering.
  if (!didSteal) {
    const isBgTooBright = bg && window.slyPerceivedLuminance(bg) > 0.25;
    // BUG-30 Fix: Replace fragile string checks for '#333333' with a luminance threshold.
    // This correctly identifies "dark but not pitch black" backgrounds across browsers.
    // Error grey (#333333) is exactly 0.20 luminance. Threshold 0.22 catches it.
    const isBgTooDark = bg && window.slyPerceivedLuminance(bg) < 0.22;
    
    if (!bg || isBgTooBright || isBgTooDark) {
      const rawExtracted = (lyricsObj.extractedColor as string) || '#121212';
      const safeBg = window.slyPerceivedLuminance(rawExtracted) > 0.25 ? '#121212' : rawExtracted;
      root.style.setProperty('--lyrics-color-background', safeBg);
    }
  }

  if (nativeReference) (nativeReference as HTMLElement).style.display = 'none';
  root.style.display = '';
};

/**
 * Constructs the internal lyrics list structure (spacers, padding, lines, and attribution).
 */
window.slyBuildLyricsList = function (root: HTMLElement, lyricsObj: Record<string, unknown>): void {
  root.innerHTML = '';
  const isSynced = lyricsObj.isSynced as boolean;
  // window.slyParseLRC comes from ui.js (not yet ported) — guarded with || []
  const lines = isSynced ? (window.slyParseLRC?.(lyricsObj.syncedLyrics as string) || []) : [];
  const texts = isSynced ? lines.map((l: { time: number; text: string }) => l.text) : ((lyricsObj.plainLyrics as string) || '').split('\n');
  lyricsObj.lines = isSynced ? lines : texts.map((t: string) => ({ time: 0, text: t }));

  const topSpacer = document.createElement('div');
  topSpacer.className = window.SPOTIFY_CLASSES.topSpacer;
  root.appendChild(topSpacer);

  const wrapper = document.createElement('div');
  wrapper.className = window.SPOTIFY_CLASSES.wrapper;

  const list = document.createElement('div');
  list.className = window.SPOTIFY_CLASSES.lyricsList;

  // Synced lyrics have an inner div, Unsynced lyrics append directly to list
  const targetWrapper = isSynced ? document.createElement('div') : list;
  if (isSynced) {
    list.appendChild(targetWrapper);
  }

  if (!isSynced) {
    const header = document.createElement('p');
    header.className = `e-10451-text encore-text-body-small ${window.SPOTIFY_CLASSES.unsyncedMessage}`;
    header.setAttribute('data-encore-id', 'text');
    header.dir = 'auto';
    header.textContent = "These lyrics aren't synced to the song yet.";
    targetWrapper.appendChild(header);
  }

  // Padding & Lines
  for (let i = 0; i < 2; i++) {
    const pad = window.slyCreateDOMLine('', -1, isSynced);
    if (isSynced) {
      pad.className = `${window.SPOTIFY_CLASSES.lineBase} ${window.SPOTIFY_CLASSES.passedLine} ${window.SPOTIFY_CLASSES.paddingLineHelper}`;
    }
    targetWrapper.appendChild(pad);
  }

  const domElements: HTMLElement[] = [];
  texts.forEach((text: string, i: number) => {
    // DO NOT skip empty lines! LRCLIB provides empty lines with valid sync indices.
    // Skipping them breaks the index mapping.
    const el = window.slyCreateDOMLine(text, i, isSynced, isSynced ? () => {
      const lyricsLines = lyricsObj.lines as { time: number; text: string }[];
      const time = lyricsLines[i]?.time;
      if (typeof time === 'number' && window.slySeekTo) window.slySeekTo(time);
    } : null);
    targetWrapper.appendChild(el);
    domElements.push(el);
  });

  if (isSynced) {
    const pad = window.slyCreateDOMLine('', -1, true);
    targetWrapper.appendChild(pad);
  }

  lyricsObj.domElements = domElements;

  // Attribution
  const attr = document.createElement('div');
  attr.className = window.SPOTIFY_CLASSES.attribution;
  attr.innerHTML = `<p class="encore-text-body-small" data-encore-id="text" dir="auto">Lyrics provided by Spotify Karaoke</p>`;
  targetWrapper.appendChild(attr);

  wrapper.appendChild(list);
  root.appendChild(wrapper);

  const foot = document.createElement('div');
  foot.className = window.SPOTIFY_CLASSES.footerGrid;
  foot.innerHTML = `<div class="${window.SPOTIFY_CLASSES.footerInner1}"></div><div class="${window.SPOTIFY_CLASSES.footerInner2}"></div>`;
  root.appendChild(foot);

  // BUG-27 Fix: Ensure the sync loop starts when a new list is constructed.
  if (isSynced && typeof window.slyUpdateSync === 'function') {
    requestAnimationFrame(window.slyUpdateSync);
  }
};

/**
 * Creates and sets up the floating "Sync" button for synced tracks.
 */
window.slySetupSyncButton = function (lyricsObj: Record<string, unknown>): void {
  if (!lyricsObj.isSynced) return;

  let syncBtn = document.getElementById('sly-sync-button') as HTMLButtonElement | null;
  if (!syncBtn) {
    syncBtn = document.createElement('button');
    syncBtn.id = 'sly-sync-button';
    syncBtn.className = `encore-text-body-medium-bold ${window.SPOTIFY_CLASSES.btnPrimary}`;
    syncBtn.innerHTML = `
            <span class="e-10451-overflow-wrap-anywhere ${window.SPOTIFY_CLASSES.btnPrimaryInner} encore-inverted-light-set e-10451-legacy-button--medium e-10451-button--leading">
                <span aria-hidden="true" class="e-10451-button__icon-wrapper">
                    <svg data-encore-id="icon" role="img" aria-hidden="true" class="e-10451-icon" viewBox="0 0 24 24" style="--encore-icon-height: var(--encore-graphic-size-decorative-base); --encore-icon-width: var(--encore-graphic-size-decorative-base);">
                        <path d="M12 0a1 1 0 0 1 1 1v22a1 1 0 1 1-2 0V1a1 1 0 0 1 1-1m5 4a1 1 0 0 1 1 1v14a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1M1 9v6a1 1 0 1 0 2 0V9a1 1 0 1 0-2 0m20 6V9a1 1 0 1 1 2 0v6a1 1 0 1 1-2 0M8 5a1 1 0 0 0-2 0v14a1 1 0 1 0 2 0z"></path>
                    </svg>
                </span>
                Sync
            </span>
        `;
    syncBtn.addEventListener('click', () => {
      window.slyInternalState.isUserScrolling = false;
      const activeIndex = window.slyInternalState.lastActiveIndex;
      const currentLyrics = window.slyInternalState.currentLyrics as Record<string, unknown> | null;
      if ((currentLyrics?.domElements as HTMLElement[])?.[activeIndex]) {
        ((currentLyrics!.domElements as HTMLElement[])[activeIndex]).scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    document.body.appendChild(syncBtn);
    requestAnimationFrame(window.slyUpdateSyncButton);
  }
};
