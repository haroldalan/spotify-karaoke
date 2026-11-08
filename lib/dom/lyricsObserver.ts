import { traceEvent } from '../testHooks';
import { getLyricsContainer, getLyricsLines } from './domQueries';
import { isContextValid } from '../utils/browserUtils';
import { applyLinesToDOM, capitalizeLine, isMeaningfullyDifferent } from './lyricsDOM';
import { resolveProcessed } from '../core/processedCache';
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
  if (!container) {
    console.log('[sly-observer] ⚠️ createLyricsObserver: no lyrics container found — observer NOT created.');
    return null;
  }
  console.log(`[sly-observer] ✅ createLyricsObserver: observing exact lyrics container (connected=${container.isConnected}, class="${container.className.slice(0, 40)}").`);

  const observer = new MutationObserver(() => {
    traceEvent(`observer:${opts.getMode()}${opts.getIsApplying() ? ':applying' : ''}`);
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
      let strippedSpanCount = 0;
      
      domLines.forEach((el) => {
        const spans = el.querySelectorAll('.sly-main-line, .sly-dual-line');
        if (spans.length > 0) {
          spans.forEach(s => s.remove());
          strippedSpanCount += spans.length;
        }
      });
      console.log(`[sly-observer] 🧹 Continuous garbage collector finished. Stripped ${strippedSpanCount} stale spans.`);
      return;
    }

    // DIAGNOSTIC: Log if we're firing on a detached (dead) node.
    if (!container.isConnected) {
      console.warn('[sly-observer] 🔴 Observer fired on DETACHED node — this observer is stale and should have been re-targeted.');
      return;
    }

    const cache = opts.getCache();
    // Romanized mode may reuse an entry stored under another target language
    // (romanization does not depend on it), exactly like every other apply path.
    // Translated mode never borrows another language's translation.
    const processed = resolveProcessed(cache.processed, opts.getCurrentActiveLang(), mode);
    if (!processed) {
      console.log('[sly-observer] ⏳ Observer fired but cache.processed has no usable entry — bailing (storage read may still be in flight).');
      return;
    }

    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    if (!Array.isArray(lines) || lines.length === 0) return;
    const domLines = getLyricsLines();
    const dualLyricsEnabled = opts.getDualLyricsEnabled();
    const originals = cache.original;

    console.log(`[sly-observer] 🔍 Evaluating needsReapply for ${domLines.length} DOM elements against processed length=${lines.length}...`);

    // Spacer-aware matching (mirrors applyLinesToDOM). The DOM list includes
    // padding/spacer rows the processed array doesn't, so raw-index comparison
    // (domLines[i] vs lines[i]) false-fires on spacers and drifts alignment.
    const paddingLineClass = (window as any).SPOTIFY_CLASSES?.paddingLineHelper || 'aLaX8poOH8kdbmGf';
    const normalize = (t: string): string =>
      (t || '').toLowerCase().replace(/[.,/#!$%\^&\*;:{}=\-_`~()♪?…\s]/g, '').trim();
    let originalsPointer = 0;
    let processedPointer = 0;

    const needsReapply = domLines.some((el, i) => {
      const rawAttrOriginal = el.getAttribute('data-sly-original');
      const isProcessedEl = el.querySelector('.sly-main-line, .sly-dual-line') !== null;
      const domText = (isProcessedEl ? (rawAttrOriginal ?? '') : (el.textContent ?? '')).replace(/\s+/g, ' ').trim();
      const isSpacer = el.classList.contains(paddingLineClass) ||
        el.parentElement?.classList.contains(paddingLineClass) ||
        (i < 2 && domText === '');
      if (isSpacer) {
        // Spacers must stay empty and span-free; anything else needs cleanup.
        const hasSpans = el.querySelector('.sly-main-line, .sly-dual-line') !== null;
        const hasText = (el.textContent ?? '').trim() !== '';
        if (hasSpans || hasText) {
          console.log(`[sly-observer] [${i}] Spacer has content/spans -> Triggering reapply.`);
          return true;
        }
        return false;
      }

      // Resolve which processed index this DOM row corresponds to via the
      // original text, not the raw DOM position.
      let matchIndex = -1;
      const normDom = normalize(domText);
      if (normDom !== '') {
        const searchLimit = Math.min(originalsPointer + 15, originals.length);
        for (let j = originalsPointer; j < searchLimit; j++) {
          if (normalize(originals[j] ?? '') === normDom) { matchIndex = j; break; }
        }
        if (matchIndex === -1) {
          for (let j = 0; j < originals.length; j++) {
            if (normalize(originals[j] ?? '') === normDom) { matchIndex = j; break; }
          }
        }
      } else {
        // Empty/instrumental row: advance to next empty original.
        for (let j = originalsPointer; j < originals.length; j++) {
          const t = (originals[j] ?? '').replace(/\s+/g, ' ').trim();
          if (t === '' || t === '♪') { matchIndex = j; break; }
        }
      }
      if (matchIndex === -1) {
        // No confident mapping — fall back to sequential processed order so a
        // single unmapped row can't force a full rewrite loop.
        matchIndex = processedPointer;
      }
      // Advance sequential pointers past the consumed slot.
      processedPointer = Math.max(processedPointer, matchIndex + 1);
      originalsPointer = Math.max(originalsPointer, matchIndex + 1);

      if (lines[matchIndex] === undefined) {
        console.log(`[sly-observer] [${i}] Processed line is undefined (mapped=${matchIndex}). No reapply needed.`);
        return false;
      }
      const expected = capitalizeLine(lines[matchIndex]);

      // Must mirror applyLinesToDOM's showDual exactly, or the two fight in a loop.
      const shouldHaveDual = dualLyricsEnabled && originals?.[matchIndex] !== undefined && isMeaningfullyDifferent(originals[matchIndex], lines[matchIndex]);
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
  // The container this observer watches, so callers can reuse it for the same container.
  (observer as MutationObserver & { slyTarget?: Element }).slyTarget = container;

  return observer;
}
