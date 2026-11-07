/**
 * slyBridge.ts
 *
 * WXT unlisted script — compiled to slyBridge.js by Vite.
 * Injected into the page's MAIN world after fetchInterceptor.js.
 * No WXT/browser extension APIs available here — runs in the page's main world.
 *
 * Ports (in execution order):
 *   modules/bridge/utils.js   — Fiber access utilities (window globals)
 *   modules/bridge/scanner.js — React Fiber state scanner (500ms interval)
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
    // NOTE: window.spotifyState is an ISOLATED-world global (lib/slyCore/state.ts);
    // it does not exist in this MAIN-world script, so it is deliberately not declared here.
    slyScanSpotifyState: () => void;
    __sly_spotify_token?: string;
    __sly_native_has_lyrics?: boolean | undefined;
    __sly_track_change_time?: number;
    // Section 3 — Shield
    slyActivateShield: () => void;
    slyDeactivateShield: () => void;
    cachedToggleLyrics: ((...args: unknown[]) => unknown) | null;
    SPOTIFY_CLASSES?: Record<string, string>;
    slyCloseTransitionActive?: boolean;
  }
}

import { 
  captureReturnPoint, 
  performAtomicRelease 
} from '../lib/core/navigationController';
import { getThemedPanelContainer, NOW_PLAYING_WIDGET } from '../lib/dom/domQueries';
import type { SlyAction } from '../lib/core/lyricsTypes';

export default defineUnlistedScript(() => {
  function dispatchSlyAction(action: SlyAction): void {
    window.postMessage({ source: 'SLY_ACTION_GATEWAY', action }, '*');
  }


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
  // Bridge-local memory of the last discovered queue size (window.spotifyState is
  // isolated-world only and always undefined here).
  let lastQueueLength = -1;

  // Now Playing view (right sidebar) lyrics preview. Its lines carry the same lyric
  // fiber props but must only be used when the full panel has no lines. The id and
  // data-testid are locale-independent; the aria-label is localized.
  const NPV_PREVIEW_ANCESTORS =
    'aside[aria-label="Now playing view"], aside.NowPlayingView, #Desktop_PanelContainer_Id, [data-testid="lyrics-npv-section"]';

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

  /* ---- Current-track resolution ----------------------------------------------
     2026-11 web player: [data-testid="context-item-info-title"] is gone and the widget
     is [data-testid="now-playing-widget-v2"]. Verified fiber facts (overlay open and closed):
     - the now-playing-bar's parent fiber (depth 1) carries `entityUri: 'spotify:track:<id>'`;
       the same props are reachable from the widget (~19) and the lyrics button (~27);
     - the widget / bar / button chains carry NO `item` / `track` object;
     - a full-panel lyric line carries `item` (depths 11, 19, 20) and
       `nowPlayingState.item` (~42), but only while the overlay is open. */
  const TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]+$/;
  const isTrackUri = (v: unknown): v is string => typeof v === 'string' && TRACK_URI_RE.test(v);

  // Anchors that may carry a full track object, legacy UI first.
  const TRACK_OBJECT_ANCHORS = [
    '[data-testid="context-item-info-title"]',
    '[data-testid="now-playing-widget-v2"]',
    '[data-testid="now-playing-widget"]',
    '[data-testid="now-playing-bar"]',
  ];
  // Anchors that carry `entityUri`, with a walk limit each (closest source first).
  const ENTITY_URI_ANCHORS: Array<[string, number]> = [
    ['[data-testid="now-playing-bar"]', 4],
    ['[data-testid="now-playing-widget-v2"]', 30],
    ['[data-testid="now-playing-widget"]', 30],
    ['[data-testid="lyrics-button"]', 40],
  ];
  const WIDGET_SELECTOR = '[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]';

  function walkProps(
    el: Element | null,
    maxDepth: number,
    visit: (props: Record<string, unknown>) => unknown,
  ): unknown {
    let fiber = window.slyGetFiber(el) as Record<string, unknown> | null;
    for (let depth = 0; fiber && depth <= maxDepth; depth++) {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object') {
        const hit = visit(props as Record<string, unknown>);
        if (hit) return hit;
      }
      fiber = fiber.return as Record<string, unknown> | null;
    }
    return null;
  }

  /** Locale-independent current-track uri, or null (ads, episodes, unknown build). */
  function findEntityUri(): string | null {
    for (const [sel, maxDepth] of ENTITY_URI_ANCHORS) {
      const uri = walkProps(document.querySelector(sel), maxDepth, p => (isTrackUri(p.entityUri) ? p.entityUri : null));
      if (uri) return uri as string;
    }
    return null;
  }

  /** First item/track/currentTrack/nowPlayingState.item with a spotify:track: uri (equal to wantUri when known). */
  function findTrackObject(el: Element | null, wantUri: string | null): Record<string, unknown> | null {
    return walkProps(el, 50, p => {
      const nps = p.nowPlayingState as Record<string, unknown> | null | undefined;
      for (const cand of [p.item, p.track, p.currentTrack, nps?.item]) {
        if (!cand || typeof cand !== 'object') continue;
        const uri = (cand as Record<string, unknown>).uri;
        if (isTrackUri(uri) && (!wantUri || uri === wantUri)) return cand;
      }
      return null;
    }) as Record<string, unknown> | null;
  }

  /**
   * Overlay closed (no lyric-line chain): build the track from entityUri + the widget DOM.
   * Same field shape as Spotify's `item` (duration is `duration.milliseconds`).
   */
  function buildTrackFromWidget(uri: string): Record<string, unknown> {
    const widget = document.querySelector(WIDGET_SELECTOR);
    const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() || '';

    // Title: the album link's text is the TRACK title in both the Oct and Nov widgets.
    let name = text(widget?.querySelector('[data-testid="context-item-info-title"], [data-testid="context-item-link"], a[href^="/album/"]'));
    let artistNames = Array.from(widget?.querySelectorAll('[data-testid="now-playing-widget-v2-byline"] a') || [])
      .map(a => text(a)).filter(Boolean);
    if (artistNames.length === 0) {
      artistNames = Array.from(widget?.querySelectorAll('a[href^="/artist/"]') || []).map(a => text(a)).filter(Boolean);
    }
    // Last resort only: the aria-label "Now playing: <title> by <artists>" is localized.
    const label = widget?.getAttribute('aria-label') || '';
    const labelMatch = label.match(/^Now playing:\s*(.+?)\s+by\s+(.+)$/);
    if (!name && labelMatch) name = labelMatch[1].trim();
    if (artistNames.length === 0 && labelMatch) artistNames = labelMatch[2].split(',').map(s => s.trim()).filter(Boolean);

    const track: Record<string, unknown> = {
      type: 'track',
      uri,
      name,
      artists: artistNames.map(n => ({ name: n })),
    };

    const range = document.querySelector('[data-testid="playback-progressbar"] input[type="range"]');
    const durationMs = Number(range?.getAttribute('max'));
    if (Number.isFinite(durationMs) && durationMs > 0) track.duration = { milliseconds: durationMs };

    const art = widget?.querySelector('img[data-testid="cover-art-image"]') as HTMLImageElement | null;
    const artUrl = art?.getAttribute('src');
    if (artUrl) {
      track.images = [{ url: artUrl }];
      track.album = { images: [{ url: artUrl }] };
    }
    return track;
  }

  // The track is posted every tick: detach it from React's live props so a function or a
  // cycle inside Spotify's object can never make postMessage throw (DataCloneError).
  function plainTrack(obj: Record<string, unknown>): Record<string, unknown> {
    try {
      return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
    } catch {
      const artists = Array.isArray(obj.artists)
        ? obj.artists.map(a => ({ name: String((a as Record<string, unknown> | null)?.name ?? '') }))
        : [];
      return { type: 'track', uri: obj.uri, name: typeof obj.name === 'string' ? obj.name : '', artists };
    }
  }

  function resolveCurrentTrack(lineNode: Element | undefined): { track: Record<string, unknown>; fromFiber: boolean } | null {
    const entityUri = findEntityUri();
    const anchors: Array<Element | null | undefined> = [
      ...TRACK_OBJECT_ANCHORS.map(sel => document.querySelector(sel)),
      lineNode,
    ];
    for (const el of anchors) {
      if (!el) continue;
      const found = findTrackObject(el, entityUri);
      if (found) return { track: plainTrack(found), fromFiber: true };
    }
    return entityUri ? { track: buildTrackFromWidget(entityUri), fromFiber: false } : null;
  }

  // Track-change and metadata-notify memory (separate: the name may arrive after the uri).
  let notifiedUri: string | null = null;
  let lastTrackSig = '';

  window.slyScanSpotifyState = function () {
    // SLY FIX: Only reset cachedToggleLyrics if it's currently orphaned (no button in DOM).
    // This prevents a race where the scanner wipes a handler just found by the shield.
    if (!document.querySelector('[data-testid="lyrics-button"]')) {
      window.cachedToggleLyrics = null;
    }

    // Prefer a full-panel line; fall back to a Now Playing view preview line only
    // when the full panel has none (the preview still exposes language/provider).
    const candidateLines = Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
      .filter(el => !el.closest('#lyrics-root-sync') && !el.closest(`[data-testid="now-playing-bar"], footer, ${NOW_PLAYING_WIDGET}`));
    const lineNode = candidateLines.find(el => !el.closest(NPV_PREVIEW_ANCESTORS)) || candidateLines[0];
    
    // Class names can now arrive via SLY_UPDATE_CLASSES; only use a single safe
    // class token so a bad value cannot make querySelector throw every tick.
    const learnedErrorCls = window.SPOTIFY_CLASSES?.errorContainer;
    const errorCls = typeof learnedErrorCls === 'string' && /^[A-Za-z0-9_-]+$/.test(learnedErrorCls)
      ? learnedErrorCls
      : 'hfTlyhd7WCIk9xmP';

    const failNode = document.querySelector('.' + errorCls) || 
                     document.querySelector('.bRNotDNzO2suN6vM') || 
                     Array.from(document.querySelectorAll('div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)'))
                       .filter(el => !el.closest(NPV_PREVIEW_ANCESTORS))
                       .flatMap(el => Array.from(el.querySelectorAll(':scope > div')))
                       .find(el => el.querySelectorAll('[data-testid="lyrics-line"]').length === 0 && el.classList.length > 0);
    const activeBtn = document.querySelector('[data-testid="lyrics-button"]');

    const aggregateState: Record<string, unknown> = {
      track: null, provider: undefined, syncType: undefined,
      isTimeSynced: undefined, isDenseTypeface: undefined, language: undefined,
    };

    const resolved = resolveCurrentTrack(lineNode);
    if (resolved) aggregateState.track = resolved.track;

    const lyricsAnchor = lineNode || failNode || document.querySelector('#main-view');
    if (lyricsAnchor) {
      let fiber = window.slyGetFiber(lyricsAnchor) as Record<string, unknown> | null;
      let depth = 0;
      while (fiber && depth < 40) {
        const props = fiber.memoizedProps as Record<string, unknown> | undefined;
        if (props) {
          const d = props.data as Record<string, unknown> | undefined;
          // color-lyrics shape is { lyrics: { language, ... } }; a component may receive that object as `lyrics`.
          const lyr = (props.lyrics && typeof props.lyrics === 'object') ? props.lyrics as Record<string, unknown> : undefined;
          if (aggregateState.provider === undefined) aggregateState.provider = props.provider || props.lyricsProvider || d?.provider;
          if (aggregateState.syncType === undefined) aggregateState.syncType = props.syncType || d?.syncType;
          if (aggregateState.isTimeSynced === undefined) aggregateState.isTimeSynced = props.isTimeSynced || d?.isTimeSynced;
          if (aggregateState.isDenseTypeface === undefined) aggregateState.isDenseTypeface = props.isDenseTypeface || d?.isDenseTypeface;
          if (aggregateState.language === undefined) aggregateState.language = props.language || d?.language || lyr?.language;
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
          if (queueMetadata.length > 0 && queueMetadata.length !== lastQueueLength) {
            console.log(`[sly-scanner] Discovered ${queueMetadata.length} items in local queue.`);
          }
          lastQueueLength = queueMetadata.length;
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

    // SLY FIX: Instantly notify the Interceptor (via Background) of the new track's metadata,
    // once per uri. This eliminates the 3s timeout window where the Interceptor is 'blind' while
    // waiting for DOM updates. A widget-built track (no fiber item) is only trusted after the same
    // uri + title was seen on two consecutive ticks, so a widget that re-renders after entityUri
    // changes cannot pair the new id with the previous title.
    const trackSig = track ? `${track.uri}\u0000${track.name || ''}` : '';
    if (track && track.name && track.uri !== notifiedUri && (resolved?.fromFiber || trackSig === lastTrackSig)) {
      const trackId = (track.uri as string).split(':').pop();
      if (trackId) {
        notifiedUri = track.uri as string;
        dispatchSlyAction({
          type: 'SLY_MXM_NOTIFY_METADATA',
          payload: { trackId, name: track.name as string, artist: (track.artists as any)?.[0]?.name || 'Unknown' },
        });
      }
    }
    lastTrackSig = trackSig;

    // Context-Aware Return Memory
    const currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      captureReturnPoint(currentPath, lastPath);
      lastPath = currentPath;
    }

    dispatchSlyAction({ type: 'SLY_TRACK_UPDATE', payload: state });
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

  function enforceDOMState(btn: Element): void {
    const b = btn as HTMLButtonElement;
    if (b.disabled) b.disabled = false;
    if (b.hasAttribute('disabled')) {
      b.removeAttribute('disabled');
      b.style.opacity = '1';
      b.style.pointerEvents = 'auto';
      b.style.cursor = 'pointer';
    }
    // Spotify's (localized) aria-label is left untouched; nothing depends on it.

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
        attributeFilter: ['disabled'] 
      });
      enforceDOMState(btn);
    } catch (e) {
      console.error('[sly-shield] MutationObserver setup failed:', e);
    }
  }

  // Idempotent: there is exactly one 500 ms shield/scanner loop per page, no matter
  // how often this is called (startup, SLY_TRIGGER_NATIVE_OPEN, ...). The handle lives
  // only in this closure; slyDeactivateShield() is the one way to stop it.
  window.slyActivateShield = function () {
    if (shieldInterval !== null) return;
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
      // Used by the omniscient-search fallback below.
      const navBar = document.querySelector('[data-testid="now-playing-bar"]');

      if (btn) {
        const btnAny = btn as unknown as Record<string, unknown>;
        if (!btnAny.__sly_observed) {
          setupObserver(btn);
          btnAny.__sly_observed = true;
        }

        let node = window.slyGetFiber(btn) as Record<string, unknown> | null;
        let depth = 0;
        let foundInWalk = window.cachedToggleLyrics !== null;
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
              // V15 Fix: Only use precise lyrics-related signatures.
              // 'onClick' was removed because it can trap unrelated handlers
              // (e.g., album art clicks, nav bar actions) that cause unexpected navigation.
              const signatures = ['toggleLyrics', 'onToggle'];
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

      // Genetic Lock Health Monitor
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
  };

  // Stops the loop (and with it the merged scanner, so SLY_TRACK_UPDATE stops too).
  // Nothing in the 2026 flow calls this: the close path must NOT, because nothing
  // reliably sends SLY_TRIGGER_NATIVE_OPEN to restart it afterwards.
  window.slyDeactivateShield = function () {
    if (shieldInterval === null) return;
    clearInterval(shieldInterval);
    shieldInterval = null;
  };
})();

