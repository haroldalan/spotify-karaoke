// @ts-nocheck
// Port of: lyric-test/modules/core/scavenger.js
import { currentSongOnly } from '../dom/domQueries';
import { safeBrowserCall } from '../utils/browserUtils';

/**
 * SPOTIFY_CLASSES: The central dictionary of hashed class names used by Spotify.
 * These are updated dynamically by the scavenger if Spotify changes them.
 */
export const SPOTIFY_CLASSES: SpotifyClasses = {
  mainContainer:     'J6wP3V0xzh0Hj_MS',
  container:         'bbJIIopLxggQmv5x',
  wrapper:           'ktJDHL_Wb5k6zJxf',
  lyricsList:        'GmI3DMxKYRsaA5DM',
  lineBase:          'WnslfFBWTgOIUgNH',
  passedLine:        'XiH9KR6bhDwEFykV',
  activeLine:        'RL7r4lsMHxMySdFr',
  futureLine:        'Mnf9PkrVHsX90BNf',
  unsynced:          'AQFBg9wNhDoKJHvS',
  unsyncedMessage:   'ReC7DlF3I_k9g6Vv',
  textInner:         'a8PTgYsfzc07Np9G',
  attribution:       'NUBq_wlyuwoDUsSg',
  paddingLineHelper: 'aLaX8poOH8kdbmGf',
  footerGrid:        'T0IQrE6mvz4Fs7rc',
  errorContainer:    'hfTlyhd7WCIk9xmP',
  // Encore prefix as of 2026-11 is e-101040-; realignEncorePrefix() rewrites these to the
  // live build's prefix on every scavenge, so the value here only matters before that.
  btnPrimary:        'e-101040-legacy-button e-101040-legacy-button-primary',
  btnPrimaryInner:   'e-101040-button-primary__inner',
  btnSecondary:      'e-101040-legacy-button e-101040-legacy-button-secondary',
  btnSecondaryInner: 'e-101040-button-secondary__inner',
  topSpacer:         'nIWoY9ePLgi1am10',
  footerInner1:      'KBRwz1uoWl0AAEsT',
  footerInner2:      'g5l1TSALoQMUlKhS',
};

window.SPOTIFY_CLASSES = SPOTIFY_CLASSES;

// ---------------------------------------------------------------------------
// Lyrics "kit": the class names that give lyrics Spotify's own look. Lines take
// Spotify's typography only inside its lyrics wrapper + list classes, so lyrics the
// extension renders where Spotify shows none (tracks without Spotify lyrics) need
// those names before any native lyrics panel has been on screen. Sources, best first:
// a live panel (this page), the snapshot of the last live panel on this Spotify build,
// then Spotify's stylesheet itself. A measurement confirms the names really work.
// ---------------------------------------------------------------------------

export type LyricsKitSource = 'default' | 'css' | 'snapshot' | 'live';
let lyricsKitSource: LyricsKitSource = 'default';
export const getLyricsKitSource = (): LyricsKitSource => lyricsKitSource;

const KIT_STORAGE_KEY = 'sly_lyrics_kit';
const KIT_FIELDS = ['container', 'containerClasses', 'wrapper', 'wrapperClasses', 'lyricsList', 'lyricsListClasses',
  'lineBase', 'textInner', 'paddingLineHelper', 'topSpacer', 'slotClass', 'footerGrid', 'footerInner1', 'footerInner2',
  'activeLine', 'passedLine', 'futureLine', 'unsynced', 'unsyncedMessage', 'attribution'] as const;

/** Identifies the running Spotify build: the address of its main stylesheet (it carries a content hash). */
export function spotifyBuildKey(): string {
  const link = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .find(l => (l as HTMLLinkElement).href.includes('open.spotifycdn.com')) as HTMLLinkElement | undefined;
  return link?.href ?? '';
}

