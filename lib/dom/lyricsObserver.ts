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
  onReapply: () => Promise<void>;
}

export function createLyricsObserver(opts: LyricsObserverOpts): MutationObserver | null {
  const container = getLyricsContainer();
  if (!container) return null;

  const observer = new MutationObserver((mutations) => {
    if (!isContextValid()) {
      observer.disconnect();
      opts.onInvalidate();
      return;
    }

    // SLY FIX (Problem 2): Ignore attribute mutations (className changes from renderer).
    // This prevents the RAF loop from triggering an infinite re-injection cycle.
    const hasContentMutation = mutations.some(m => m.type === 'childList' || m.type === 'characterData');
    if (!hasContentMutation) return;

    if (opts.getIsApplying() || opts.getMode() === 'original') return;

    const cache = opts.getCache();
    const processed = cache.processed.get(opts.getCurrentActiveLang());
    
    // If processed data is missing, we still trigger onReapply() to allow it
    // to potentially fire a recovery fetch (gated by isSwitchingMode in reapplyMode).
    if (!processed) {
      opts.onReapply();
      return;
    }

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
      opts.onReapply();
    }
  });

  observer.observe(container, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  return observer;
}
