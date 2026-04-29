import { getNowPlayingKey } from './domQueries';
import { isContextValid } from '../utils/browserUtils';
import { CONTROLS_ID } from './lyricsControls';

export interface DomObserverOpts {
  onSongChange: (key: string) => void;
  onLyricsInjected: () => void;
  onControlsRemoved: () => void;
  onInvalidate: () => void;
}

export function createDomObserver(opts: DomObserverOpts): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    if (!isContextValid()) {
      observer.disconnect();
      opts.onInvalidate();
      return;
    }
    for (const mut of mutations) {
      if (
        mut.type === 'attributes' &&
        mut.attributeName === 'aria-label' &&
        (mut.target as Element).closest('[data-testid="now-playing-widget"]')
      ) {
        opts.onSongChange(getNowPlayingKey());
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
    attributeFilter: ['aria-label'],
  });

  return observer;
}
