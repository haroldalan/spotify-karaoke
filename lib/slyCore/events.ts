// Port of: lyric-test/modules/core/events.js
/* modules/content-events.js: Global Event Observers (Navigation & Interactions) */

// --- NAVIGATION INTERCEPTOR ---
function wrapHistory(): void {
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
  if (window.slyInternalState.customRoot && window.slyInternalState.customRoot.contains(e.target as Node)) {
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
    // Only hijack if Spotify has no lyrics provider, or if the button is in its default state
    if (window.spotifyState.lyricsProvider === null || btn.getAttribute('aria-label') === 'Lyrics') {
      // If the panel is already open (active), let Spotify handle the close naturally
      if (btn.getAttribute('data-active') === 'true') return;

      console.log(`[sly] Hijack Pointer Detected | Provider: ${window.spotifyState.lyricsProvider}`);

      // Post a message to the Main World (bridge.js) to trigger the native toggle
      window.postMessage({ source: 'SLY_TRIGGER_NATIVE_OPEN' }, '*');

      // Prevent the default React event which might lead to a blank page or error boundary
      e.preventDefault();
      e.stopPropagation();

      // Trigger a navigation event to force our decision engine to re-evaluate immediately
      window.dispatchEvent(new Event('sly_nav_change'));
    }
  }
}, true); // Use capture phase to beat React's internal listeners

// --- INSTANT ERROR DETECTION ---
// Monitors for the specific "Lyrics not available" node to bypass polling delays
const errorObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length) {
      const hasError = Array.from(mutation.addedNodes).some(node =>
        node.nodeType === 1 && ((node as HTMLElement).classList.contains('hfTlyhd7WCIk9xmP') || (node as HTMLElement).querySelector('.hfTlyhd7WCIk9xmP'))
      );
      if (hasError) {
        console.log('[sly] Instant Detection: Native error DOM appeared. Triggering engine...');
        if (typeof window.slyCheckNowPlaying === 'function') window.slyCheckNowPlaying();
        break;
      }
    }
  }
});

// Start observing the main view once it's available
function startErrorObserver(): void {
  const target = document.querySelector('.B0fBZOXNHNc2YVYO') || document.body;
  errorObserver.observe(target, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startErrorObserver);
} else {
  startErrorObserver();
}

console.log('[sly] Global event observers and instant detection activated.');
