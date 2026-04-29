import { getLyricsContainer, getLyricsLines } from './domQueries';
import { isContextValid } from '../utils/browserUtils';
import { applyLinesToDOM } from './lyricsDOM';
import type { SongCache, LyricsMode } from '../core/lyricsTypes';

export interface LyricsObserverOpts {
  getIsApplying: () => boolean;
  getMode: () => LyricsMode;
  getCache: () => SongCache;
  getCurrentActiveLang: () => string;
  getDualLyricsEnabled: () => boolean;
  setApplying: (v: boolean) => void;
  onInvalidate: () => void;
}

export function createLyricsObserver(opts: LyricsObserverOpts): MutationObserver | null {
  const container = getLyricsContainer();
  if (!container) return null;

  const observer = new MutationObserver(() => {
    if (!isContextValid()) {
      observer.disconnect();
      opts.onInvalidate();
      return;
    }
    if (opts.getIsApplying() || opts.getMode() === 'original') return;

    const cache = opts.getCache();
    const processed = cache.processed.get(opts.getCurrentActiveLang());
    if (!processed) return;

    const mode = opts.getMode();
    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    const domLines = getLyricsLines();

    const needsReapply = domLines.some((el, i) => {
      if (lines[i] === undefined) return false;
      const mainSpan = el.querySelector<HTMLElement>('.sly-main-line');
      if (mainSpan) return mainSpan.textContent !== lines[i];
      return el.textContent !== lines[i];
    });

    if (needsReapply) {
      const dualLyricsEnabled = opts.getDualLyricsEnabled();
      applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, opts.setApplying);
    }
  });

  observer.observe(container, {
    subtree: true,
    childList: true,
  });

  return observer;
}