let lastSavedKit = '';
function saveLyricsKitSnapshot(): void {
  const build = spotifyBuildKey();
  if (!build) return;
  const classes: Record<string, string> = {};
  for (const k of KIT_FIELDS) if (typeof window.SPOTIFY_CLASSES[k] === 'string') classes[k] = window.SPOTIFY_CLASSES[k];
  const json = JSON.stringify({ build, classes });
  if (json === lastSavedKit) return;
  lastSavedKit = json;
  safeBrowserCall(() => browser.storage.local.set({ [KIT_STORAGE_KEY]: { build, classes, savedAt: Date.now() } }));
}

/** Startup: reuse the last live panel's names if they belong to this Spotify build. */
export async function loadLyricsKitSnapshot(): Promise<void> {
  if (lyricsKitSource === 'live') return;
  try {
    const stored = (await browser.storage.local.get(KIT_STORAGE_KEY))?.[KIT_STORAGE_KEY];
    const build = spotifyBuildKey();
    if (!stored?.classes || !build || stored.build !== build || lyricsKitSource === 'live') return;
    for (const k of KIT_FIELDS) if (typeof stored.classes[k] === 'string') window.SPOTIFY_CLASSES[k] = stored.classes[k];
    lyricsKitSource = 'snapshot';
    lastSavedKit = JSON.stringify({ build, classes: stored.classes });
    console.log('[sly-scavenger] Lyrics class names restored from the last live panel on this Spotify build.');
  } catch { /* storage unavailable: CSS and live sources still apply */ }
}

const kitProbeCache = new Map<string, boolean>();

/** Test hook: forget the kit source and measurements. */
export function resetLyricsKit(): void {
  lyricsKitSource = 'default';
  kitProbeCache.clear();
  lastSavedKit = '';
  hasDeepScavenged = false;
  isDeepScavenging = false;
  lastDeepScavengeFailAt = 0;
}

/**
 * Measures whether the current names give lyrics Spotify's typography. Spotify's rule
 * sets it on the list only inside the wrapper (.wrapper .list{font-size…;font-weight:700}),
 * and lines inherit it: a list inside the wrapper must differ from the same list
 * without it (live 2026-11: 32px/700 vs 16px/400).
 */
export function isLyricsKitWorking(): boolean {
  const c = window.SPOTIFY_CLASSES;
  const wrapper = c.wrapperClasses || c.wrapper;
  const list = c.lyricsListClasses || c.lyricsList;
  const key = `${wrapper}|${list}`;
  const cached = kitProbeCache.get(key);
  if (cached !== undefined) return cached;
  if (!document.body || !wrapper || !list) return false;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:200px;visibility:hidden;pointer-events:none;';
  const w = document.createElement('div'); w.className = wrapper;
  const l = document.createElement('div'); l.className = list; l.textContent = 'x';
  const bare = document.createElement('div'); bare.className = list; bare.textContent = 'x';
  w.appendChild(l); host.appendChild(w); host.appendChild(bare);
  document.body.appendChild(host);
  const a = getComputedStyle(l), b = getComputedStyle(bare);
  const size = (v: string) => parseFloat(v) || 0;
  const weight = (v: string) => Number(v) || (v === 'bold' ? 700 : 0);
  const works = size(a.fontSize) > size(b.fontSize) || weight(a.fontWeight) > weight(b.fontWeight);
  host.remove();
  // Unknown until the stylesheet is in: do not remember a negative result.
  if (works || document.readyState === 'complete') kitProbeCache.set(key, works);
  return works;
}

/** isLyricsKitWorking for other wrapper/list names (the current ones are given back). */
function worksWith(names: { wrapper?: string; wrapperClasses?: string; lyricsList?: string; lyricsListClasses?: string }): boolean {
  const c = window.SPOTIFY_CLASSES;
  const current = { wrapper: c.wrapper, wrapperClasses: c.wrapperClasses, lyricsList: c.lyricsList, lyricsListClasses: c.lyricsListClasses };
  Object.assign(c, names);
  const works = isLyricsKitWorking();
  Object.assign(c, current);
  return works;
}

