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
  const observer = new MutationObserver((mutations) => {
    if (!isContextValid()) {
      observer.disconnect();
      opts.onInvalidate();
      return;
    }

    let lyricsFoundInBatch = false;

    // Pass 1: update active song state before any lyrics setup runs.
    for (const mut of mutations) {
      if (
        mut.type === 'attributes' &&
        mut.attributeName === 'aria-label' &&
        (mut.target as Element).matches('[data-testid="now-playing-widget"]')
      ) {
        opts.onSongChange(getNowPlayingKey());
      }

      if (
        mut.type === 'attributes' &&
        (mut.attributeName === 'data-active' || mut.attributeName === 'aria-pressed') &&
        (mut.target as Element).matches('[data-testid="lyrics-button"]') &&
        (mut.target as Element).getAttribute('data-active') !== 'true' &&
        (mut.target as Element).getAttribute('aria-pressed') !== 'true'
      ) {
        opts.onLyricsPanelClosed?.();
      }

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

    // Pass 2: now that song state/cache warmup has run, react to lyrics DOM.
    for (const mut of mutations) {
      if (mut.type !== 'childList') continue;

      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (
          node.matches('[data-testid="lyrics-line"]') ||
          node.querySelector('[data-testid="lyrics-line"]')
        ) {
          if (node.closest('#lyrics-root-sync')) continue;
          lyricsFoundInBatch = true;
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

    if (lyricsFoundInBatch) {
      opts.onLyricsInjected();
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
