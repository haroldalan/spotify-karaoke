import { getNowPlayingKey, getThemedPanelContainer, getAppRoot, getViewportRoot, getLyricsLines, isPreviewLine, rowNeedsProcessing, NOW_PLAYING_WIDGET } from './domQueries';
import { isContextValid } from '../utils/browserUtils';
import { CONTROLS_ID } from './lyricsControls';

const LYRICS_LINE = '[data-testid="lyrics-line"]';
const ROW_DIAG_INTERVAL_MS = 1000;

/** "tag[data-testid].firstClass" of a node: structure only, never its text. */
function describeNode(node: Node, withClass: boolean): string {
  if (!(node instanceof Element)) return node.nodeName.toLowerCase();
  const testId = node.getAttribute('data-testid');
  const firstClass = withClass ? node.classList[0] : undefined;
  return `${node.tagName.toLowerCase()}${testId ? `[${testId}]` : ''}${firstClass ? `.${firstClass}` : ''}`;
}

/**
 * Debug diagnostic: what Spotify adds to the lyrics panel and how often.
 * Aggregated, at most one console.log line per second (stripped in production).
 */
function createRowMountDiagnostic() {
  let batches = 0, fired = 0, nodes = 0, rows = 0, processed = 0, empty = 0;
  const shapes = new Map<string, number>();
  let lastLogAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    if (batches === 0) return;
    lastLogAt = performance.now();
    const shapeList = Array.from(shapes, ([s, n]) => `${s} x${n}`).join('; ');
    console.log(`[sly-perf] Panel row mounts at t=${lastLogAt.toFixed(1)}ms: batches=${batches} fired=${fired} nodes=${nodes} rows=${rows} processed=${processed} empty=${empty} | ${shapeList}`);
    batches = fired = nodes = rows = processed = empty = 0;
    shapes.clear();
  };

  return {
    note(target: Node, node: Element, rowCount: number, processedCount: number, emptyCount: number): void {
      nodes++;
      rows += rowCount;
      processed += processedCount;
      empty += emptyCount;
      const shape = `${describeNode(target, true)} <- ${describeNode(node, false)}`;
      if (shapes.has(shape) || shapes.size < 5) shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    },
    batch(didFire: boolean): void {
      batches++;
      if (didFire) fired++;
      const wait = lastLogAt + ROW_DIAG_INTERVAL_MS - performance.now();
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    },
    stop(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export interface DomObserverOpts {
  onSongChange: (key: string) => void;
  onLyricsInjected: () => void;
  onControlsRemoved: () => void;
  onLyricsPanelClosed?: () => void;
  onLyricsPanelOpened?: () => void;
  onInvalidate: () => void;
}

export interface SlyDomObserver extends MutationObserver {
  connectViewport: () => void;
  disconnectViewport: () => void;
}

export function createDomObserver(opts: DomObserverOpts): SlyDomObserver {
  // Master coordinator observer to satisfy the return type & orchestrate disconnect
  const dummyDiv = document.createElement('div');
  const masterObserver = new MutationObserver(() => {}) as SlyDomObserver;
  masterObserver.observe(dummyDiv, { childList: true });

  let barObserver: MutationObserver | null = null;
  let mainObserver: MutationObserver | null = null;
  let bootstrapObserver: MutationObserver | null = null;
  const rowDiag = createRowMountDiagnostic();

  function safeDisconnectAll() {
    rowDiag.stop();
    if (barObserver) { barObserver.disconnect(); barObserver = null; }
    if (mainObserver) { mainObserver.disconnect(); mainObserver = null; }
    if (bootstrapObserver) { bootstrapObserver.disconnect(); bootstrapObserver = null; }
    if (mainReplacementObserver) { mainReplacementObserver.disconnect(); mainReplacementObserver = null; }
  }

  // Override disconnect to clean up all active sub-observers
  const originalDisconnect = masterObserver.disconnect.bind(masterObserver);
  masterObserver.disconnect = () => {
    originalDisconnect();
    safeDisconnectAll();
    document.removeEventListener('DOMContentLoaded', bootstrap);
  };

  // Common context validation guard
  function checkContext(): boolean {
    if (!isContextValid()) {
      masterObserver.disconnect();
      opts.onInvalidate();
      return false;
    }
    return true;
  }

  // 1. Playback Observer: Watches song title and button status
  function setupPlaybackObserver(barEl: Element) {
    if (barObserver) barObserver.disconnect();

    barObserver = new MutationObserver((mutations) => {
      if (!checkContext()) return;

      for (const mut of mutations) {
        // Song changes
        if (
          mut.type === 'attributes' &&
          mut.attributeName === 'aria-label' &&
          (mut.target as Element).matches(NOW_PLAYING_WIDGET)
        ) {
          opts.onSongChange(getNowPlayingKey());
        }

        // Panel closes from lyrics button attributes
        if (
          mut.type === 'attributes' &&
          (mut.attributeName === 'data-active' || mut.attributeName === 'aria-pressed') &&
          (mut.target as Element).matches('[data-testid="lyrics-button"]') &&
          (mut.target as Element).getAttribute('data-active') !== 'true' &&
          (mut.target as Element).getAttribute('aria-pressed') !== 'true'
        ) {
          opts.onLyricsPanelClosed?.();
        }

        // Panel opens from lyrics button attributes
        if (
          mut.type === 'attributes' &&
          (mut.attributeName === 'data-active' || mut.attributeName === 'aria-pressed') &&
          (mut.target as Element).matches('[data-testid="lyrics-button"]') &&
          ((mut.target as Element).getAttribute('data-active') === 'true' ||
           (mut.target as Element).getAttribute('aria-pressed') === 'true')
        ) {
          opts.onLyricsPanelOpened?.();
        }

        // Song changes via widget mount / replacement
        if (mut.type === 'childList') {
          for (const node of mut.addedNodes) {
            if (!(node instanceof Element)) continue;
            const widget = node.matches(NOW_PLAYING_WIDGET)
              ? node
              : node.querySelector(NOW_PLAYING_WIDGET);
            if (widget) {
              const key = widget.getAttribute('aria-label') ?? '';
              if (key) opts.onSongChange(key);
              break;
            }
          }
        }
      }
    });

    barObserver.observe(barEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-active', 'aria-pressed'],
    });
  }

  // V12 Fix: Track the currently bound <main> element so we can detect replacement
  let lastBoundMain: Element | null = null;
  let mainReplacementObserver: MutationObserver | null = null;

  // 2. Viewport Observer: Watches lyrics panel for line mounts and pill removals.
  // 2026 UI: bound to div#main, which holds the lyrics overlay (not the <main> tag).
  function setupViewportObserver(mainEl: Element) {
    if (mainObserver) mainObserver.disconnect();
    lastBoundMain = mainEl;

    mainObserver = new MutationObserver((mutations) => {
      if (!checkContext()) return;

      let lyricsFoundInBatch = false;
      let controlsRemovedInBatch = false;
      let rowNodesInBatch = 0;

      for (const mut of mutations) {
        if (mut.type !== 'childList') continue;

        // 1. Check if new lyrics lines are added. Only a row that still shows
        // Spotify's own text counts: moved or re-attached rows that already carry
        // our spans, and empty spacer rows, need no setup (the lyricsObserver
        // still checks their content). Checked per row: an added ancestor of the
        // Now Playing view or of #lyrics-root-sync must not count either.
        for (const node of mut.addedNodes) {
          if (!(node instanceof Element)) continue;
          const rows = node.matches(LYRICS_LINE) ? [node] : Array.from(node.querySelectorAll(LYRICS_LINE));
          if (rows.length === 0) continue;
          let panelRows = 0;
          let processedRows = 0;
          let emptyRows = 0;
          for (const row of rows) {
            if (row.closest('#lyrics-root-sync')) continue;
            // div#main also contains the Now Playing view preview card; its line
            // mounts are not the lyrics panel.
            if (isPreviewLine(row)) continue;
            panelRows++;
            if (rowNeedsProcessing(row)) lyricsFoundInBatch = true;
            else if ((row.querySelector(':scope > div') ?? row).querySelector('.sly-main-line, .sly-dual-line')) processedRows++;
            else emptyRows++;
          }
          if (panelRows > 0) {
            rowNodesInBatch++;
            rowDiag.note(mut.target, node, panelRows, processedRows, emptyRows);
          }
        }

        // 2. Check if controls pill is removed
        for (const node of mut.removedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.id === CONTROLS_ID || node.querySelector(`#${CONTROLS_ID}`)) {
            controlsRemovedInBatch = true;
          }
        }
      }

      if (controlsRemovedInBatch) {
        opts.onControlsRemoved();
      }

      if (lyricsFoundInBatch) {
        opts.onLyricsInjected();
      }
      if (rowNodesInBatch > 0) rowDiag.batch(lyricsFoundInBatch);
    });

    mainObserver.observe(mainEl, {
      childList: true,
      subtree: true,
    });

    // 2026 UI: the lyrics panel is under div#main > [data-testid="root"] (themed
    // container with --lyrics-color vars), not under the <main> tag. Both are
    // inside div#main, so they only need their own registration when the
    // observer is bound to something else (legacy <main> fallback).
    const themedPanel = getThemedPanelContainer();
    if (themedPanel && !mainEl.contains(themedPanel)) {
      try {
        mainObserver.observe(themedPanel, { childList: true, subtree: true });
      } catch {}
    }
    const appRoot = getAppRoot();
    if (appRoot && !mainEl.contains(appRoot) && appRoot !== themedPanel) {
      try {
        mainObserver.observe(appRoot, { childList: true, subtree: true });
      } catch {}
    }

    // Check if the panel lines already exist at setup time (preview lines excluded)
    if (getLyricsLines().length > 0) {
      opts.onLyricsInjected();
    }

    // V12 Fix: Start a lightweight observer on document.body to detect <main> replacement.
    // Spotify's SPA router can swap <main> entirely during navigation, leaving our
    // mainObserver watching a detached element that never receives mutations.
    if (!mainReplacementObserver) {
      mainReplacementObserver = new MutationObserver(() => {
        if (!checkContext()) {
          mainReplacementObserver?.disconnect();
          mainReplacementObserver = null;
          return;
        }
        // Only re-bind a viewport observer that is meant to be connected
        // (disconnectViewport nulls mainObserver while the panel is closed), and
        // only when the bound root was really replaced or detached.
        if (!mainObserver) return;
        const currentRoot = getViewportRoot();
        if (currentRoot && (currentRoot !== lastBoundMain || !lastBoundMain?.isConnected)) {
          console.log('[sly-perf] Viewport root was replaced by SPA navigation. Re-binding viewport observer.');
          setupViewportObserver(currentRoot);
        }
      });
      mainReplacementObserver.observe(document.body, { childList: true });
    }
  }

  // 3. Bootstrap Watcher: safely binds targeted observers once DOM target containers are loaded
  // 2026 UI: lyrics panel lives under div#main > [data-testid="root"], not the <main> tag.
  function bootstrap() {
    if (!checkContext()) return;

    const mainEl = getViewportRoot();
    const barEl = document.querySelector('[data-testid="now-playing-bar"]');

    if (mainEl && barEl) {
      setupPlaybackObserver(barEl);
      setupViewportObserver(mainEl);
      if (bootstrapObserver) {
        bootstrapObserver.disconnect();
        bootstrapObserver = null;
      }
      console.log('[sly-perf] Targeted DOM mutation observers bound. High CPU document.body observer bypassed.');
      return;
    }

    // If targets are not ready, observe document.body solely for target mounts
    if (!bootstrapObserver) {
      bootstrapObserver = new MutationObserver(() => {
        const currentMain = getViewportRoot();
        const currentBar = document.querySelector('[data-testid="now-playing-bar"]');
        if (currentMain && currentBar) {
          setupPlaybackObserver(currentBar);
          setupViewportObserver(currentMain);
          bootstrapObserver?.disconnect();
          bootstrapObserver = null;
          console.log('[sly-perf] Targeted DOM mutation observers successfully initialized after delay.');
        }
      });
      bootstrapObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Start the bootstrapping flow
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  masterObserver.disconnectViewport = () => {
    if (mainObserver) {
      mainObserver.disconnect();
      mainObserver = null;
      lastBoundMain = null;
      console.log('[sly-perf] Viewport Observer disconnected dynamically.');
    }
  };

  masterObserver.connectViewport = () => {
    const mainEl = getViewportRoot();
    // Already connected to the live viewport root.
    if (mainObserver && lastBoundMain?.isConnected && lastBoundMain === mainEl) return;
    if (mainEl) {
      setupViewportObserver(mainEl);
      console.log('[sly-perf] Viewport Observer connected dynamically.');
    } else {
      bootstrap();
    }
  };

  return masterObserver;
}
