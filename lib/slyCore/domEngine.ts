// @ts-nocheck
// Port of: lyric-test/modules/core/dom-engine.js
import { getThemedPanelContainer, isLyricsButtonActive, isPreviewLine } from '../dom/domQueries';
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
    slyGetLayoutHost: () => HTMLElement | null;
    slyTagLayoutHost: (...classNames: string[]) => HTMLElement | null;
    slyUntagLayoutHost: (...classNames: string[]) => void;
    slyGetNativePanel: () => HTMLElement | null;
    slyGetEncorePrefix: () => string;
    // Forward refs from ui.js (not yet ported — guarded in source)
    slyParseLRC?: (lrc: string) => { time: number; text: string }[];
    slyUpdateSync?: () => void;
  }
}

const SLY_LAYOUT_CLASSES = ['sly-active', 'sly-hud-active'];

/** The element we last put a layout class on, so cleanup can untag that exact node
 *  even if React has since unmounted the themed container. */
let slyTaggedLayoutHost: HTMLElement | null = null;

/**
 * K11: the element that carries the "sly-active" / "sly-hud-active" layout classes.
 * 2026 UI: the themed panel container's parent (the overlay slot that also holds
 * #lyrics-root-sync). Legacy UI: main.<mainContainer>, only when no themed container exists.
 */
export function slyGetLayoutHost(): HTMLElement | null {
  const themed = getThemedPanelContainer() as HTMLElement | null;
  if (themed?.parentElement) return themed.parentElement;
  return document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`) as HTMLElement | null;
}

/** Adds layout classes to the K11 element and remembers it for cleanup. */
export function slyTagLayoutHost(...classNames: string[]): HTMLElement | null {
  const host = slyGetLayoutHost();
  if (!host) return null;
  if (slyTaggedLayoutHost && slyTaggedLayoutHost !== host) {
    // The slot moved (panel re-mounted): our classes move with it, so only one node carries them.
    const carry = SLY_LAYOUT_CLASSES.filter(c => slyTaggedLayoutHost!.classList.contains(c));
    slyTaggedLayoutHost.classList.remove(...SLY_LAYOUT_CLASSES);
    if (carry.length) host.classList.add(...carry);
  }
  host.classList.add(...classNames);
  slyTaggedLayoutHost = host;
  return host;
}

/** Removes layout classes (default: all of ours) from the K11 element and from the node we tagged. */
export function slyUntagLayoutHost(...classNames: string[]): void {
  const names = classNames.length ? classNames : SLY_LAYOUT_CLASSES;
  const current = slyGetLayoutHost();
  current?.classList.remove(...names);
  if (slyTaggedLayoutHost) {
    slyTaggedLayoutHost.classList.remove(...names);
    if (!SLY_LAYOUT_CLASSES.some(c => slyTaggedLayoutHost!.classList.contains(c))) slyTaggedLayoutHost = null;
  }
}

/** The native lyrics container we hide while our root is up: themed panel first, legacy selector as fallback. */
export function slyGetNativePanel(): HTMLElement | null {
  return ((getThemedPanelContainer() as HTMLElement | null) ??
    document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync)`)) as HTMLElement | null;
}

/**
 * Encore class prefix (e.g. "e-101040-") of the running Spotify build, read from a live
 * [data-encore-id] element. Falls back to the scavenged button classes, then e-101040- (2026-11).
 */
export function slyGetEncorePrefix(): string {
  const prefixRe = /(?:^|\s)(e-\d+-)/;
  for (const el of Array.from(document.querySelectorAll('[data-encore-id]'))) {
    // getAttribute: className is an SVGAnimatedString on <svg data-encore-id="icon">.
    const m = (el.getAttribute('class') || '').match(prefixRe);
    if (m) return m[1];
  }
  const scavenged = `${window.SPOTIFY_CLASSES?.btnPrimaryInner || ''} ${window.SPOTIFY_CLASSES?.btnPrimary || ''}`.match(prefixRe);
  return scavenged?.[1] || 'e-101040-';
}

