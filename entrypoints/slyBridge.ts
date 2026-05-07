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
  }
}

export default defineUnlistedScript(() => {

/* ============================================================
   SECTION 1 — Bridge Utilities
   Port of: lyric-test/modules/bridge/utils.js
   ============================================================ */

window.slyGetFiber = function (el: Element | null): unknown {
  if (!el) return null;
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  return key ? (el as unknown as Record<string, unknown>)[key] : null;
};

window.slyApplyGeneticLock = function (obj: unknown, prop: string, targetVal: unknown): void {
  if (!obj || typeof obj !== 'object' || !(prop in (obj as object))) return;

  const desc = Object.getOwnPropertyDescriptor(obj as object, prop);
  if (desc && desc.configurable === true && typeof desc.get === 'function') {
    // Already locked
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
  if (props) {
    const signatures = ['toggleLyrics', 'onToggle', 'onClick'];
    for (const sig of signatures) {
      if (typeof props[sig] === 'function') return props[sig] as (...args: unknown[]) => unknown;
    }
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

  // SLY FIX (Bug 27): Search memoizedState (Linked list for hooks)
  let state = f.memoizedState as any;
  while (state && typeof state === 'object') {
    if (state.memoizedValue && typeof state.memoizedValue[targetKey] === 'function') {
      return state.memoizedValue[targetKey];
    }
    // If targetKey is on the state object itself
    if (typeof state[targetKey] === 'function') return state[targetKey];
    state = state.next;
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

    // SLY FIX (Bug 20): Provide default classes for initial scan before sync occurs
    window.SPOTIFY_CLASSES = {
      errorContainer: 'hfTlyhd7WCIk9xmP',
      errorContainerAlt: 'bRNotDNzO2suN6vM',
    } as any;

    // SLY FIX (Bug 21): Initialize to 0 so the first track change is correctly identified.
    window.__sly_track_change_time = 0;

  let lastUri: string | null = null;

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
    const classes = window.SPOTIFY_CLASSES;
    const lineNode = document.querySelector('[data-testid="lyrics-line"]:not(#lyrics-root-sync *)');
    
    // SLY FIX (Bug 20): Use dynamically scavenged classes instead of hardcoded hashes
    const failNode = document.querySelector('.' + classes.errorContainer) || 
                     document.querySelector('.' + classes.errorContainerAlt) || 
                     Array.from(document.querySelectorAll(`main div[style*="--lyrics-color-active"] > div`)).find(el => el.querySelectorAll('[data-testid="lyrics-line"]').length === 0 && el.classList.length > 0);
    
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
      isTimeSynced: !!aggregateState.isTimeSynced,
      syncType: aggregateState.syncType || null,
      isDenseTypeface: aggregateState.isDenseTypeface,
      language: aggregateState.language || null,
      isPanelActive: activeBtn?.getAttribute('data-active') === 'true' || activeBtn?.getAttribute('aria-pressed') === 'true',
      nativeHasLyrics: window.__sly_native_has_lyrics ?? true,
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
  }

  function setupObserver(btn: Element): void {
    if (btnObserver) btnObserver.disconnect();
    btnObserver = new MutationObserver(() => { enforceDOMState(btn); });
    btnObserver.observe(btn, { attributes: true, attributeFilter: ['disabled', 'aria-label'] });
    enforceDOMState(btn);
  }

  window.slyActivateShield = function () {
    if (shieldInterval) return;
    console.log('>>> [sly] Shield Activated (Hybrid Fiber + Observer)');

    shieldInterval = setInterval(() => {
      window.slyScanSpotifyState(); // Merged Scanner
      const btn = document.querySelector('[data-testid="lyrics-button"]');
      const navBar = document.querySelector('[data-testid="now-playing-bar"]');

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

              // Apply the Genetic Lock to this props object
              window.slyApplyGeneticLock(p, 'disabled', false);
              window.slyApplyGeneticLock(p, 'isEnabled', true);
              window.slyApplyGeneticLock(p, 'lyricsHub', true);
              window.slyApplyGeneticLock(p, 'hasLyrics', true);
              didLock = true;
            }

            if (!foundInWalk) {
              const signatures = ['toggleLyrics', 'onToggle', 'onClick'];
              for (const sig of signatures) {
                if (typeof p[sig] === 'function') {
                  // SLY FIX (Bug 22): Skip redundant assignment in loop
                  const handler = p[sig] as (...args: unknown[]) => unknown;
                  if (window.cachedToggleLyrics !== handler) {
                    window.cachedToggleLyrics = handler;
                  }
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
    
    // SLY FIX (Bug 20): Sync scavenged classes from content script
    if (data?.source === 'SLY_SCAVENGER' && data?.type === 'SLY_CLASSES_UPDATE') {
      window.SPOTIFY_CLASSES = { ...window.SPOTIFY_CLASSES, ...data.classes };
    }

    if (data?.source === 'SLY_TRIGGER_NATIVE_OPEN') {
      console.log('>>> [sly] Bridge: Requesting Native Panel Open');

      if (typeof window.cachedToggleLyrics === 'function') {
        console.log('>>> [sly] Bridge: Invoking Native toggleLyrics()');
        window.cachedToggleLyrics();

        // Flicker Guard with detailed logging
        setTimeout(() => {
          const activeBtn = document.querySelector('[data-testid="lyrics-button"]');
          const isPressed = activeBtn?.getAttribute('data-active') === 'true' || activeBtn?.getAttribute('aria-pressed') === 'true';
          console.log(`>>> [sly-audit] Flicker Guard executing. Is active button pressed? ${isPressed}. Attributes: data-active="${activeBtn?.getAttribute('data-active')}", aria-pressed="${activeBtn?.getAttribute('aria-pressed')}"`);
          if (!isPressed) {
            console.warn('>>> [sly-audit] 🚨 Flicker Guard: Button state is not pressed. Re-invoking native toggleLyrics().');
            (window.cachedToggleLyrics as () => void)();
          }
        }, 300);
      } else {
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
