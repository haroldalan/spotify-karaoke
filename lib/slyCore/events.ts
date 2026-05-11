// @ts-nocheck
import { getLyricsViewRoot } from '../dom/domQueries';
// Port of: lyric-test/modules/core/events.js
/* modules/content-events.js: Global Event Observers (Navigation & Interactions) */

// --- NAVIGATION INTERCEPTOR ---
function wrapHistory(): void {
  if (window.__sly_history_wrapped) return;
  window.__sly_history_wrapped = true;

  const pushState = history.pushState;
  history.pushState = function (...args) {
    pushState.apply(history, args);
    window.dispatchEvent(new Event('sly_nav_change'));
  };
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('sly_nav_change'));
  });
}
wrapHistory();

// Listen for navigation changes to trigger state checks
window.addEventListener('sly_nav_change', () => {
  // Small delay to allow Spotify's SPA router to update the DOM
  setTimeout(() => {
    if (typeof window.slyCheckNowPlaying === 'function') {
      window.slyCheckNowPlaying();
    }
  }, 100);
});

// --- GLOBAL INTERACTION MONITORING ---
// Tracks user scrolling to pause auto-scrolling of lyrics
const interactionOptions = { passive: true, capture: true };

function handleUserInteraction(e: Event): void {
  const lyricsRoot = (window.slyInternalState.customRoot as HTMLElement | null)
    ?? document.getElementById('lyrics-root-sync');
  if (lyricsRoot && e.target && lyricsRoot.contains(e.target as Node)) {
    window.slyInternalState.isUserScrolling = true;
  }
}

window.addEventListener('wheel', handleUserInteraction, interactionOptions);
window.addEventListener('mousedown', handleUserInteraction, interactionOptions);
window.addEventListener('touchstart', handleUserInteraction, interactionOptions);
window.addEventListener('scroll', handleUserInteraction, interactionOptions);

// --- NATIVE BUTTON HIJACK (Pointerdown Delegation) ---
// We intercept clicks on Spotify's lyrics button to route through our safe toggleLyrics() bridge
document.addEventListener('pointerdown', (e: Event) => {
  const btn = (e.target as HTMLElement).closest('[data-testid="lyrics-button"]');
  if (btn) {
    const isPressed = btn.getAttribute('data-active') === 'true' || btn.getAttribute('aria-pressed') === 'true';
    const provider = window.spotifyState?.lyricsProvider;
    const label = btn.getAttribute('aria-label');
    console.log(`[sly-audit] 🖱️ Lyrics Button Pointerdown captured. IsPressed: ${isPressed}, Provider: ${provider}, Label: "${label}"`);

    // Only hijack if Spotify has no lyrics provider, or if the button is in its default state
    if (provider === null || label === 'Lyrics') {
      // SLY FIX: Even if the button is already pressed, we MUST hijack the event.
      // Letting Spotify handle the "close" naturally is what triggers the New Tab Page redirect
      // because Spotify's native DOM click handler crashes when our Genetic Lock is active.
      e.preventDefault();
      e.stopPropagation();

      const intent = isPressed ? 'SLY_TRIGGER_NATIVE_CLOSE' : 'SLY_TRIGGER_NATIVE_OPEN';
      console.log(`[sly-audit] Hijacking event to prevent Spotify navigation hijack. Intent: ${intent}`);
      window.postMessage({ source: intent }, '*');
    } else {
      console.log('[sly-audit] Bypassing hijack because provider is not null and label is not "Lyrics".');
    }
  }
}, true); // Use capture phase to beat React's internal listeners

// --- LYRICS PANEL CLOSE DETECTOR ---
// Dispatches 'sly:panel_close' when [data-testid="lyrics-button"] loses data-active="true".
// This is the sole trigger for content.ts to remove #lyrics-root-sync and clean up sly-active.
//
// Implementation note: React may replace the button node entirely during SPA navigation,
// so we maintain a buttonFinderObserver that re-attaches the attribute watcher whenever
// a new button instance appears in the DOM.

