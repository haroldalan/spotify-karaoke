// @ts-nocheck
// Port of: lyric-test/modules/core/scavenger.js
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
  // Encore version bump: e-10451 (2025) -> e-10860 (2026). Scavenger auto-learns
  // live classes, these defaults only matter before first scavenge.
  btnPrimary:        'e-10860-legacy-button e-10860-legacy-button-primary',
  btnPrimaryInner:   'e-10860-button-primary__inner',
  btnSecondary:      'e-10860-legacy-button e-10860-legacy-button-secondary',
  btnSecondaryInner: 'e-10860-button-secondary__inner',
  topSpacer:         'nIWoY9ePLgi1am10',
  footerInner1:      'KBRwz1uoWl0AAEsT',
  footerInner2:      'g5l1TSALoQMUlKhS',
};

window.SPOTIFY_CLASSES = SPOTIFY_CLASSES;

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
  const nativeContainer = Array.from(
    document.querySelectorAll('div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)')
  )
    .filter(el => !el.closest('aside[aria-label="Now playing view"], aside.NowPlayingView, [data-testid="now-playing-bar"], footer'))
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
    if (firstLine) {
      // Discover structure from the line's actual ancestry instead of fixed
      // child indexes, which changed in Spotify's new lyrics layout.
      const list = firstLine.parentElement?.parentElement;
      const wrapper = list?.parentElement;
      if (list) {
        window.SPOTIFY_CLASSES.lyricsList = findHash(list.classList) || window.SPOTIFY_CLASSES.lyricsList;
        window.SPOTIFY_CLASSES.lyricsListClasses = list.className;
      }
      if (wrapper) {
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
    
    // Broadcast updated classes to the MAIN world (slyBridge.js)
    window.postMessage({ type: 'SLY_UPDATE_CLASSES', classes: window.SPOTIFY_CLASSES }, '*');
    
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