const ENCORE_PREFIX_RE = /(?:^|\s)(e-\d+-)/;
const BUTTON_CLASS_KEYS = ['btnPrimary', 'btnPrimaryInner', 'btnSecondary', 'btnSecondaryInner'] as const;

/** Rewrites stale e-NNNNN- prefixes in the button class defaults to the prefix of the running build. */
export function realignEncorePrefix(): void {
  let live: string | null = null;
  for (const el of Array.from(document.querySelectorAll('[data-encore-id]'))) {
    const m = (el.getAttribute('class') || '').match(ENCORE_PREFIX_RE);
    if (m) { live = m[1]; break; }
  }
  if (!live) return;
  for (const key of BUTTON_CLASS_KEYS) {
    const current = window.SPOTIFY_CLASSES[key];
    if (typeof current === 'string') window.SPOTIFY_CLASSES[key] = current.replace(/\be-\d+-/g, live);
  }
}

// Helper to strip directional icon classes that cause asymmetrical padding
const sanitizeBtn = (cls: string) => cls.split(' ')
  .filter(c =>
    !c.includes('--leading') &&
    !c.includes('--trailing') &&
    !c.includes('--icon') &&
    !c.includes('icon-only') &&
    !c.endsWith('--small') &&
    !c.endsWith('--medium')
  )
  .join(' ');

/**
 * DYNAMIC CLASS SCAVENGER
 * Inspects live Spotify elements to discover updated hashed classes.
 * This allows the extension to survive Spotify updates without a manual patch.
 */
