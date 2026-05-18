/**
 * slyBridge.ts
 *
 * WXT unlisted script — compiled to slyBridge.js by Vite.
 * Injected into the page's MAIN world after fetchInterceptor.js.
 * No WXT/browser extension APIs available here — runs in the page's main world.
 *
 * Ports (in execution order):
 *   modules/bridge/utils.js   — Fiber access utilities (window globals)
 *   modules/bridge/scanner.js — React Fiber state scanner (600ms interval)
 *   modules/bridge/shield.js  — Genetic Lock shield (250ms interval)
 *   bridge.js                 — Bridge entry point (wires handlers, activates shield)
 *
 * NOT ported here (already covered by existing entrypoints):
 *   modules/bridge/mxm.js         → lib/mxmClient.ts
 *   modules/bridge/interceptor.js → entrypoints/fetchInterceptor.ts
 */

/* ============================================================
   TypeScript Window interface extensions for all bridge globals
   ============================================================ */
declare global {
  interface Window {
    // Section 1 — Bridge Utilities
    slyGetFiber: (el: Element | null) => unknown;
    slyApplyGeneticLock: (obj: unknown, prop: string, targetVal: unknown) => void;
    slyOmniscientSearch: (
      fiber: unknown,
      targetKey: string,
      visited?: Set<unknown>,
    ) => ((...args: unknown[]) => unknown) | null;
    // Section 2 — Scanner
    slyScanSpotifyState: () => void;
    spotifyState?: Record<string, unknown>;
    __sly_spotify_token?: string;
    __sly_native_has_lyrics?: boolean | undefined;
    __sly_track_change_time?: number;
    // Section 3 — Shield
    slyActivateShield: () => void;
    cachedToggleLyrics: ((...args: unknown[]) => unknown) | null;
    slyConfigPool: Set<unknown>;
    SPOTIFY_CLASSES?: Record<string, string>;
    slyCloseTransitionActive?: boolean;
  }
}

import { 
  captureReturnPoint, 
  performAtomicRelease 
} from '../lib/core/navigationController';