window.slyGetLayoutHost = slyGetLayoutHost;
window.slyTagLayoutHost = slyTagLayoutHost;
window.slyUntagLayoutHost = slyUntagLayoutHost;
window.slyGetNativePanel = slyGetNativePanel;
window.slyGetEncorePrefix = slyGetEncorePrefix;

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
  if (!document.head) {
    document.addEventListener('DOMContentLoaded', window.slyInjectCoreStyles);
    return;
  }
  const style = document.createElement('style');
  style.id = 'sly-core-styles';
  style.textContent = window.slyGetCoreStyles();
  document.head.appendChild(style);
};

/**
 * Prepares the main #lyrics-root-sync container.
 */
window.slyPrepareContainer = function (): HTMLElement | null {
  // 2026 UI (clean-DOM verified): panel lives under DIV#main > [data-testid="root"], themed
  // container carries --lyrics-color-*. Never use <main> tag or NPV aside.
  // Return null unless the lyrics panel is actually open (button active or
  // panel lines present) — otherwise HUD/takeover fires in NPV on startup.
  const btnActive = isLyricsButtonActive();
  const themed = getThemedPanelContainer() as HTMLElement | null;
  const hasPanelLines = !!Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
    .find(el => !el.closest('#lyrics-root-sync') && !isPreviewLine(el));
  if (!btnActive && !themed && !hasPanelLines) return null;
  if (!btnActive && !themed) return null;
  const rootParent = (themed?.parentElement ??
    document.querySelector('[data-testid="root"]') ??
    document.querySelector('div#main') ??
    document.querySelector(`main.${window.SPOTIFY_CLASSES.mainContainer}`)) as HTMLElement | null;
  if (!rootParent) return null;

  let root = document.getElementById('lyrics-root-sync') as HTMLElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'lyrics-root-sync';
    root.style.minHeight = '100%';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
  }
  root.className = window.SPOTIFY_CLASSES.containerClasses || window.SPOTIFY_CLASSES.container;
  // Replace the native lyrics panel in its actual slot. Appending to the
  // parent puts the custom root after Spotify's ~704px `oos...` layout spacer,
  // leaving that spacer above the injected panel even when native lyrics are hidden.
  if (themed?.parentElement === rootParent) {
    rootParent.insertBefore(root, themed);
  } else if (root.parentElement !== rootParent) {
    rootParent.appendChild(root);
  }
  // K11: layout state lives on the themed container's parent (legacy: main.<mainContainer>).
  slyTagLayoutHost('sly-active');
  // Single source of truth for slyUpdateSync / scroll tracking (was never assigned).
  if (window.slyInternalState) window.slyInternalState.customRoot = root;
  return root;
};

/**
 * Calculates the perceived luminance of a CSS color string.
 */
