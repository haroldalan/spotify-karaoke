// @ts-nocheck
// Port of: lyric-test/modules/core/scavenger.js
import { safeBrowserCall } from '../utils/browserUtils';

/**
 * SPOTIFY_CLASSES: The central dictionary of hashed class names used by Spotify.
 * These are updated dynamically by the scavenger if Spotify changes them.
 */
export interface SpotifyClasses {
  mainContainer: string;
  container: string;
  wrapper: string;
  lyricsList: string;
  lineBase: string;
  // Synced States (Native Hashes)
  passedLine: string;
  activeLine: string;
  futureLine: string;
  // Unsynced States
  unsynced: string;
  unsyncedMessage: string;
  // Utils
  textInner: string;
  attribution: string;
  paddingLineHelper: string;
  footerGrid: string;
  // Resilience Additions (Chunk 1)
  errorContainer: string;
  btnPrimary: string;
  btnPrimaryInner: string;
  btnSecondary: string;
  btnSecondaryInner: string;
  topSpacer: string;
  footerInner1: string;
  footerInner2: string;
}

declare global {
  interface Window {
    SPOTIFY_CLASSES: SpotifyClasses;
    slyScavengeClasses: () => void;
    slyDeepScavengeStyles: () => void;
  }
}

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
  btnPrimary:        'e-10451-legacy-button e-10451-legacy-button-primary',
  btnPrimaryInner:   'e-10451-button-primary__inner',
  btnSecondary:      'e-10451-legacy-button e-10451-legacy-button-secondary',
  btnSecondaryInner: 'e-10451-button-secondary__inner',
  topSpacer:         'nIWoY9ePLgi1am10',
  footerInner1:      'KBRwz1uoWl0AAEsT',
  footerInner2:      'g5l1TSALoQMUlKhS',
};

window.SPOTIFY_CLASSES = SPOTIFY_CLASSES;

/**
 * DYNAMIC CLASS SCAVENGER
 * Inspects live Spotify elements to discover updated hashed classes.
 * This allows the extension to survive Spotify updates without a manual patch.
 */
