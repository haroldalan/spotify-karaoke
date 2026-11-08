import { getLyricsViewRoot } from '../dom/domQueries';
import { kickWhenPanelMounts } from '../dom/songTransition';
import { isContextValid } from '../utils/browserUtils';
import { findActiveViewport } from '../core/navigationController';
import { closeIntentOverlay, isClosingPress, openIfSpotifyDoesNot } from './nowPlayingOpener';
import { isLyricsIntentSessionActive } from '../dom/domQueries';
// Port of: lyric-test/modules/core/events.js
/* modules/content-events.js: Global Event Observers (Navigation & Interactions) */

// --- NAVIGATION INTERCEPTOR ---
// SLY FIX (BUG-B1): The history patch has been moved to slyBridge.ts (MAIN world)
// to correctly intercept Spotify's pushState. This listener bridges the signal 
// back to the isolated world.
window.addEventListener('message', (event) => {
  if (event.data?.source === 'SLY_NAV_CHANGE') {
    window.dispatchEvent(new Event('sly_nav_change'));
  }
});

// --- GLOBAL INTERACTION MONITORING ---
// Tracks user scrolling to pause auto-scrolling of lyrics
const interactionOptions = { passive: true, capture: true };

function handleUserInteraction(e: Event): void {
  const lyricsRoot = (window.slyInternalState.customRoot as HTMLElement | null)
    ?? document.getElementById('lyrics-root-sync');
  if (lyricsRoot && e.target && lyricsRoot.contains(e.target as Node)) {
    window.slyInternalState.isUserScrolling = true;
    
    // Auto-resume timeout removed as per new UX requirements. 
    // Resume only on scroll-back-to-view or Sync button click.
    if (window.slyInternalState.userScrollTimeout) {
      clearTimeout(window.slyInternalState.userScrollTimeout);
      window.slyInternalState.userScrollTimeout = undefined;
    }
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
    
    // SLY FIX: Set intent cooldown to prevent "re-opening flicker" when closing panels.
    // If we are CLOSING, set a 1000ms shield. If we are OPENING, clear it instantly.
    if (isPressed) {
      console.log('[sly-audit] Panel close intent → Setting 1000ms cooldown shield.');
      window.slyInternalState.panelIntentCooldown = Date.now() + 1000;
    } else {
      window.slyInternalState.panelIntentCooldown = 0;
    }

    const provider = window.spotifyState?.lyricsProvider;
    const label = btn.getAttribute('aria-label');
    console.log(`[sly-audit] 🖱️ Lyrics Button Pointerdown captured. IsPressed: ${isPressed}, Provider: ${provider}, Label: "${label}"`);

    // 2026 UI (fiber-verified): lyrics-button fiber chain carries only generic
    // onClick handlers (depths 8-11), no toggleLyrics/onToggle. The bridge's
    // omniscient search therefore traps a generic mode:"panel" toggle — invoking
    // it opens the wrong sidebar tab (queue). Native onClick opens lyrics correctly.
    // Rule: hijack CLOSE only (isPressed). Never hijack OPEN; let native onClick run.
    const shouldHijack = isPressed;
    if (shouldHijack) {
      // SLY FIX: Even if the button is already pressed, we MUST hijack the event.
      // Letting Spotify handle the "close" naturally is what triggers the New Tab Page redirect
      // because Spotify's native DOM click handler crashes when our Genetic Lock is active.
      e.preventDefault();
      e.stopPropagation();

      const intent = isPressed ? 'SLY_TRIGGER_NATIVE_CLOSE' : 'SLY_TRIGGER_NATIVE_OPEN';
      const viewport = findActiveViewport();
      const scrollPos = viewport ? viewport.scrollTop : 0;
      
      if (!isPressed) {
        // Capture scroll BEFORE opening lyrics
        console.log(`[sly-audit] Proactively saving scroll position: ${scrollPos}px`);
        sessionStorage.setItem('sly_return_point_scroll', scrollPos.toString());
      }

      console.log(`[sly-audit] Hijacking event to prevent Spotify navigation hijack. Intent: ${intent} | Current Scroll: ${scrollPos}px`);
      window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: intent } }, '*');
    } else {
      console.log('[sly-audit] Not hijacking OPEN (only CLOSE is hijacked); Spotify\'s native onClick opens the lyrics overlay.');
    }
  }
}, true); // Use capture phase to beat React's internal listeners

// For a track Spotify has no lyrics for, its click opens nothing: open the expanded Now
// Playing view instead, where the extension shows its own lyrics. On click (not
// pointerdown) so Spotify's own handler has run first; keyboard activation counts too.
// Capture phase: the attributes still show the state before this click.
document.addEventListener('click', (e: Event) => {
  const btn = (e.target as HTMLElement | null)?.closest?.('[data-testid="lyrics-button"]');
  if (!btn) return;
  // Pressed again while the expanded view the extension opened is up: close it.
  if (isLyricsIntentSessionActive()) {
    setTimeout(() => { if (isLyricsIntentSessionActive()) closeIntentOverlay(); }, 300);
    return;
  }
  const isPressed = btn.getAttribute('data-active') === 'true' || btn.getAttribute('aria-pressed') === 'true';
  if (!isPressed && !isClosingPress()) openIfSpotifyDoesNot();
}, true);

// --- LYRICS PANEL CLOSE DETECTOR ---
// Dispatches 'sly:panel_close' when [data-testid="lyrics-button"] loses data-active="true".
// This is the sole trigger for content.ts to remove #lyrics-root-sync and clean up sly-active.
//
// Implementation note: React may replace the button node entirely during SPA navigation,
// so we maintain a buttonFinderObserver that re-attaches the attribute watcher whenever
// a new button instance appears in the DOM.

