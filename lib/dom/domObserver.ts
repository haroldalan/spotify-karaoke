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
    for (const mut of mutations) {
      if (
        mut.type === 'attributes' &&
        mut.attributeName === 'aria-label' &&
        (mut.target as Element).closest('[data-testid="now-playing-widget"]')
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