export const slyScavengeClasses = function (): void {
  // Performance Guard: If we are already taking over, do not perform heavy scavenging.
  if (document.getElementById('lyrics-root-sync')) return;

  console.log('[sly-scavenger] Inspecting DOM for class updates...');

  // 1. Main View Wrapper
  const main = document.querySelector('main');
  if (main && main.classList.length > 0) {
    window.SPOTIFY_CLASSES.mainContainer = main.classList[0];
  }

  // 2. Lyrics Container (Anchor: Inline CSS Variables)
  const nativeContainer = document.querySelector('main div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)') as HTMLElement | null;
  
  if (nativeContainer) {
    window.SPOTIFY_CLASSES.container = nativeContainer.classList[0] || window.SPOTIFY_CLASSES.container;

    // 3. Structural Children
    if (nativeContainer.children.length > 0) {
      window.SPOTIFY_CLASSES.topSpacer = nativeContainer.children[0].classList[0] || window.SPOTIFY_CLASSES.topSpacer;
    }

    if (nativeContainer.children.length > 1) {
      const secondChild = nativeContainer.children[1] as HTMLElement;
      
      // If the second child has NO lyrics lines, it could be the Error Container or a loading spinner.
      // We check for text content to ensure it's actually an error message, not an empty spinner.
      if (secondChild.querySelectorAll('[data-testid="lyrics-line"]').length === 0) {
        const txt = (secondChild.textContent || '').trim().toLowerCase();
        if (txt.length > 0 && !txt.includes('loading')) {
          const oldError = window.SPOTIFY_CLASSES.errorContainer;
          window.SPOTIFY_CLASSES.errorContainer = secondChild.classList[0] || window.SPOTIFY_CLASSES.errorContainer;
          console.log(`[sly-audit] Scavenged errorContainer: "${window.SPOTIFY_CLASSES.errorContainer}" (was: "${oldError}"). Node <${secondChild.tagName}>, Classes: "${secondChild.className}", Text: "${(secondChild.textContent || '').trim().slice(0, 60)}"`);
        }
      } else {
        window.SPOTIFY_CLASSES.wrapper = secondChild.classList[0] || window.SPOTIFY_CLASSES.wrapper;
        const list = secondChild.children[0] as HTMLElement | undefined;
        if (list) window.SPOTIFY_CLASSES.lyricsList = list.classList[0] || window.SPOTIFY_CLASSES.lyricsList;
      }
    }

    const footer = nativeContainer.lastElementChild as HTMLElement | null;
    // Ensure the footer isn't accidentally the top spacer or error container
    if (footer && footer !== nativeContainer.children[0] && footer !== nativeContainer.children[1]) {
      window.SPOTIFY_CLASSES.footerGrid = footer.classList[0] || window.SPOTIFY_CLASSES.footerGrid;
      if (footer.children.length > 1) {
        window.SPOTIFY_CLASSES.footerInner1 = footer.children[0].classList[0] || window.SPOTIFY_CLASSES.footerInner1;
        window.SPOTIFY_CLASSES.footerInner2 = footer.children[1].classList[0] || window.SPOTIFY_CLASSES.footerInner2;
      }
    }

    // 4. Line Base & Padding Helper
    const lines = nativeContainer.querySelectorAll('[data-testid="lyrics-line"]');
    if (lines.length > 0) {
      window.SPOTIFY_CLASSES.lineBase = lines[0].classList[0] || window.SPOTIFY_CLASSES.lineBase;
      const inner = lines[0].querySelector('div');
      if (inner) window.SPOTIFY_CLASSES.textInner = inner.classList[0] || window.SPOTIFY_CLASSES.textInner;

      // HACK: Find the padding helper class by looking for lines with no text (spacers)
      const paddingLine = Array.from(lines).find(l => !l.textContent?.trim());
      if (paddingLine && paddingLine.classList.length > 1) {
        // The padding helper is usually the second or last class on the spacer element
        window.SPOTIFY_CLASSES.paddingLineHelper = paddingLine.classList[paddingLine.classList.length - 1];
      }
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
    window.SPOTIFY_CLASSES.btnPrimary = btn.className;
    const inner = btn.querySelector('span');
    if (inner) window.SPOTIFY_CLASSES.btnPrimaryInner = inner.className;
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
    window.SPOTIFY_CLASSES.btnSecondary = btnSec.className;
    const inner = btnSec.querySelector('span');
    if (inner) window.SPOTIFY_CLASSES.btnSecondaryInner = inner.className;
  }
  
  // 6. Deep CSS Scavenge (Background fetch to bypass CORS)
  const now = Date.now();
  if (hasDeepScavenged && now - lastDeepScavengeTime > 24 * 60 * 60 * 1000) {
    hasDeepScavenged = false;
  }

  if (typeof window.slyDeepScavengeStyles === 'function') {
    window.slyDeepScavengeStyles();
  }
}

let isDeepScavenging = false;
let hasDeepScavenged = false;
let lastDeepScavengeTime = 0;

/**
 * DEEP CSS SCAVENGER
 * Bypasses DOM ephemerality by reading Spotify's CSS directly via background worker fetch.
 */
export function slyDeepScavengeStyles(): void {
  if (hasDeepScavenged || isDeepScavenging) return;

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

    // 3. Extract standalone UI components
    const unsyncedMsgRegex = /\.([a-zA-Z0-9_-]+)\{[^}]*margin-top:62px!important[^}]*\}/;
    const unsyncedMsgMatch = css.match(unsyncedMsgRegex);
    if (unsyncedMsgMatch) window.SPOTIFY_CLASSES.unsyncedMessage = unsyncedMsgMatch[1];

    const attrRegex = /\.([a-zA-Z0-9_-]+)\{[^}]*margin-bottom:20px;padding:20px 0;display:inline-block[^}]*\}/;
    const attrMatch = css.match(attrRegex);
    if (attrMatch) window.SPOTIFY_CLASSES.attribution = attrMatch[1];

    document.body.classList.remove('sly-fallback');

    console.log('[sly-scavenger] Deep CSS Scavenge complete:', { ...window.SPOTIFY_CLASSES });
    hasDeepScavenged = true;
    lastDeepScavengeTime = Date.now();
  }).catch((err: any) => {
    isDeepScavenging = false;
    document.body.classList.remove('sly-fallback');
    console.error('[sly-scavenger] Deep CSS Scavenge failed:', err);
  });
}

window.slyScavengeClasses = slyScavengeClasses;
window.slyDeepScavengeStyles = slyDeepScavengeStyles;