export default defineUnlistedScript(() => {

/* ============================================================
   SECTION 1 — Bridge Utilities
   Port of: lyric-test/modules/bridge/utils.js
   ============================================================ */

/* ============================================================
   SECTION 0 — History Hijack (Safety Guard) - DISABLED
   ============================================================ */
// SLY FIX: History Hijack and Shield were removed to align with native Spotify behavior.
// This ensures that Spotify's history keys (used for scroll restoration) are not corrupted.


window.slyGetFiber = function (el: Element | null): unknown {
  if (!el) return null;
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  return key ? (el as unknown as Record<string, unknown>)[key] : null;
};

window.SPOTIFY_CLASSES = {
  errorContainer: 'hfTlyhd7WCIk9xmP',
};

window.slyApplyGeneticLock = function (obj: unknown, prop: string, targetVal: unknown): void {
  if (!obj || typeof obj !== 'object' || !(prop in (obj as object))) return;

  const desc = Object.getOwnPropertyDescriptor(obj as object, prop);
  if (desc && desc.configurable === false) return;
  if (desc && typeof desc.get === 'function' && desc.configurable === true) {
    // Already has a getter-based lock; check if it's ours or needs update
    try { if (desc.get() === targetVal) return; } catch(e) {}
  }

  try {
    Object.defineProperty(obj as object, prop, {
      get: () => targetVal,
      set: () => {},
      configurable: true,
      enumerable: true,
    });
  } catch (_e) {}
};

window.slyOmniscientSearch = function (
  fiber: unknown,
  targetKey: string,
  visited: Set<unknown> = new Set(),
): ((...args: unknown[]) => unknown) | null {
  if (!fiber || visited.has(fiber)) return null;
  visited.add(fiber);

  const f = fiber as Record<string, unknown>;
  const props = f.memoizedProps as Record<string, unknown> | undefined;
  
  // SLY FIX: Actually use the targetKey instead of a hardcoded list.
  // This prevents trapping generic bar-level onClick handlers that cause redirects.
  if (props && typeof props[targetKey] === 'function') {
    return props[targetKey] as (...args: unknown[]) => unknown;
  }

  if (f.dependencies) {
    const deps = f.dependencies as Record<string, unknown>;
    let ctx = deps.firstContext as Record<string, unknown> | null;
    while (ctx) {
      if (ctx.memoizedValue && typeof (ctx.memoizedValue as Record<string, unknown>)[targetKey] === 'function') {
        return (ctx.memoizedValue as Record<string, unknown>)[targetKey] as (...args: unknown[]) => unknown;
      }
      ctx = ctx.next as Record<string, unknown> | null;
    }
  }

  let child = f.child as unknown;
  while (child) {
    const found = window.slyOmniscientSearch(child, targetKey, visited);
    if (found) return found;
    child = (child as Record<string, unknown>).sibling;
  }
  return null;
};

  /* ============================================================
     SECTION 2 — Scanner Module (Genetic Shield)
     Port of: lyric-test/modules/bridge/scanner.js
     ============================================================ */
  (function () {
    console.log('>>> [sly] Bridge: Scanner Module Booting...');

    // BUG-21 Fix: Initialize the track change timestamp on load so the first song 
    // played in the session has a valid grace period for DOM discovery.
    window.__sly_track_change_time = Date.now();

  let lastUri: string | null = null;
  let lastPath = window.location.pathname;

  function findComponentProps(
    fiber: unknown,
    targetKeys: string[],
    any = false,
    depth = 0,
  ): Record<string, unknown> | null {
    if (!fiber || depth > 50) return null;
    const f = fiber as Record<string, unknown>;
    const props = f.memoizedProps as Record<string, unknown> | undefined;
    if (props) {
      const matches = targetKeys.filter(k => k in props);
      if (any ? matches.length > 0 : matches.length === targetKeys.length) return props;
    }
    return findComponentProps(f.return, targetKeys, any, depth + 1);
  }

  window.slyScanSpotifyState = function () {
    // SLY FIX: Only reset cachedToggleLyrics if it's currently orphaned (no button in DOM).
    // This prevents a race where the scanner wipes a handler just found by the shield.
    if (!document.querySelector('[data-testid="lyrics-button"]')) {
      window.cachedToggleLyrics = null;
    }

    const lineNode = Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
      .find(el => !el.closest('#lyrics-root-sync'));
    
    const errorCls = window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP';

    const failNode = document.querySelector('.' + errorCls) || 
                     document.querySelector('.bRNotDNzO2suN6vM') || 
                     Array.from(document.querySelectorAll('main div[style*="--lyrics-color-active"]:not(#lyrics-root-sync) > div'))
                       .find(el => el.querySelectorAll('[data-testid="lyrics-line"]').length === 0 && el.classList.length > 0);
    const trackNode = document.querySelector('[data-testid="context-item-info-title"]');
    const activeBtn = document.querySelector('[data-testid="lyrics-button"]');

    const aggregateState: Record<string, unknown> = {
      track: null, provider: undefined, syncType: undefined,
      isTimeSynced: undefined, isDenseTypeface: undefined, language: undefined,
    };

    if (trackNode) {
      const fiber = window.slyGetFiber(trackNode);
      const props = findComponentProps(fiber, ['item', 'track', 'currentTrack'], true);
      if (props) aggregateState.track = props.item || props.track || props.currentTrack || null;
    }

    const lyricsAnchor = lineNode || failNode || document.querySelector('#main-view');
    if (lyricsAnchor) {
      let fiber = window.slyGetFiber(lyricsAnchor) as Record<string, unknown> | null;
      let depth = 0;
      while (fiber && depth < 40) {
        const props = fiber.memoizedProps as Record<string, unknown> | undefined;
        if (props) {
          const d = props.data as Record<string, unknown> | undefined;
          if (aggregateState.provider === undefined) aggregateState.provider = props.provider || props.lyricsProvider || d?.provider;
          if (aggregateState.syncType === undefined) aggregateState.syncType = props.syncType || d?.syncType;
          if (aggregateState.isTimeSynced === undefined) aggregateState.isTimeSynced = props.isTimeSynced || d?.isTimeSynced;
          if (aggregateState.isDenseTypeface === undefined) aggregateState.isDenseTypeface = props.isDenseTypeface || d?.isDenseTypeface;
          if (aggregateState.language === undefined) aggregateState.language = props.language || d?.language;
        }
        fiber = fiber.return as Record<string, unknown> | null;
        depth++;
      }
    }

    const gracePeriod = 1500;
    const timeSinceChange = Date.now() - (window.__sly_track_change_time || 0);
    const inGrace = timeSinceChange < gracePeriod;

    const state: Record<string, unknown> = {
      type: 'SLY_TRACK_UPDATE',
      track: aggregateState.track,
      accessToken: window.__sly_spotify_token,
      lyricsProvider: aggregateState.provider || null,
      isTimeSynced: aggregateState.isTimeSynced,
      syncType: aggregateState.syncType || null,
      isDenseTypeface: aggregateState.isDenseTypeface,
      language: aggregateState.language || null,
      isPanelActive: activeBtn?.getAttribute('data-active') === 'true' || activeBtn?.getAttribute('aria-pressed') === 'true',
      nativeHasLyrics: window.__sly_native_has_lyrics ?? false, // BUG-31.1 Fix: Default to false to avoid standing down on tracks without lyrics
      detectionMethod: inGrace ? 'Grace Period (Default)' : 'Fiber Prop (Definitive)',
      lastBridgeChangeTime: Date.now(),
    };

    if (!state.accessToken) {
      const targets = ['#main', '#main-view', 'body'];
      for (const t of targets) {
        const el = document.querySelector(t);
        if (!el) continue;
        const fiber = window.slyGetFiber(el);
        const props = findComponentProps(fiber, ['accessToken'], true);
        if (props?.accessToken) { state.accessToken = props.accessToken; break; }
      }
    }

    let queueMetadata: unknown[] | null = null;
    const mainView = document.querySelector('#main-view') || document.querySelector('#main') || document.body;
    if (mainView) {
      const fiber = window.slyGetFiber(mainView);
      const queueProps = findComponentProps(fiber, ['queue', 'next_tracks', 'nextItems'], true);
      if (queueProps) {
        const q = queueProps as Record<string, unknown>;
        const qObj = q.queue as Record<string, unknown> | undefined;
        const next = (qObj?.next_tracks || q.next_tracks || q.nextItems) as unknown[] | undefined;
        if (Array.isArray(next) && next.length > 0) {
          queueMetadata = next.map((t: unknown) => {
            const track = t as Record<string, unknown>;
            const album = track.album as Record<string, unknown> | undefined;
            const meta = track.metadata as Record<string, string> | undefined;
            const artists = track.artists as Record<string, string>[] | undefined;
            return {
              id: track.id || (track.uri as string)?.split(':').pop(),
              title: track.name,
              artist: artists?.[0]?.name,
              albumArtUrl: (album?.images as unknown[])?.[0] || meta?.image_url,
            };
          });
          if (queueMetadata.length > 0 && (!window.spotifyState?.queue || (window.spotifyState.queue as unknown[]).length !== queueMetadata.length)) {
            console.log(`[sly-scanner] Discovered ${queueMetadata.length} items in local queue.`);
          }
        }
      }
    }

    if (state.accessToken && !window.__sly_spotify_token) {
      console.log('>>> [sly] Spotify Access Token Captured.');
      window.__sly_spotify_token = state.accessToken as string;
    }

    if (queueMetadata) state.queue = queueMetadata;

    const track = aggregateState.track as Record<string, unknown> | null;
    if (track && track.uri !== lastUri) {
      lastUri = track.uri as string;
      window.__sly_native_has_lyrics = undefined;
      window.__sly_track_change_time = Date.now();

      // SLY FIX: Instantly notify the Interceptor (via Background) of the new track's metadata.
      // This eliminates the 3s timeout window where the Interceptor is 'blind' while waiting for DOM updates.
      const trackId = (track.uri as string).split(':').pop();
      if (trackId && track.name) {
          window.postMessage({ 
              type: 'SLY_MXM_NOTIFY_METADATA', 
              payload: { trackId, name: track.name, artist: (track.artists as any)?.[0]?.name || 'Unknown' } 
          }, '*');
      }
    }

    // Context-Aware Return Memory
    const currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      captureReturnPoint(currentPath, lastPath);
      lastPath = currentPath;
    }

    window.postMessage({ source: 'SLY_BRIDGE', data: state }, '*');
  };

  // Scanner interval merged into shield loop (Section 3)
  })();

/* ============================================================
   SECTION 3 — Shield
   Port of: lyric-test/modules/bridge/shield.js
   ============================================================ */

(function () {
  console.log('>>> [sly] Shield Module Loading (Hybrid Mode 5.0)...');

  let shieldInterval: ReturnType<typeof setInterval> | null = null;
  let lastLogSig = '';
  let lastLogDepth = -1;
  let btnObserver: MutationObserver | null = null;

  window.cachedToggleLyrics = null;
  window.slyConfigPool = new Set();

  /**
   * TOTAL RECALL: Recursively scans the React fiber tree to find objects
   * that contain configuration properties related to lyrics.
   */
  function totalRecall(fiber: unknown, visited: Set<unknown> = new Set()): void {
    if (!fiber || visited.has(fiber)) return;
    visited.add(fiber);

    const f = fiber as Record<string, unknown>;

    const scan = (obj: unknown) => {
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        window.slyConfigPool.add(obj);
      }
    };

    scan(f.memoizedProps);

    if (f.dependencies) {
      const deps = f.dependencies as Record<string, unknown>;
      let ctx = deps.firstContext as Record<string, unknown> | null;
      while (ctx) {
        scan(ctx.memoizedValue);
        ctx = ctx.next as Record<string, unknown> | null;
      }
    }

    let child = f.child as unknown;
    while (child) {
      totalRecall(child, visited);
      child = (child as Record<string, unknown>).sibling;
    }
  }

  function enforceDOMState(btn: Element): void {
    const b = btn as HTMLButtonElement;
    if (b.disabled) b.disabled = false;
    if (b.hasAttribute('disabled')) {
      b.removeAttribute('disabled');
      b.style.opacity = '1';
      b.style.pointerEvents = 'auto';
      b.style.cursor = 'pointer';
    }
    if (b.getAttribute('aria-label') !== 'Lyrics') {
      b.setAttribute('aria-label', 'Lyrics');
    }

    // SLY FIX (BUG-C18): Re-apply Genetic Lock immediately on DOM mutation.
    // React often replaces the memoizedProps object during reconciliation; linking re-locking
    // to the MutationObserver microtask eliminates the "disabled flash" that occurs 
    // when waiting for the 500ms setInterval macrotask.
    let node = window.slyGetFiber(btn) as Record<string, unknown> | null;
    let depth = 0;
    while (node && depth < 35) {
      const p = node.memoizedProps as Record<string, unknown> | undefined;
      if (p && ('disabled' in p || 'isEnabled' in p || 'hasLyrics' in p)) {
        window.slyApplyGeneticLock(p, 'disabled', false);
        window.slyApplyGeneticLock(p, 'isEnabled', true);
        window.slyApplyGeneticLock(p, 'hasLyrics', true);
        break;
      }
      node = node.return as Record<string, unknown> | null;
      depth++;
    }
  }

  function setupObserver(btn: Element): void {
    if (btnObserver) btnObserver.disconnect();
    
    // BUG-C18: Observe the Now Playing Bar or parent container to catch button replacements.
    // React often replaces the entire element node; observing a stable parent ensures 
    // we re-apply the shield as soon as a new button appears.
    const target = btn.closest('[data-testid="now-playing-bar"]') || btn.parentElement || btn;

    try {
      btnObserver = new MutationObserver(() => { 
        const currentBtn = document.querySelector('[data-testid="lyrics-button"]');
        if (currentBtn) enforceDOMState(currentBtn); 
      });
      btnObserver.observe(target, { 
        childList: target !== btn, 
        subtree: target !== btn,
        attributes: true, 
        attributeFilter: ['disabled', 'aria-label'] 
      });
      enforceDOMState(btn);
    } catch (e) {
      console.error('[sly-shield] MutationObserver setup failed:', e);
    }
  }

  window.slyActivateShield = function () {
    if (shieldInterval) return;
    console.log('>>> [sly] Shield Activated (Hybrid Fiber + Observer)');

    shieldInterval = setInterval(() => {
      // SLY FIX: Stand down during close transitions to prevent lock-fighting or double-open flickers.
      // Auto-reset when pathname is no longer '/lyrics'.
      const isPathLyrics = window.location.pathname.startsWith('/lyrics');
      if (!isPathLyrics && window.slyCloseTransitionActive) {
        window.slyCloseTransitionActive = false;
      }
      if (window.slyCloseTransitionActive) {
        return;
      }

      window.slyScanSpotifyState(); // Merged Scanner
      const btn = document.querySelector('[data-testid="lyrics-button"]');
      const navBar = document.querySelector('[data-testid="now-playing-bar"]');

      if (navBar) {
        const barFiber = window.slyGetFiber(navBar);
        totalRecall(barFiber);
      }

      if (btn) {
        const btnAny = btn as unknown as Record<string, unknown>;
        if (!btnAny.__sly_observed) {
          setupObserver(btn);
          btnAny.__sly_observed = true;
        }

        let node = window.slyGetFiber(btn) as Record<string, unknown> | null;
        let depth = 0;
        let foundInWalk = false;
        let didLock = false;

        while (node && depth < 35) {
          const p = node.memoizedProps as Record<string, unknown> | undefined;
          if (p) {
            // Check if this node contains lyrics configuration properties
            const hasLockable = 'disabled' in p || 'isEnabled' in p || 'lyricsHub' in p || 'hasLyrics' in p;

            if (!didLock && hasLockable) {
              // NATIVE CAPABILITY DETECTION (Pre-Lock)
              // We check the original value before our lock takes over.
              const desc = Object.getOwnPropertyDescriptor(p, 'disabled');
              const isNativelyDisabled = (desc && typeof desc.get === 'function') ? undefined : p.disabled;

              if (isNativelyDisabled !== undefined) {
                const gracePeriod = 1500;
                const timeSinceChange = Date.now() - (window.__sly_track_change_time || 0);
                // Only report "No Lyrics" (disabled: true) after the grace period.
                // "Has Lyrics" (disabled: false) is reported immediately.
                if (!isNativelyDisabled) {
                  window.__sly_native_has_lyrics = true;
                } else if (timeSinceChange > gracePeriod) {
                  window.__sly_native_has_lyrics = false;
                }
              }

              // SLY PATH-AWARENESS FIX: 
              // We should only enforce "Active" locks if the user is actually on the lyrics route.
              // If we lock 'isActive: true' while navigating away, Spotify's router crashes.
              const isPathLyrics = window.location.pathname.startsWith('/lyrics');

              // Apply the Genetic Lock to this props object
              if (isPathLyrics) {
                window.slyApplyGeneticLock(p, 'isActive', true);
                window.slyApplyGeneticLock(p, 'aria-pressed', true);
              }
              
              window.slyApplyGeneticLock(p, 'disabled', false);
              window.slyApplyGeneticLock(p, 'isEnabled', true);
              window.slyApplyGeneticLock(p, 'lyricsHub', true);
              window.slyApplyGeneticLock(p, 'hasLyrics', true);
              didLock = true;
            }

            if (!foundInWalk) {
              // SLY FIX: Added 'onToggle' to priority signatures based on diag2.txt.
              // We also prioritize toggleLyrics/onToggle over onClick for better precision.
              const signatures = ['toggleLyrics', 'onToggle', 'onClick'];
              for (const sig of signatures) {
                if (typeof p[sig] === 'function') {
                  window.cachedToggleLyrics = p[sig] as (...args: unknown[]) => unknown;
                  foundInWalk = true;
                  if (sig !== lastLogSig || depth !== lastLogDepth) {
                    console.log(`>>> [sly] Trapped Toggle Signature: ${sig} at Depth ${depth}`);
                    lastLogSig = sig;
                    lastLogDepth = depth;
                  }
                  break;
                }
              }
            }
          }
          // Optimization: Break early if we've successfully applied the lock AND found the toggle handler.
          if (foundInWalk && didLock) break;
          node = node.return as Record<string, unknown> | null;
          depth++;
        }

        // Omniscient Discovery (Backup)
        if (!foundInWalk && navBar) {
          const barFiber = window.slyGetFiber(navBar);
          // SLY FIX: Prioritize 'toggleLyrics' and 'onToggle' over generic 'onClick'
          const signatures = ['toggleLyrics', 'onToggle'];
          for (const sig of signatures) {
            const found = window.slyOmniscientSearch(barFiber, sig);
            if (found) {
              console.log(`>>> [sly] Omniscient Discovery Success: ${sig} found in Bar Tree.`);
              window.cachedToggleLyrics = found;
              foundInWalk = true;
              break;
            }
          }
        }
      }

      // Pool Correction (Genetic Shield)
      window.slyConfigPool.forEach(obj => {
        if ('lyricsHub' in (obj as object)) {
          window.slyApplyGeneticLock(obj, 'lyricsHub', true);
        }
      });
      // 3. Genetic Lock Health Monitor
      if (btn) {
        const initialFiber = window.slyGetFiber(btn) as Record<string, unknown> | null;
        if (initialFiber?.memoizedProps) {
          const props = initialFiber.memoizedProps as object;
          if ('disabled' in props) {
            const desc = Object.getOwnPropertyDescriptor(props, 'disabled');
            if (!desc || desc.configurable !== true || typeof desc.get !== 'function') {
              console.error('%c[SKaraoke:Bridge] Genetic Lock compromised! Spotify modified properties.', 'color: red; font-size: 14px; font-weight: bold;');
            }
          }
        }
      }

    }, 500); // Merged loop: 500ms coordinates directly with antigravity interval

    // Periodic Deep Scan (Total Recall)
    setInterval(() => {
      const navBar = document.querySelector('[data-testid="now-playing-bar"]');
      if (navBar) {
        const fiber = window.slyGetFiber(navBar);
        if (fiber) totalRecall(fiber);
      }
    }, 10000);
  };
})();