let lyricsButtonObserver: MutationObserver | null = null;
let observedButton: Element | null = null;

function attachLyricsButtonObserver(): void {
  const btn = document.querySelector('[data-testid="lyrics-button"]');
  if (!btn || btn === observedButton) return; // already watching this exact node

  // Disconnect from any previously observed (now stale) button node
  if (lyricsButtonObserver) {
    lyricsButtonObserver.disconnect();
    lyricsButtonObserver = null;
  }

  observedButton = btn;

  lyricsButtonObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && (mutation.attributeName === 'data-active' || mutation.attributeName === 'aria-pressed')) {
        const wasActive = mutation.oldValue === 'true';
        const isNowInactive = (btn as HTMLElement).getAttribute('data-active') !== 'true' && (btn as HTMLElement).getAttribute('aria-pressed') !== 'true';
        if (wasActive && isNowInactive) {
          console.log('[sly] Panel close detected via lyrics button observer → dispatching sly:panel_close');
          document.dispatchEvent(new CustomEvent('sly:panel_close'));
        }
      }
    }
  });

  lyricsButtonObserver.observe(btn, {
    attributes: true,
    attributeFilter: ['data-active', 'aria-pressed'],
    attributeOldValue: true,
  });
  console.log('[sly] Lyrics button observer attached.');
}

// Observe the DOM for the lyrics button's first appearance (or re-appearance after React reconciliation)
const buttonFinderObserver = new MutationObserver(() => {
  const btn = document.querySelector('[data-testid="lyrics-button"]');
  if (btn && btn !== observedButton) {
    attachLyricsButtonObserver();
  }
});

let removalObserver: MutationObserver | null = null;

function initButtonFinder(): void {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', initButtonFinder);
    return;
  }
  const target = document.querySelector('.main-nowPlayingBar-container') ||
    document.querySelector('[data-testid="now-playing-bar"]') ||
    document.querySelector('.Root__now-playing-bar') ||
    document.querySelector('.Root') ||
    document.body;

  // Performance: Only use subtree: true if we have a narrow target. 
  // If we fall back to .Root or body, we use a less aggressive observation.
  const isBroadTarget = target === document.body || target?.classList.contains('Root');
  buttonFinderObserver.observe(target, { childList: true, subtree: !isBroadTarget });
  // Also try right away in case the button already exists at script load time
  attachLyricsButtonObserver();
}

initButtonFinder();

// --- INSTANT ERROR DETECTION ---
// Monitors for the specific "Lyrics not available" node to bypass polling delays
const errorObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType === 1) {
          const el = node as HTMLElement;
          const errCls1 = window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP';
          const errCls2 = window.SPOTIFY_CLASSES?.errorContainerAlt || 'bRNotDNzO2suN6vM';

          const match1 = el.classList.contains(errCls1) || el.querySelector('.' + errCls1);
          const match2 = el.classList.contains(errCls2) || el.querySelector('.' + errCls2);
          const text = (el.textContent || '').trim().toLowerCase();
          const hasText = text.length > 0 && !text.includes('loading');

          if ((match1 || match2) && hasText) {
            console.log(`[sly-audit] 🚨 Instant Detection triggered by node <${el.tagName}>. Classes: "${el.className}". Text: "${(el.textContent || '').trim().slice(0, 60)}". Matches: errCls1=${!!match1}, errCls2=${!!match2}`);
            if (typeof window.slyCheckNowPlaying === 'function') window.slyCheckNowPlaying();
            return;
          }
        }
      }
    }
  }
});

// Start observing the main view once it's available
function startErrorObserver(): void {
  const target = getLyricsViewRoot() || document.body;
  errorObserver.observe(target, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startErrorObserver);
} else {
  startErrorObserver();
}

console.log('[sly] Global event observers and instant detection activated.');