let lyricsButtonObserver: MutationObserver | null = null;
let observedButton: Element | null = null;

/** How long Spotify gets to remove its view after the lyrics button turns inactive. */
export const CLOSE_SETTLE_MAX_MS = 800;
let closeWait: MutationObserver | null = null;
let closeWaitTimer: ReturnType<typeof setTimeout> | null = null;

const overlayOnScreen = (): boolean => !!document.querySelector('button[role="radio"][value="lyrics"]');

/**
 * The button turns inactive ~50 ms before Spotify removes its view (live 2026-11). Cleaning
 * up at once took the pill away and showed Spotify's own panel behind ours for those
 * frames. The cleanup waits until the view is gone (everything then leaves together), or
 * CLOSE_SETTLE_MAX_MS when it stays (another media option chosen): then as before.
 */
// The view opened: kickWhenPanelMounts (songTransition.ts) runs the check as soon as
// Spotify's lyrics panel is mounted, instead of at the next poll tick.
const checkWhenPanelMounts = kickWhenPanelMounts;
export { OVERLAY_PANEL_SELECTOR } from '../dom/songTransition';

function dispatchPanelCloseWhenGone(btn: HTMLElement): void {
  if (closeWait) closeWait.disconnect();
  if (closeWaitTimer) clearTimeout(closeWaitTimer);
  closeWait = null;
  closeWaitTimer = null;
  // The current button: Spotify may have swapped it (reopened on a new node) meanwhile.
  const stillClosed = () => !buttonIsActive(document.querySelector('[data-testid="lyrics-button"]') ?? btn);
  const fire = () => {
    if (closeWait) closeWait.disconnect();
    if (closeWaitTimer) clearTimeout(closeWaitTimer);
    closeWait = null;
    closeWaitTimer = null;
    if (stillClosed()) document.dispatchEvent(new CustomEvent('sly:panel_close'));
  };
  if (!overlayOnScreen()) { fire(); return; }
  closeWait = new MutationObserver(() => { if (!overlayOnScreen()) fire(); });
  closeWait.observe(document.body, { childList: true, subtree: true });
  closeWaitTimer = setTimeout(fire, CLOSE_SETTLE_MAX_MS);
}

/** The lyrics button's last known state (any node); null before the first button. */
let lastButtonActive: boolean | null = null;
const buttonIsActive = (btn: Element): boolean =>
  btn.getAttribute('data-active') === 'true' || btn.getAttribute('aria-pressed') === 'true';

function onButtonState(btn: HTMLElement): void {
  const active = buttonIsActive(btn);
  if (lastButtonActive === true && !active) {
    console.log('[sly] Panel close detected via lyrics button observer → dispatching sly:panel_close');
    dispatchPanelCloseWhenGone(btn);
  } else if (lastButtonActive === false && active) {
    checkWhenPanelMounts();
  }
  lastButtonActive = active;
}

function attachLyricsButtonObserver(): void {
  const btn = document.querySelector('[data-testid="lyrics-button"]');
  if (!btn || btn === observedButton) return; // already watching this exact node

  // Disconnect from any previously observed (now stale) button node
  if (lyricsButtonObserver) {
    lyricsButtonObserver.disconnect();
    lyricsButtonObserver = null;
  }

  observedButton = btn;
  // Spotify swaps the button on close (the new one inactive) and again on open (the new
  // one born active, live 2026-11): an open then has no attribute change at all, so the
  // state is compared across button nodes.
  onButtonState(btn as HTMLElement);

  // Spotify flips both attributes in one render: one decision per batch, not per record
  // (two records sent two closes when the view was already gone).
  lyricsButtonObserver = new MutationObserver((mutations) => {
    const relevant = mutations.filter(m => m.type === 'attributes' && (m.attributeName === 'data-active' || m.attributeName === 'aria-pressed'));
    if (relevant.length) onButtonState(btn as HTMLElement);
  });

  lyricsButtonObserver.observe(btn, {
    attributes: true,
    attributeFilter: ['data-active', 'aria-pressed'],
    attributeOldValue: true,
  });
  console.log('[sly] Lyrics button observer attached.');
}

// Observe the DOM for the lyrics button's first appearance (or re-appearance after React reconciliation).
//
// Spotify replaces the button node right after the view closes (live 2026-11), so the
// finder must see changes deep inside the now-playing bar. The script runs at
// document_start, before the bar exists: watching the body without subtree (the old
// fallback) never saw a replacement, so close and reopen went unnoticed until the poll.
// The finder watches the whole body only until the bar exists, then just the bar.
let finderTarget: Element | null = null;
const NOW_PLAYING_BAR = '[data-testid="now-playing-bar"]';

function retargetButtonFinder(): void {
  const bar = document.querySelector(NOW_PLAYING_BAR);
  const target = bar ?? document.body;
  if (!target || target === finderTarget) return;
  buttonFinderObserver.disconnect();
  finderTarget = target;
  buttonFinderObserver.observe(target, { childList: true, subtree: true });
}

const buttonFinderObserver = new MutationObserver(() => {
  if (!isContextValid()) {
    buttonFinderObserver.disconnect();
    return;
  }
  // Narrow to the bar once it exists; back to the body if the bar itself was replaced.
  if (finderTarget === document.body || !finderTarget?.isConnected) retargetButtonFinder();
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
  retargetButtonFinder();
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