/* ============================================================
   SECTION 4 — Bridge Entry
   Port of: lyric-test/bridge.js
   ============================================================ */

(function () {
  console.log('>>> [sly] Bridge Entry (Phase 5.1 - Native Grace)');

  // --- NATIVE TRIGGER HANDLER ---
  window.addEventListener('message', (event) => {
    const data = event.data as Record<string, any>;
    
    if (data?.source === 'SLY_UPDATE_CLASSES') {
      window.SPOTIFY_CLASSES = { ...window.SPOTIFY_CLASSES, ...data.classes };
      return;
    }

    if (data?.source === 'SLY_TRIGGER_NATIVE_CLOSE') {
      console.log('>>> [sly] Bridge: Requesting Safe Native Panel Close');
      
      // Set transition guard to disable the Genetic Lock during slide out
      window.slyCloseTransitionActive = true;

      // 1. Kill Intervals
      if (window.slyScannerInterval) clearInterval(window.slyScannerInterval);
      if (window.slyShieldInterval) clearInterval(window.slyShieldInterval);
      window.slyScannerInterval = null;
      window.slyShieldInterval = null;

      // 2. MODULAR RELEASE: Nukes locks and performs context-aware atomic navigation
      performAtomicRelease(window.slyConfigPool);
      return;
    }

    if (data?.source === 'SLY_TRIGGER_NATIVE_OPEN') {
      console.log('>>> [sly] Bridge: Requesting Native Panel Open');

      // Clear transition guard immediately so locks can take effect
      window.slyCloseTransitionActive = false;

      if (typeof window.cachedToggleLyrics === 'function') {
        console.log('>>> [sly] Bridge: Invoking Native toggleLyrics()');
        window.cachedToggleLyrics();

        // SMOOTH TRANSITION FIX: Tapered Flicker Guard from 300ms to 100ms.
        // Before: Waited 300ms to verify if the native toggleLyrics() call succeeded.
        // After: Waits 100ms.
        // Why: 300ms is too close to the human reaction time for a double-click; reducing it to 100ms
        // ensures that if Spotify's UI misses the first call, we catch it faster without
        // fighting the user's manual attempts to close the panel.
        setTimeout(() => {
          const activeBtn = document.querySelector('[data-testid="lyrics-button"]');
          const isPressed = activeBtn?.getAttribute('data-active') === 'true' || activeBtn?.getAttribute('aria-pressed') === 'true';
          console.log(`>>> [sly-audit] Flicker Guard executing. Is active button pressed? ${isPressed}. Attributes: data-active="${activeBtn?.getAttribute('data-active')}", aria-pressed="${activeBtn?.getAttribute('aria-pressed')}"`);
          if (!isPressed) {
            console.warn('>>> [sly-audit] 🚨 Flicker Guard: Button state is not pressed. Re-invoking native toggleLyrics().');
            (window.cachedToggleLyrics as () => void)();
          }
        }, 100);
      } else {
        // SLY FIX: If we are already on /lyrics, DO NOT pushState again.
        // This prevents the weird NTP redirect if Spotify's router is in a fragile state.
        if (window.location.pathname === '/lyrics') {
          console.warn('>>> [sly] Bridge: toggleLyrics not found, but already on /lyrics. Aborting fallback navigation.');
          return;
        }

        console.error('>>> [sly] Bridge: toggleLyrics not found. Safe-routing to /lyrics');
        history.pushState(null, '', '/lyrics');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }
  });

  // Start Modules
  if (typeof window.slyActivateShield === 'function') {
    window.slyActivateShield();
  }

  // Note: Scanner starts itself in Section 2 above (setInterval at module load)
})();

}); // end defineUnlistedScript
