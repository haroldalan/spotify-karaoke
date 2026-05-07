import { getNowPlayingKey } from './domQueries';
import { isContextValid } from '../utils/browserUtils';
import { CONTROLS_ID } from './lyricsControls';

export interface DomObserverOpts {
  onSongChange: (key: string) => void;
  onLyricsInjected: () => void;
  onControlsRemoved: () => void;
  onLyricsPanelClosed?: () => void;
  onInvalidate: () => void;
}

export function createDomObserver(opts: DomObserverOpts): MutationObserver {
  let lastSongChangeNotify = 0;
  const observer = new MutationObserver((mutations) => {
    if (!isContextValid()) {
      observer.disconnect();
      opts.onInvalidate();
      return;
    }
    for (const mut of mutations) {
      if (mut.type === 'attributes') {
        const target = mut.target as Element;
        
        // BUG-N: Throttle song change detection
        if (mut.attributeName === 'aria-label' && target.closest('[data-testid="now-playing-widget"]')) {
          const now = Date.now();
          if (now - lastSongChangeNotify > 300) {
            lastSongChangeNotify = now;
            opts.onSongChange(getNowPlayingKey());
          }
        }

        if (
          (mut.attributeName === 'data-active' || mut.attributeName === 'aria-pressed') &&
          target.matches('[data-testid="lyrics-button"]') &&
          target.getAttribute('data-active') !== 'true' &&
          target.getAttribute('aria-pressed') !== 'true'
        ) {
          opts.onLyricsPanelClosed?.();
        }
      }
    }

    for (const mut of mutations) {
      if (mut.type !== 'childList') continue;

      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (
          node.matches('[data-testid="lyrics-line"]') ||
          node.querySelector('[data-testid="lyrics-line"]')
        ) {
          // Do not react to slyCore's own injected lines — they use the same
          // testid but belong to a separate DOM strategy that Pipeline B must
          // not touch. Same guard as detector.ts:93.
          if ((node as Element).closest('#lyrics-root-sync')) break;
          opts.onLyricsInjected();
          break;
        }
      }

      for (const node of mut.removedNodes) {
        if (node instanceof Element && node.id === CONTROLS_ID) {
          opts.onControlsRemoved();
          break;
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label', 'data-active', 'aria-pressed'],
  });

  return observer;
}
