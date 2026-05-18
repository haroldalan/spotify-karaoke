import { getNowPlayingKey } from './domQueries';
import { isContextValid } from '../utils/browserUtils';
import { CONTROLS_ID } from './lyricsControls';

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

  function safeDisconnectAll() {
    if (barObserver) { barObserver.disconnect(); barObserver = null; }
    if (mainObserver) { mainObserver.disconnect(); mainObserver = null; }
    if (bootstrapObserver) { bootstrapObserver.disconnect(); bootstrapObserver = null; }
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
          (mut.target as Element).matches('[data-testid="now-playing-widget"]')
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
            const widget = node.matches('[data-testid="now-playing-widget"]')
              ? node
              : node.querySelector('[data-testid="now-playing-widget"]');
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

  // 2. Viewport Observer: Watches <main> for lyrics line mounts and pill removals
  function setupViewportObserver(mainEl: Element) {
    if (mainObserver) mainObserver.disconnect();

    mainObserver = new MutationObserver((mutations) => {
      if (!checkContext()) return;

      let lyricsFoundInBatch = false;
      let controlsRemovedInBatch = false;

      for (const mut of mutations) {
        if (mut.type !== 'childList') continue;

        // 1. Check if new lyrics lines are added
        for (const node of mut.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches('[data-testid="lyrics-line"]') ||
            node.querySelector('[data-testid="lyrics-line"]')
          ) {
            if (node.closest('#lyrics-root-sync')) continue;
            lyricsFoundInBatch = true;
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
    });

    mainObserver.observe(mainEl, {
      childList: true,
      subtree: true,
    });

    // Check if the lines already exist at setup time
    const lines = mainEl.querySelectorAll('[data-testid="lyrics-line"]');
    const hasExisting = Array.from(lines).some(l => !l.closest('#lyrics-root-sync'));
    if (hasExisting) {
      opts.onLyricsInjected();
    }
  }

  // 3. Bootstrap Watcher: safely binds targeted observers once DOM target containers are loaded
  function bootstrap() {
    if (!checkContext()) return;

    const mainEl = document.querySelector('main');
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
        const currentMain = document.querySelector('main');
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
      console.log('[sly-perf] Viewport Observer disconnected dynamically.');
    }
  };

  masterObserver.connectViewport = () => {
    if (mainObserver) return; // already connected
    const mainEl = document.querySelector('main');
    if (mainEl) {
      setupViewportObserver(mainEl);
      console.log('[sly-perf] Viewport Observer connected dynamically.');
    } else {
      bootstrap();
    }
  };

  return masterObserver;
}
