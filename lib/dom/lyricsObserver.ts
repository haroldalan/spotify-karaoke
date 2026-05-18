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
    if (opts.getIsApplying()) {
      console.log('[sly-observer] ⏳ Mutation detected but isApplying=true — ignoring to prevent recursive loops.');
      return;
    }

    const mode = opts.getMode();
    if (mode === 'original') {
      console.log('[sly-observer] 🧹 Observer detected mutation in ORIGINAL mode. Invoking continuous garbage collector...');
      const domLines = getLyricsLines();
      let strippedAttrCount = 0;
      let strippedSpanCount = 0;
      
      domLines.forEach((el) => {
        if (el.hasAttribute('data-sly-original')) {
          el.removeAttribute('data-sly-original');
          strippedAttrCount++;
        }
        const spans = el.querySelectorAll('.sly-main-line, .sly-dual-line');
        if (spans.length > 0) {
          spans.forEach(s => s.remove());
          strippedSpanCount += spans.length;
        }
      });
      console.log(`[sly-observer] 🧹 Continuous garbage collector finished. Stripped ${strippedAttrCount} stale attributes, ${strippedSpanCount} stale spans.`);
      return;
    }

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

    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    const domLines = getLyricsLines();
    const dualLyricsEnabled = opts.getDualLyricsEnabled();
    const originals = cache.original;

    console.log(`[sly-observer] 🔍 Evaluating needsReapply for ${domLines.length} DOM elements against processed length=${lines.length}...`);

    const needsReapply = domLines.some((el, i) => {
      if (lines[i] === undefined) {
        console.log(`[sly-observer] [${i}] Processed line is undefined. No reapply needed.`);
        return false;
      }
      const expected = capitalizeLine(lines[i]);

      const shouldHaveDual = dualLyricsEnabled && originals?.[i] !== undefined && originals[i] !== lines[i];
      const hasDual = !!el.querySelector('.sly-dual-line');
      
      if (shouldHaveDual !== hasDual) {
        console.log(`[sly-observer] [${i}] Dual lyrics state mismatch! shouldHaveDual=${shouldHaveDual} | hasDual=${hasDual} -> Triggering reapply.`);
        return true;
      }

      const mainSpan = el.querySelector<HTMLElement>('.sly-main-line');
      const actualText = mainSpan ? mainSpan.textContent : el.textContent;
      const isMismatch = actualText !== expected;
      
      if (isMismatch) {
        console.log(`[sly-observer] [${i}] Text content mismatch! Expected="${expected}" | Actual="${actualText}" -> Triggering reapply.`);
        return true;
      }
      
      return false;
    });

    if (needsReapply) {
      console.log(`[sly-observer] 🔁 needsReapply=true — calling applyLinesToDOM.`);
      applyLinesToDOM(lines, cache.original, dualLyricsEnabled, opts.setApplying, domLines);
    } else {
      console.log(`[sly-observer] ✔️ needsReapply=false — all DOM elements align perfectly with cache.`);
    }

  });

  observer.observe(container, {
    subtree: true,
    childList: true,
  });

  return observer;
}