export const slyScavengeClasses = function (): void {
  console.log('[sly-scavenger] Inspecting DOM for class updates...');

  // Encore bumps its class prefix often (e-10451 -> e-10860 -> e-101040 within 2025-26).
  // Re-prefix the button defaults to the live build's prefix so HUD/Sync buttons keep
  // Spotify's styling even when no live button is found to learn from below.
  realignEncorePrefix();

  // Helper: Find the hashed class in a list. 
  // Spotify hashes are usually 8+ chars and alphanumeric. Utilities often have dashes.
  const findHash = (list: DOMTokenList, fallbackIdx = 0) => 
    Array.from(list).find(c => c.length >= 8 && !c.includes('-') && !c.includes('encore-')) || list[fallbackIdx];

  // 1. Legacy <main> wrapper only. The 2026 app uses DIV#main; its class list
  // must not be mistaken for Spotify's old lyrics-view class fingerprint.
  const main = document.querySelector('main');
  if (main && main.classList.length > 0) {
    window.SPOTIFY_CLASSES.mainContainer = findHash(main.classList);
  }

  // 2. The full lyrics panel and the NPV lyrics preview both use the same CSS
  // variables. The preview has a small, different component tree; fingerprinting
  // it gives lyricsList the line class (MFEB...) instead of the real list class
  // (t3jT...). Exclude NPV/bar ancestry and prefer the panel with most lyric rows.
  // Another song's panel still mounted beside this one is never the reference.
  const currentSong = currentSongOnly();
  const nativeContainer = Array.from(
    document.querySelectorAll('div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)')
  )
    .filter(el => !el.closest('#Desktop_PanelContainer_Id, [data-testid="lyrics-npv-section"], aside[aria-label="Now playing view"], aside.NowPlayingView, [data-testid="now-playing-bar"], footer, [data-sly-leaving]') && currentSong(el))
    .sort((a, b) => b.querySelectorAll('[data-testid="lyrics-line"]').length - a.querySelectorAll('[data-testid="lyrics-line"]').length)[0] as HTMLElement | undefined;
  
  if (nativeContainer) {
    window.SPOTIFY_CLASSES.container = findHash(nativeContainer.classList) || window.SPOTIFY_CLASSES.container;
    // Preserve all layout/state classes, not just the first hash. The 2026
    // panel's second container class scopes sizing for its top spacer; dropping
    // it made the cloned spacer resolve to thousands of pixels tall.
    window.SPOTIFY_CLASSES.containerClasses = nativeContainer.className;

    // 3. Structural Children
    if (nativeContainer.children.length > 0) {
      window.SPOTIFY_CLASSES.topSpacer = findHash(nativeContainer.children[0].classList) || window.SPOTIFY_CLASSES.topSpacer;
    }

    const firstLine = nativeContainer.querySelector('[data-testid="lyrics-line"]');
    // The names in use before this panel, given back if this panel's do not work.
    const before = { wrapper: window.SPOTIFY_CLASSES.wrapper, wrapperClasses: window.SPOTIFY_CLASSES.wrapperClasses,
      lyricsList: window.SPOTIFY_CLASSES.lyricsList, lyricsListClasses: window.SPOTIFY_CLASSES.lyricsListClasses };
    if (firstLine) {
      // By structure, not by depth: the wrapper is the container's child holding the lines
      // and the list is the wrapper's child holding them. Synced panels wrap each line once
      // more than unsynced ones (live 2026-11: unsynced line → list → wrapper → container),
      // so a fixed depth took the wrapper for the list on an unsynced panel.
      const wrapper = Array.from(nativeContainer.children).find(c => c.contains(firstLine)) as HTMLElement | undefined;
      const list = wrapper ? Array.from(wrapper.children).find(c => c.contains(firstLine)) as HTMLElement | undefined : undefined;
      if (wrapper && list && list !== firstLine) {
        window.SPOTIFY_CLASSES.lyricsList = findHash(list.classList) || window.SPOTIFY_CLASSES.lyricsList;
        window.SPOTIFY_CLASSES.lyricsListClasses = list.className;
        window.SPOTIFY_CLASSES.wrapper = findHash(wrapper.classList) || window.SPOTIFY_CLASSES.wrapper;
        window.SPOTIFY_CLASSES.wrapperClasses = wrapper.className;
      }
    } else if (nativeContainer.children.length > 1) {
      const errorCandidate = nativeContainer.children[1] as HTMLElement;
      const txt = (errorCandidate.textContent || '').trim().toLowerCase();
      if (txt && !txt.includes('loading')) {
        const oldError = window.SPOTIFY_CLASSES.errorContainer;
        window.SPOTIFY_CLASSES.errorContainer = findHash(errorCandidate.classList) || window.SPOTIFY_CLASSES.errorContainer;
        console.log(`[sly-audit] Scavenged errorContainer: "${window.SPOTIFY_CLASSES.errorContainer}" (was: "${oldError}")`);
      }
    }

    const footer = nativeContainer.lastElementChild as HTMLElement | null;
    if (footer && footer !== nativeContainer.children[0] && footer !== nativeContainer.children[1]) {
      window.SPOTIFY_CLASSES.footerGrid = findHash(footer.classList) || window.SPOTIFY_CLASSES.footerGrid;
      if (footer.children.length > 1) {
        window.SPOTIFY_CLASSES.footerInner1 = findHash(footer.children[0].classList) || window.SPOTIFY_CLASSES.footerInner1;
        window.SPOTIFY_CLASSES.footerInner2 = findHash(footer.children[1].classList) || window.SPOTIFY_CLASSES.footerInner2;
      }
    }

    // 4. Line Base & Padding Helper
    const lines = nativeContainer.querySelectorAll('[data-testid="lyrics-line"]');
    if (lines.length > 0) {
      window.SPOTIFY_CLASSES.lineBase = findHash(lines[0].classList) || window.SPOTIFY_CLASSES.lineBase;
      const inner = lines[0].querySelector(':scope > div');
      if (inner) window.SPOTIFY_CLASSES.textInner = findHash(inner.classList) || window.SPOTIFY_CLASSES.textInner;

      // HACK: Find the padding helper class by looking for lines with no text (spacers)
      const paddingLine = Array.from(lines).find(l => !l.textContent?.trim());
      if (paddingLine && paddingLine.classList.length > 1) {
        // The padding helper is usually the second or last class on the spacer element
        window.SPOTIFY_CLASSES.paddingLineHelper = paddingLine.classList[paddingLine.classList.length - 1];
      }
    }
    if (firstLine && !isLyricsKitWorking() && worksWith(before)) {
      // This panel's names do not give Spotify's typography and the previous ones do: keep those.
      console.warn('[sly-scavenger] Lyrics wrapper/list names from this panel do not give Spotify\'s typography; keeping the previous ones.');
      Object.assign(window.SPOTIFY_CLASSES, before);
    } else if (firstLine && window.SPOTIFY_CLASSES.wrapperClasses && window.SPOTIFY_CLASSES.lyricsListClasses) {
      // The slot that holds the lyrics panel in Spotify's layout (also there, with the
      // artwork in it, in the expanded Now Playing view of a track without lyrics).
      const slot = nativeContainer.parentElement;
      if (slot) window.SPOTIFY_CLASSES.slotClass = findHash(slot.classList) || window.SPOTIFY_CLASSES.slotClass;
      lyricsKitSource = 'live';
      saveLyricsKitSnapshot();
    }
    console.log('[sly-scavenger] Fingerprinting complete — container dictionary updated.');
  } else {
    console.log('[sly-scavenger] Native container not visible — using cached fingerprints.');
  }

  // 5. Buttons (Surgically relaxed to support 'small-bold' or 'medium-bold')
  const btn = Array.from(document.querySelectorAll('[data-encore-id="buttonPrimary"]'))
    .find(el => (el.className.includes('bold') || el.className.includes('medium')) && !(el as HTMLElement).dataset.testid) ||
    document.querySelector('[data-encore-id="buttonPrimary"]'); // Safe fallback if strict matches fail
  if (btn) {
    window.SPOTIFY_CLASSES.btnPrimary = sanitizeBtn(btn.className);
    const inner = btn.querySelector('span');
    if (inner) window.SPOTIFY_CLASSES.btnPrimaryInner = sanitizeBtn(inner.className);
  }

  // Secondary Button (Surgically excludes small, text-only, or icon-only variants)
  const btnSec = Array.from(document.querySelectorAll('[data-encore-id="buttonSecondary"]'))
    .find(el => {
      const cls = el.className;
      const isSmall = cls.includes('--small');
      const isTextOnly = cls.includes('--text') || cls.includes('text-base');
      return !(el as HTMLElement).dataset.testid && !isSmall && !isTextOnly;
    });
  if (btnSec) {
    window.SPOTIFY_CLASSES.btnSecondary = sanitizeBtn(btnSec.className);
    const inner = btnSec.querySelector('span');
    if (inner) window.SPOTIFY_CLASSES.btnSecondaryInner = sanitizeBtn(inner.className);
  }
  
  // 6. Deep CSS Scavenge (Background fetch to bypass CORS)
  const now = Date.now();
  if (hasDeepScavenged && now - lastDeepScavengeTime > 24 * 60 * 60 * 1000) {
    hasDeepScavenged = false;
  }

  if (typeof window.slyDeepScavengeStyles === 'function') {
    window.slyDeepScavengeStyles();
  }

  // Broadcast updated classes to the MAIN world (slyBridge.js)
  window.postMessage({ type: 'SLY_UPDATE_CLASSES', classes: window.SPOTIFY_CLASSES }, '*');
}

