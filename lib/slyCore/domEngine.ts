// Port of: lyric-test/modules/core/dom-engine.js
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

  const isEmpty = !text.trim() || text === '♪';
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
  root.innerHTML = '';
  return root;
};

/**
 * Calculates the perceived luminance of a CSS color string.
 */
function perceivedLuminance(cssColor: string): number {
  const tmp = document.createElement('div');
  tmp.style.color = cssColor;
  document.body.appendChild(tmp);
  const rgb = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const match = rgb.match(/\d+/g);
  if (!match) return 0;
  const [r, g, b] = match.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Mirrors the native Spotify theme and applies fallback upgrades.
 */
window.slyMirrorNativeTheme = function (root: HTMLElement, lyricsObj: Record<string, unknown>, nativeReference: HTMLElement | null): void {
  if (nativeReference && (nativeReference as HTMLElement).style.cssText) {
    root.style.cssText = (nativeReference as HTMLElement).style.cssText;
  }

  // Upgrade fallback theme colors if they are missing or too dark
  const inactive = root.style.getPropertyValue('--lyrics-color-inactive')?.trim();
  if (!inactive || inactive === '#000000' || inactive.includes('rgba(0,0,0,1)') || inactive === 'rgb(0, 0, 0)') {
    root.style.setProperty('--lyrics-color-inactive', 'rgba(255, 255, 255, 0.7)');
    root.style.setProperty('--lyrics-color-passed', 'rgba(255, 255, 255, 1)');
    root.style.setProperty('--lyrics-color-active', '#ffffff');
  }

  const bg = root.style.getPropertyValue('--lyrics-color-background')?.trim();
  const isBgTooBright = bg && perceivedLuminance(bg) > 0.25;
  const isBgTooDark = bg === '#333333' || bg.includes('rgba(51,51,51,1)') || bg === 'rgb(51, 51, 51)';
  
  if (!bg || isBgTooBright || isBgTooDark) {
    const rawExtracted = (lyricsObj.extractedColor as string) || '#121212';
    const safeBg = perceivedLuminance(rawExtracted) > 0.25 ? '#121212' : rawExtracted;
    root.style.setProperty('--lyrics-color-background', safeBg);
  }

  if (nativeReference) (nativeReference as HTMLElement).style.display = 'none';
  root.style.display = '';
};

/**
 * Constructs the internal lyrics list structure (spacers, padding, lines, and attribution).
 */
window.slyBuildLyricsList = function (root: HTMLElement, lyricsObj: Record<string, unknown>): void {
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