/* ============================================================
   SECTION 4 — Bridge Entry
   Port of: lyric-test/bridge.js
   ============================================================ */

(function () {
  console.log('>>> [sly] Bridge Entry (Phase 5.1 - Native Grace)');

  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

  // K9: classes may arrive as action.classes, action.payload.classes or action.payload
  // (whichever is an object). Only non-empty string values are merged.
  function applyClassUpdate(action: Record<string, unknown>): void {
    const payload = action.payload;
    const incoming = isPlainObject(action.classes) ? action.classes
      : isPlainObject(payload) && isPlainObject(payload.classes) ? payload.classes
      : isPlainObject(payload) ? payload
      : null;
    if (!incoming) return;
    const merged: Record<string, string> = { ...(window.SPOTIFY_CLASSES || {}) };
    for (const [key, value] of Object.entries(incoming)) {
      if (typeof value === 'string' && value) merged[key] = value;
    }
    window.SPOTIFY_CLASSES = merged as unknown as typeof window.SPOTIFY_CLASSES;
  }

  // --- NATIVE TRIGGER HANDLER ---
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data as Record<string, any>;
    // The scavenger (isolated world) posts a bare { type: 'SLY_UPDATE_CLASSES', classes }
    // without the gateway envelope (its sender is unchanged); accept that shape too.
    if (isPlainObject(msg) && msg.type === 'SLY_UPDATE_CLASSES' && !msg.action) {
      applyClassUpdate(msg);
      return;
    }
    if (msg?.source !== 'SLY_ACTION_GATEWAY') return;
    const action = msg.action as SlyAction;
    if (!action) return;
    
    if (action.type === 'SLY_UPDATE_CLASSES') {
      if (isPlainObject(action)) applyClassUpdate(action);
      return;
    }

    if (action.type === 'SLY_TRIGGER_NATIVE_CLOSE') {
      console.log('>>> [sly] Bridge: Requesting Safe Native Panel Close');
      
      // Set transition guard to disable the Genetic Lock during slide out
      window.slyCloseTransitionActive = true;

      // The 500 ms shield loop is deliberately NOT stopped here: it also runs the
      // track scanner, and nothing reliably sends SLY_TRIGGER_NATIVE_OPEN to restart it.
      // The nuke() inside performAtomicRelease handles lock cleanup via the fiber walk.
      performAtomicRelease();
      return;
    }

    if (action.type === 'SLY_TRIGGER_NATIVE_OPEN') {
      console.log('>>> [sly] Bridge: Requesting Native Panel Open');

      // Clear transition guard immediately so locks can take effect
      window.slyCloseTransitionActive = false;

      // Make sure the shield loop is running (e.g. after slyDeactivateShield()).
      // slyActivateShield is idempotent, so repeated opens never stack intervals.
      if (typeof window.slyActivateShield === 'function') {
        window.slyActivateShield();
      }

      // 2026 UI: cachedToggleLyrics is a generic mode:"panel" toggle (fiber-verified —
      // no toggleLyrics/onToggle on the lyrics-button chain). Invoking it opens the
      // wrong tab (queue). Prefer a native button click; use trapped toggle only as fallback.
      const nativeBtn = document.querySelector('[data-testid="lyrics-button"]') as HTMLElement | null;
      if (nativeBtn) {
        console.log('>>> [sly] Bridge: Clicking lyrics button natively (generic toggle unsafe).');
        nativeBtn.click();

        setTimeout(() => {
          const activeBtn = document.querySelector('[data-testid="lyrics-button"]');
          const isPressed = activeBtn?.getAttribute('data-active') === 'true' || activeBtn?.getAttribute('aria-pressed') === 'true';
          // K10: full-panel container only (the NPV preview also carries --lyrics-color-active).
          const hasPanelLines = !!getThemedPanelContainer()?.querySelector('[data-testid="lyrics-line"]');
          console.log(`>>> [sly-audit] Flicker Guard executing. Is active button pressed? ${isPressed}. Attributes: data-active="${activeBtn?.getAttribute('data-active')}", aria-pressed="${activeBtn?.getAttribute('aria-pressed')}"`);
          if (!isPressed && !hasPanelLines && typeof window.cachedToggleLyrics === 'function') {
            console.warn('>>> [sly-audit] 🚨 Flicker Guard: panel not open. Re-invoking trapped toggle as last resort.');
            (window.cachedToggleLyrics as () => void)();
          }
        }, 600);
        return;
      }

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
          const hasPanelLines = !!getThemedPanelContainer()?.querySelector('[data-testid="lyrics-line"]');
          console.log(`>>> [sly-audit] Flicker Guard executing. Is active button pressed? ${isPressed}. Attributes: data-active="${activeBtn?.getAttribute('data-active')}", aria-pressed="${activeBtn?.getAttribute('aria-pressed')}"`);
          // 2026 UI: panel animation is slower than 100ms; re-invoking that fast
          // double-toggles (open→close). Only re-invoke if neither button nor panel confirms open.
          if (!isPressed && !hasPanelLines) {
            console.warn('>>> [sly-audit] 🚨 Flicker Guard: Button state is not pressed. Re-invoking native toggleLyrics().');
            (window.cachedToggleLyrics as () => void)();
          }
        }, 600);
      } else {
        // 2026 UI: panel is an aside overlay, pathname never becomes /lyrics.
        // pushState('/lyrics') would navigate away from /collection/tracks etc.
        // If toggle handler is missing, click the button directly as fallback.
        const btn = document.querySelector('[data-testid="lyrics-button"]') as HTMLElement | null;
        if (btn) {
          console.warn('>>> [sly] Bridge: toggleLyrics not found. Clicking lyrics button directly.');
          btn.click();
          return;
        }

        console.error('>>> [sly] Bridge: toggleLyrics not found and no lyrics button in DOM. Aborting (no pushState fallback in sidebar UI).');
      }
    }
  });

  // Start Modules
  if (typeof window.slyActivateShield === 'function') {
    window.slyActivateShield();
  }

  // Note: the scanner (Section 2) runs inside this single shield loop; there is no separate scanner interval.
})();

}); // end defineUnlistedScript
