import { getLyricsViewRoot, getLyricsLines } from './domQueries';
import { isContextValid } from '../utils/browserUtils';
import { applyLinesToDOM, capitalizeLine } from './lyricsDOM';
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
  const container = getLyricsViewRoot();
  if (!container) {
    console.log('[sly-observer] ⚠️ createLyricsObserver: no lyrics view root — observer NOT created.');
    return null;
  }
  console.log(`[sly-observer] ✅ createLyricsObserver: observing node (connected=${container.isConnected}, id="${container.id}", class="${container.className.slice(0, 40)}").`);

  const observer = new MutationObserver(() => {
    if (!isContextValid()) {
      observer.disconnect();
      opts.onInvalidate();
      return;
    }
    if (opts.getMode() === 'original') return;

    // DIAGNOSTIC: Log if we're firing on a detached (dead) node.
    if (!container.isConnected) {
      console.warn('[sly-observer] 🔴 Observer fired on DETACHED node — this observer is stale and should have been re-targeted.');
      return;
    }

    const cache = opts.getCache();
    const processed = cache.processed.get(opts.getCurrentActiveLang());
    if (!processed) {
      console.log('[sly-observer] ⏳ Observer fired but cache.processed is empty — bailing (storage read may still be in flight).');
      return;
    }

    const mode = opts.getMode();
    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    const domLines = getLyricsLines();

    const needsReapply = domLines.some((el, i) => {
      if (lines[i] === undefined) return false;
      const expected = capitalizeLine(lines[i]);
      const mainSpan = el.querySelector<HTMLElement>('.sly-main-line');
      if (mainSpan) return mainSpan.textContent !== expected;
      return el.textContent !== expected;
    });

    if (needsReapply) {
      console.log(`[sly-observer] 🔁 needsReapply=true (${domLines.length} lines, mode=${mode}) — applying processed lyrics.`);
      const dualLyricsEnabled = opts.getDualLyricsEnabled();
      applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, opts.setApplying, domLines);
    } else {
      console.log(`[sly-observer] ✔️ needsReapply=false (${domLines.length} lines, mode=${mode}) — lyrics already correct.`);
    }
  });

  observer.observe(container, {
    subtree: true,
    childList: true,
  });

  return observer;
}