window.slyPerceivedLuminance = function (cssColor: string): number {
  if (!cssColor) return 0;
  
  // Fast path for rgb/rgba strings (common resolved browser format)
  const rgbMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // Hex path (#RRGGBB)
  if (cssColor.startsWith('#')) {
    const hex = cssColor.length === 4 
      ? cssColor[1] + cssColor[1] + cssColor[2] + cssColor[2] + cssColor[3] + cssColor[3]
      : cssColor.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  return 0.5; // Neutral fallback for named colors or edge cases
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
      const rawExtracted = (lyricsObj?.extractedColor as string) || '#121212';
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
window.slyBuildLyricsList = function (root: HTMLElement, lyricsObj: Record<string, unknown>, preferredMode?: string, targetLang?: string): void {
  root.innerHTML = '';
  const isSynced = lyricsObj.isSynced as boolean;
  const processedMap = lyricsObj.processed as Record<string, any> | undefined;

  // window.slyParseLRC comes from ui.js (not yet ported) — guarded with || []
  const originalLines = isSynced ? (window.slyParseLRC?.(lyricsObj.syncedLyrics as string) || []) : [];
  
  // SEAMLESS UPGRADE: If we have processed lyrics matching the user's preference,
  // use them for the INITIAL RENDER to prevent the "original-to-processed" shimmer.
  // SYNCED GUARD: Skip for synced lyrics — processed.romanized was computed from
  // plainLyrics (N lines), but the LRC has M lines (M ≠ N due to blank spacers,
  // intro timing, ♪ markers). Using N romanized items to build M LRC elements
  // causes misalignment: romanized[i] maps to LRC_line[i], not the same actual lyric.
  let texts: string[] = [];
  if (!isSynced && preferredMode && preferredMode !== 'original' && processedMap) {
    const lang = targetLang || Object.keys(processedMap)[0];
    const processed = processedMap[lang];
    if (processed) {
      texts = preferredMode === 'romanized' ? processed.romanized : processed.translated;
    }
  }

  // Fallback to original if no processed data found or original mode requested
  if (texts.length === 0) {
    texts = isSynced ? originalLines.map((l: { time: number; text: string }) => l.text) : ((lyricsObj.plainLyrics as string) || '').split('\n');
  }

  const newLines = isSynced ? originalLines : texts.map((t: string) => ({ time: 0, text: t }));
  lyricsObj.lines = newLines;

  const topSpacer = document.createElement('div');
  topSpacer.className = window.SPOTIFY_CLASSES.topSpacer;
  root.appendChild(topSpacer);

  const wrapper = document.createElement('div');
  wrapper.className = window.SPOTIFY_CLASSES.wrapperClasses || window.SPOTIFY_CLASSES.wrapper;

  const list = document.createElement('div');
  list.className = window.SPOTIFY_CLASSES.lyricsListClasses || window.SPOTIFY_CLASSES.lyricsList;

  // Synced lyrics have an inner div, Unsynced lyrics append directly to list
  const targetWrapper = isSynced ? document.createElement('div') : list;
  if (isSynced) {
    list.appendChild(targetWrapper);
  }

  if (!isSynced) {
    const header = document.createElement('p');
    header.className = `encore-text-body-small ${window.SPOTIFY_CLASSES.unsyncedMessage}`;
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
  // Only one chain may run: a live chain always parks its pending frame id in
  // syncAnimFrame, so cancel it before starting the new one.
  if (isSynced && typeof window.slyUpdateSync === 'function') {
    const st = window.slyInternalState;
    if (st?.syncAnimFrame) cancelAnimationFrame(st.syncAnimFrame);
    if (window.antigravitySyncAnimFrame && window.antigravitySyncAnimFrame !== st?.syncAnimFrame) {
      cancelAnimationFrame(window.antigravitySyncAnimFrame);
    }
    const frameId = requestAnimationFrame(window.slyUpdateSync);
    if (st) st.syncAnimFrame = frameId;
    window.antigravitySyncAnimFrame = frameId;
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
    const encorePrefix = slyGetEncorePrefix();
    const mediumButtonClass = `${encorePrefix}legacy-button--medium`;
    const uniqueClasses = (...classNames: string[]) => [...new Set(classNames.flatMap(value => value.split(/\s+/).filter(Boolean)))].join(' ');
    syncBtn.className = uniqueClasses(
      'encore-text-body-medium-bold',
      window.SPOTIFY_CLASSES.btnPrimary,
      mediumButtonClass,
    );
    syncBtn.innerHTML = `
            <span class="${uniqueClasses(window.SPOTIFY_CLASSES.btnPrimaryInner, mediumButtonClass, `${encorePrefix}button--leading`, 'encore-inverted-light-set')}">
                <span aria-hidden="true" class="${encorePrefix}button__icon-wrapper">
                    <svg data-encore-id="icon" role="img" aria-hidden="true" class="${encorePrefix}icon" viewBox="0 0 24 24" style="--encore-icon-height: var(--encore-graphic-size-decorative-base); --encore-icon-width: var(--encore-graphic-size-decorative-base);">
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
