// @ts-nocheck
// Port of: lyric-test/modules/core/dom-engine.js
import { getAppRoot, getFallbackLayoutHost, getLyricsLines, getNowPlayingOverlay, getThemedPanelContainer, isLyricsButtonActive, isLyricsOptionDisabled, isPreviewLine } from '../dom/domQueries';
import { isLyricsKitWorking } from './scavenger';
import { isLyricsSteppedAside } from './lyricsChip';
import { traceEvent } from '../testHooks';
/* modules/dom-engine.js: sly DOM Construction & Theme Engine */

/* Note: SPOTIFY_CLASSES and slyScavengeClasses have been moved to scavenger.ts */

declare global {
  interface Window {
    slyCreateDOMLine: (text: string, index: number, isSynced: boolean, onClick?: (() => void) | null) => HTMLDivElement;
    slyInjectCoreStyles: () => void;
    slyPrepareContainer: (opts?: { forLyrics?: boolean }) => HTMLElement | null;
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
  return getFallbackLayoutHost();
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
/**
 * Spotify's lyrics slot inside its expanded Now Playing view: the element that holds
 * the lyrics panel, and the artwork when the track has no lyrics. Found by the class
 * learned from a live panel, or by Spotify's stylesheet (scavenger: slotCandidates),
 * whichever is unique inside the overlay.
 */
export function slyFindOverlayLyricsSlot(): HTMLElement | null {
  lastSlotSearchBusy = false;
  const overlay = getNowPlayingOverlay();
  if (!overlay) return null;
  const names = [window.SPOTIFY_CLASSES?.slotClass, ...(window.SPOTIFY_CLASSES?.slotCandidates || [])]
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  const seen: string[] = [];
  for (const name of names) {
    const found = Array.from(overlay.getElementsByClassName(name)) as HTMLElement[];
    seen.push(`${name.slice(0, 6)}=${found.length}`);
    if (found.length === 1) {
      if (looksLikeMediaSlot(found[0])) return found[0];
      continue;
    }
    if (found.length < 2) continue;
    // Spotify is sliding from one song's view to the next: each slide has its own slot
    // (live 2026-11-08: two slots for ~0.8 s after a skip; refusing then left the lyrics
    // out for good). The song now playing is the one whose artwork the player bar shows.
    const media = found.filter(el => !el.closest('[data-sly-leaving]') && looksLikeMediaSlot(el));
    if (media.length === 1) return media[0];
    const cover = imageIdOf(document.querySelector<HTMLImageElement>('[data-testid="now-playing-bar"] [data-testid="cover-art-image"], footer [data-testid="cover-art-image"]')?.src);
    const showing = cover ? media.filter(el => Array.from(el.querySelectorAll('img')).some(img => imageIdOf(img.src) === cover)) : [];
    if (showing.length === 1) return showing[0];
    // Still two (no artwork told them apart, e.g. two songs of one album): wait for the
    // slide to end; the caller tries again then.
    if (media.length > 1) lastSlotSearchBusy = true;
  }
  traceEvent(`slotUnknown:${seen.join(',') || 'no names'}${lastSlotSearchBusy ? ':busy' : ''}`);
  return null;
}

/** The last slot search found the view mid-slide between two songs (see slyFindOverlayLyricsSlot). */
let lastSlotSearchBusy = false;

/** Spotify image id (the size code differs between the player bar and the view): the last 24 hex digits. */
function imageIdOf(src: string | null | undefined): string | null {
  const m = String(src ?? '').match(/([0-9a-f]{24})(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The slot as Spotify renders it for a track without lyrics, in any media mode: no media
 * switch inside, and a child holding the media, an image or a video (live 2026-11:
 * Artwork [background, artwork container with the image]; Artist image [background,
 * spacer, positioned image]; Canvas: a positioned video). Anything else is not filled.
 */
function looksLikeMediaSlot(slot: HTMLElement): boolean {
  if (slot.querySelector('button[role="radio"]')) return false;
  return slotMedia(slot).length > 0;
}

/** The slot's children that hold Spotify's media (not our root). */
function slotMedia(slot: HTMLElement): HTMLElement[] {
  return Array.from(slot.children).filter((c): c is HTMLElement =>
    c.id !== 'lyrics-root-sync' && !!c.querySelector('img, video'));
}

const HIDE_ATTR = 'data-sly-hide';

/** Gives Spotify's own Now Playing content back (undoes placeInOverlaySlot). */
export function slyRestoreOverlayContent(): void {
  // The previous song's slide keeps its look while Spotify slides it out (songTransition.ts).
  const leaving = (el: Element) => !!el.closest('[data-sly-leaving="ours"]');
  document.querySelectorAll(`[${HIDE_ATTR}]`).forEach(el => { if (!leaving(el)) el.removeAttribute(HIDE_ATTR); });
  document.querySelectorAll('.sly-lyrics-on').forEach(el => { if (!leaving(el)) el.classList.remove('sly-lyrics-on'); });
}

/**
 * Lyrics for a track Spotify has none for, shown the way Spotify shows its own: our
 * root takes the lyrics panel's place in Spotify's slot, before the artwork container
 * (which stays as the panel's spacer, its content hidden), and the cards below the
 * panel are collapsed, as in Spotify's lyrics view. Only attributes and one class are
 * added (CSS does the hiding while .sly-lyrics-on is set), so stepping aside or any
 * cleanup gives Spotify's content back as it was.
 */
export function slyPlaceInOverlaySlot(root: HTMLElement, slot: HTMLElement): void {
  // Re-marking from scratch: Spotify may have swapped the slot's media (Canvas, artist image).
  slyRestoreOverlayContent();
  const overlay = getNowPlayingOverlay();
  const others = Array.from(slot.children).filter(c => c !== root) as HTMLElement[];
  // Our root takes the panel's place: before the first child in the flow (the artwork
  // container, which then stays as the panel's spacer, or the artist image's spacer).
  const anchor = others.find(c => getComputedStyle(c).position !== 'absolute');
  if (anchor) {
    if (root.parentElement !== slot || root.nextElementSibling !== anchor) slot.insertBefore(root, anchor);
  } else if (root.parentElement !== slot) {
    slot.appendChild(root);
  }
  // Spotify's media (artwork, artist image, Canvas) is hidden while our lyrics show.
  slotMedia(slot).forEach(el => el.setAttribute(HIDE_ATTR, 'content'));
  // The cards below the panel (artist, credits): the next sibling of the first
  // ancestor above the slot that has one, inside the overlay's content. Song slides
  // (Spotify's carousel) are stepped over: mid-slide the slide's next sibling is the
  // other song's slide, not the cards (live 2026-11-08: that slide was collapsed and
  // the cards stayed over the lyrics).
  const isSlide = (el: Element | null): boolean => !!(el as HTMLElement | null)?.style?.transform?.includes('translateX');
  let branch: Element | null = slot.parentElement;
  while (branch && branch !== overlay && (!branch.nextElementSibling || isSlide(branch) || isSlide(branch.nextElementSibling))) {
    branch = branch.parentElement;
  }
  const below = branch && branch !== overlay ? branch.nextElementSibling : null;
  if (below && !below.classList.contains('os-scrollbar') && !below.querySelector('button[role="radio"]')) {
    below.setAttribute(HIDE_ATTR, 'collapse');
  }
  if (!isLyricsSteppedAside()) overlay?.classList.add('sly-lyrics-on');
}

/**
 * Where a status (fetching / not found) belongs, decided like slyPrepareContainer but
 * without building anything: 'panel' when there is a lyrics panel to draw in (Spotify's
 * themed panel, or the legacy layout), 'overlay' when Spotify's expanded Now Playing view
 * shows its own content (artwork and cards: nothing may cover them), null when no lyrics
 * view is open.
 */
export function slyStatusPlacement(): 'panel' | 'overlay' | null {
  const themed = getThemedPanelContainer();
  if (themed) return 'panel';
  if (!isLyricsButtonActive()) return null;
  const host = getFallbackLayoutHost();
  if (!host) return null;
  return getAppRoot() && host === getNowPlayingOverlay() ? 'overlay' : 'panel';
}

window.slyPrepareContainer = function (opts: { forLyrics?: boolean } = {}): HTMLElement | null {
  // 2026 UI (clean-DOM verified): panel lives under DIV#main > [data-testid="root"], themed
  // container carries --lyrics-color-*. Never use <main> tag or NPV aside.
  // Return null unless the lyrics panel is actually open (button active or
  // panel lines present) — otherwise HUD/takeover fires in NPV on startup.
  const btnActive = isLyricsButtonActive();
  const themed = getThemedPanelContainer() as HTMLElement | null;
  const hasPanelLines = getLyricsLines().length > 0;
  if (!btnActive && !themed && !hasPanelLines) return null;
  if (!btnActive && !themed) return null;
  // No themed panel (Spotify has no lyrics: the overlay shows artwork): our root goes
  // inside the Now Playing overlay, never the app root, which put the HUD over the
  // whole page and the player bar.
  const rootParent = (themed?.parentElement ?? getFallbackLayoutHost()) as HTMLElement | null;
  if (!rootParent) return null;
  const inOverlay = !themed && !!getAppRoot() && rootParent === getNowPlayingOverlay();
  // Fetched lyrics where Spotify has none are only shown with Spotify's own lyrics
  // classes (measured), and in Spotify's own slot when it can be found.
  let slot: HTMLElement | null = null;
  if (inOverlay && opts.forLyrics) {
    // Spotify has lyrics for this track (its option is enabled) and is only mounting its
    // panel: wait for it, as with any track with lyrics.
    if (!isLyricsOptionDisabled()) {
      if (window.slyInternalState) window.slyInternalState.lastPrepareRefusal = 'spotify-panel-pending';
      return null;
    }
    const kitWorks = isLyricsKitWorking();
    slot = kitWorks ? slyFindOverlayLyricsSlot() : null;
    if (!slot) {
      // Without Spotify's lyrics classes and slot, never show lyrics in another look.
      if (window.slyInternalState) {
        window.slyInternalState.lastPrepareRefusal = !kitWorks ? 'lyrics-style-unknown' : lastSlotSearchBusy ? 'lyrics-slot-busy' : 'lyrics-slot-unknown';
      }
      return null;
    }
  }

  let root = document.getElementById('lyrics-root-sync') as HTMLElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'lyrics-root-sync';
    root.style.minHeight = '100%';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
  }
  root.className = window.SPOTIFY_CLASSES.containerClasses || window.SPOTIFY_CLASSES.container;
  // In the overlay without Spotify's slot the root is a positioned layer over its
  // content (below its header, inside its own stacking context, so the player bar stays
  // usable): status notices, and lyrics when the slot cannot be found.
  root.classList.toggle('sly-root-overlay', inOverlay && !slot);
  if (window.slyInternalState) window.slyInternalState.lastPrepareRefusal = null;
  if (slot) {
    slyPlaceInOverlaySlot(root, slot);
  } else {
    slyRestoreOverlayContent();
    // Replace the native lyrics panel in its actual slot. Appending to the
    // parent puts the custom root after Spotify's ~704px `oos...` layout spacer,
    // leaving that spacer above the injected panel even when native lyrics are hidden.
    if (themed?.parentElement === rootParent) {
      rootParent.insertBefore(root, themed);
    } else if (root.parentElement !== rootParent) {
      rootParent.appendChild(root);
    }
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
    // Written one by one and only when they differ: the poll calls this every tick, and a
    // whole-cssText rewrite also dropped the root's own layout styles every time.
    const style = (nativeReference as HTMLElement).style;
    for (let i = 0; i < style.length; i++) {
      const name = style[i];
      if (name.startsWith('--')) setStyleIfChanged(root, name, style.getPropertyValue(name));
    }
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
    setStyleIfChanged(root, '--lyrics-color-background', t.background);
    setStyleIfChanged(root, '--lyrics-color-inactive', t.inactive);
    setStyleIfChanged(root, '--lyrics-color-active', t.active);
    setStyleIfChanged(root, '--lyrics-color-passed', t.passed);
  }

  // 3. FALLBACK: Standard upgrade logic for missing or invalid colors
  const inactive = root.style.getPropertyValue('--lyrics-color-inactive')?.trim();
  if (!inactive || inactive === '#000000' || inactive.includes('rgba(0,0,0,1)') || inactive === 'rgb(0, 0, 0)') {
    setStyleIfChanged(root, '--lyrics-color-inactive', 'rgba(255, 255, 255, 0.7)');
    setStyleIfChanged(root, '--lyrics-color-passed', 'rgba(255, 255, 255, 1)');
    setStyleIfChanged(root, '--lyrics-color-active', '#ffffff');
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
      setStyleIfChanged(root, '--lyrics-color-background', safeBg);
    }
  }

  if (nativeReference && (nativeReference as HTMLElement).style.display !== 'none') (nativeReference as HTMLElement).style.display = 'none';
  if (root.style.display) root.style.display = '';
};

/** Sets an inline style property only when its value changes (no style rewrite, no mutation). */
function setStyleIfChanged(el: HTMLElement, name: string, value: string | null | undefined): void {
  const next = String(value ?? '').trim();
  if (!next) return;
  if (el.style.getPropertyValue(name).trim() !== next) el.style.setProperty(name, next);
}

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
    header.className = `${slyGetEncorePrefix()}text encore-text-body-small ${window.SPOTIFY_CLASSES.unsyncedMessage}`;
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
  attr.innerHTML = `<p class="${slyGetEncorePrefix()}text encore-text-body-small" data-encore-id="text" dir="auto">Lyrics provided by Spotify Karaoke</p>`;
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