let isDeepScavenging = false;
let hasDeepScavenged = false;
let lastDeepScavengeTime = 0;

/**
 * DEEP CSS SCAVENGER
 * Bypasses DOM ephemerality by reading Spotify's CSS directly via background worker fetch.
 */
let lastDeepScavengeFailAt = 0;
const DEEP_SCAVENGE_RETRY_MS = 60_000;

export function slyDeepScavengeStyles(): void {
  if (hasDeepScavenged || isDeepScavenging) return;
  if (!document.body) return;
  // After a failed fetch, wait before fetching Spotify's whole stylesheet again.
  if (lastDeepScavengeFailAt && Date.now() - lastDeepScavengeFailAt < DEEP_SCAVENGE_RETRY_MS) return;

  document.body.classList.add('sly-fallback');

  const link = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(l => (l as HTMLLinkElement).href.includes('open.spotifycdn.com'));
  if (!link) {
    document.body.classList.remove('sly-fallback');
    return;
  }

  const url = (link as HTMLLinkElement).href;
  
  isDeepScavenging = true;
  safeBrowserCall(() => browser.runtime.sendMessage({ type: 'SLY_FETCH_CSS', url })).then((response: any) => {
    isDeepScavenging = false;
    if (!response || !response.success || !response.cssText) {
        lastDeepScavengeFailAt = Date.now();
        document.body.classList.remove('sly-fallback');
        return;
    }
    const css = response.cssText;
    
    // 1. Find lineBase completely autonomously
    const baseMatch = css.match(/\.([a-zA-Z0-9_-]+)\{color:var\(--lyrics-color-inactive\)\}/);
    if (baseMatch) {
        window.SPOTIFY_CLASSES.lineBase = baseMatch[1];
    }
    const lineBase = window.SPOTIFY_CLASSES.lineBase;
    
    // 2. Extract stateful hashes
    const activeRegex = new RegExp(`\\.${lineBase}\\.([a-zA-Z0-9_-]+)\\{[^}]*color:var\\(--lyrics-color-active\\)[^}]*\\}`);
    const activeMatch = css.match(activeRegex);
    if (activeMatch) window.SPOTIFY_CLASSES.activeLine = activeMatch[1];

    const futureMatches = Array.from(css.matchAll(new RegExp(`\\.${lineBase}\\.([a-zA-Z0-9_-]+)\\{color:var\\(--lyrics-color-inactive\\)(?:;[^}]*)?\\}`, 'g')));
    for (const match of futureMatches) {
        if (match[0].includes('opacity:.5')) {
            window.SPOTIFY_CLASSES.passedLine = match[1];
        } else {
            window.SPOTIFY_CLASSES.futureLine = match[1];
        }
    }

    const unsyncedRegex = new RegExp(`\\.${lineBase}\\s+\\.([a-zA-Z0-9_-]+)\\{[^}]*pointer-events:none[^}]*\\}`);
    const unsyncedMatch = css.match(unsyncedRegex);
    if (unsyncedMatch) window.SPOTIFY_CLASSES.unsynced = unsyncedMatch[1];

    // 2b. The lyrics wrapper, list, container and panel slot (see the kit notes above).
    // Only fills names no live panel or snapshot has provided.
    const listMatch = css.match(/\.([a-zA-Z0-9_-]+) \.([a-zA-Z0-9_-]+)\{[^}]*font-size:var\(--encore-text-size-larger-\d\)[^}]*font-family:var\(--encore-title-font-stack\)/);
    // All three must match (the wrapper with its lyrics-view modifier, and the container),
    // so a similar rule of another component is never taken for Spotify's lyrics.
    const mod = listMatch && css.match(new RegExp(`\\.${listMatch[1]}\\.([a-zA-Z0-9_-]+)\\{padding-block-start:25vh\\}`));
    const container = css.match(/\.([a-zA-Z0-9_-]+)\{grid-template-rows:1fr;width:100%;height:calc\(100vh - 73px\)/);
    if (listMatch && mod && container && lyricsKitSource === 'default') {
      const [, wrapper, list] = listMatch;
      window.SPOTIFY_CLASSES.wrapper = wrapper;
      window.SPOTIFY_CLASSES.wrapperClasses = `${wrapper} ${mod[1]}`;
      window.SPOTIFY_CLASSES.lyricsList = list;
      window.SPOTIFY_CLASSES.lyricsListClasses = list;
      // The rest of the lyrics view, by the rules that style each part (2026-11 stylesheet).
      const containerMod = css.match(new RegExp(`\\.${container[1]}\\.([a-zA-Z0-9_-]+)\\{height:100vh\\}`));
      window.SPOTIFY_CLASSES.container = container[1];
      window.SPOTIFY_CLASSES.containerClasses = containerMod ? `${container[1]} ${containerMod[1]}` : container[1];
      // The top spacer paints the lyrics background.
      const topSpacer = css.match(/\.([a-zA-Z0-9_-]+)\{background-color:var\(--lyrics-color-background\);grid-area:1\/1\/-1\/-1/);
      if (topSpacer) window.SPOTIFY_CLASSES.topSpacer = topSpacer[1];
      const pad = css.match(new RegExp(`\\.${window.SPOTIFY_CLASSES.lineBase}:not\\(\\.([a-zA-Z0-9_-]+)\\)\\{margin-bottom:\\.6em\\}`));
      if (pad) window.SPOTIFY_CLASSES.paddingLineHelper = pad[1];
      const footer = css.match(/\.([a-zA-Z0-9_-]+)\{z-index:1;opacity:0;width:100%;margin-top:-40px;[^}]*position:sticky;bottom:32px\}/);
      if (footer) window.SPOTIFY_CLASSES.footerGrid = footer[1];
      // Generic rules: only when exactly one class carries them.
      const only = (re: RegExp): string | null => { const all = Array.from(css.matchAll(re)); return all.length === 1 ? all[0][1] : null; };
      const inner1 = only(/\.([a-zA-Z0-9_-]+)\{margin-inline-end:auto;display:flex\}/g);
      const inner2 = only(/\.([a-zA-Z0-9_-]+)\{margin-inline-start:auto;display:flex\}/g);
      if (inner1) window.SPOTIFY_CLASSES.footerInner1 = inner1;
      if (inner2) window.SPOTIFY_CLASSES.footerInner2 = inner2;
      lyricsKitSource = 'css';
    }
    window.SPOTIFY_CLASSES.slotCandidates = Array.from(css.matchAll(/\.([a-zA-Z0-9_-]+)\{flex-shrink:0;height:100%;position:relative\}/g)).map((m) => m[1]);

    // 3. Extract standalone UI components
    const unsyncedMsgRegex = /\.([a-zA-Z0-9_-]+)\{[^}]*margin-top:62px!important[^}]*\}/;
    const unsyncedMsgMatch = css.match(unsyncedMsgRegex);
    if (unsyncedMsgMatch) window.SPOTIFY_CLASSES.unsyncedMessage = unsyncedMsgMatch[1];

    const attrRegex = /\.([a-zA-Z0-9_-]+)\{[^}]*margin-bottom:20px;padding:20px 0;display:inline-block[^}]*\}/;
    const attrMatch = css.match(attrRegex);
    if (attrMatch) window.SPOTIFY_CLASSES.attribution = attrMatch[1];

    document.body.classList.remove('sly-fallback');

    console.log('[sly-scavenger] Deep CSS Scavenge complete:', { ...window.SPOTIFY_CLASSES });
    
    // Broadcast updated classes to the MAIN world (slyBridge.js)
    window.postMessage({ type: 'SLY_UPDATE_CLASSES', classes: window.SPOTIFY_CLASSES }, '*');
    
    hasDeepScavenged = true;
    lastDeepScavengeTime = Date.now();
  }).catch((err: any) => {
    isDeepScavenging = false;
    lastDeepScavengeFailAt = Date.now();
    document.body.classList.remove('sly-fallback');
    console.error('[sly-scavenger] Deep CSS Scavenge failed:', err);
  });
}

window.slyScavengeClasses = slyScavengeClasses;
window.slyDeepScavengeStyles = slyDeepScavengeStyles;
