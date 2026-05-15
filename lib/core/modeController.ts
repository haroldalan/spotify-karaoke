import { safeBrowserCall, getTargetLang } from '../utils/browserUtils';
import { snapshotOriginals, applyLinesToDOM } from '../dom/lyricsDOM';
import { getLyricsLines } from '../dom/domQueries';
import { syncButtonStates, setLoadingState } from '../dom/lyricsControls';
import { fetchProcessed } from './fetchProcessed';
import { isLatinScript } from '../lyrics/scriptDetector';
import { showToast, hideToast } from '../dom/toast';
import type { LyricsMode, SongCache, ProcessedCache, LyricsCacheEntry } from './lyricsTypes';
import { StateStore } from './store';

export interface ModeControllerOpts {
  store: StateStore;
}

export function createModeController(opts: ModeControllerOpts) {
  // Returns the inner text divs of slyCore's lyric elements for applyLinesToDOM.
  // Must use slyActiveDomElements (padding-free) instead of querySelectorAll:
  // querySelectorAll('[data-testid="lyrics-line"] > div') on slyActiveContainer
  // returns N+3 inner divs (pad1, pad2, lyric0…lyricN-1, padBottom). Since
  // cache.original/processed only has N entries, applyLinesToDOM sees
  // lines[N] = undefined for the last 2 targets → they are skipped → last 2
  // lyrics stay in original script (un-romanized). The whole mapping is also
  // shifted by 2, so lyric0 gets lyric2's romanized text, etc.
  const getTargets = (): Element[] | undefined => {
    if (!opts.store.slyActiveContainer) return undefined;
    return opts.store.slyActiveDomElements
      .map(outer => outer.firstElementChild)
      .filter((el): el is Element => el !== null);
  };

  const hasAlignedProcessedLines = (processed: ProcessedCache, mode: LyricsMode, expected: number): boolean => {
    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    return Array.isArray(lines) && lines.length === expected;
  };

  async function switchMode(next: LyricsMode, forceLang?: string, suppressLoading = false, forceRefresh = false, cacheOverride?: SongCache): Promise<void> {
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    const cache = cacheOverride || opts.store.cache;
    const dualLyricsEnabled = opts.store.dualLyricsEnabled;

    if (next === mode && forceLang === undefined && !forceRefresh) return;

    const currentSwitchGen = ++opts.store.switchGenRef.value;
    const previousMode = mode;
    console.log(`[sly-audit] 🔄 Mode Change Requested: "${previousMode}" ➡️ "${next}"`);
    if (cache.original.length === 0) snapshotOriginals(cache);

    if (next === 'romanized' && forceLang === undefined && isLatinScript(cache.original)) {
      opts.store.mode = next;
      if (preferredMode !== next) {
        opts.store.preferredMode = next;
        safeBrowserCall(() => browser.storage.sync.set({ preferredMode: next }));
      }
      const targets = getTargets();
      if (targets && targets.length !== cache.original.length) {
        console.warn('[SKaraoke:Content] Alignment mismatch detected (Latin). DOM:', targets.length, 'Cache:', cache.original.length);
      }
      console.log(`[sly-audit] 📄 Applying Original Lyrics (Latin script fallback, First 5 lines):\n`, cache.original.slice(0, 5).map((l, i) => `  ${i + 1}: ${l}`).join('\n'));
      applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
      opts.store.lyricsAppliedForKey = opts.store.songKey;
      syncButtonStates(next);
      setLoadingState(false);
      return;
    }

    opts.store.mode = next;
    syncButtonStates(next);

    if (!suppressLoading) setLoadingState(true);
    opts.store.isSwitchingMode = true;

    if (next !== 'original' && cache.original.length === 0) {
      opts.store.isSwitchingMode = false;
      setLoadingState(false);
      return;
    }

    try {
      if (next === 'original') {
        if (preferredMode !== next) {
          opts.store.preferredMode = next;
          safeBrowserCall(() => browser.storage.sync.set({ preferredMode: next }));
        }
        console.log(`[sly-audit] 📄 Applying Original Lyrics (First 5 lines):\n`, cache.original.slice(0, 5).map((l, i) => `  ${i + 1}: ${l}`).join('\n'));
        applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, getTargets());
        opts.store.lyricsAppliedForKey = opts.store.songKey;
        setLoadingState(false);
      } else {
        const lang = forceLang || opts.store.currentActiveLang || await getTargetLang();

        let processed: ProcessedCache | null = null;
        if (next === 'romanized' && cache.processed.size > 0) {
          const entries = Array.from(cache.processed.values());
          processed = entries.find(e => !e.isLowQualityRomanization && e.romanized) ?? entries.find(e => e.romanized) ?? null;
        } 
        if (processed && !hasAlignedProcessedLines(processed, next, cache.original.length)) {
          console.warn('[SKaraoke:Content] Stale processed cache rejected. Mode:', next, 'Processed:', (next === 'romanized' ? processed.romanized : processed.translated)?.length, 'Original:', cache.original.length);
          cache.processed.clear();
          processed = null;
        }
        if (!processed) {
          const genRef = opts.store.globalProcessGenRef;
          processed = await fetchProcessed(cache.original, lang, cache, opts.store.songKey, opts.store.runtimeCache, genRef);
        }

        if (currentSwitchGen !== opts.store.switchGenRef.value) return;

        if (processed === null) {
          opts.store.mode = previousMode;
          syncButtonStates(previousMode);
          return;
        }

        opts.store.currentActiveLang = lang;
        if (preferredMode !== next) {
          opts.store.preferredMode = next;
          safeBrowserCall(() => browser.storage.sync.set({ preferredMode: next }));
        }
        const lines = next === 'romanized' ? processed.romanized : processed.translated;
        const targets = getTargets();
        if (targets && targets.length !== cache.original.length) {
          console.warn('[SKaraoke:Content] Alignment mismatch detected (Processed). DOM:', targets.length, 'Cache:', cache.original.length);
        }
        console.log(`[sly-audit] 🔮 Processed Lyrics ("${next}" mode, First 5 lines):\n`, lines.slice(0, 5).map((l, i) => `  ${i + 1}: ${l}`).join('\n'));
        applyLinesToDOM(lines, cache.original, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
        opts.store.lyricsAppliedForKey = opts.store.songKey;
        setLoadingState(false);
      }
    } catch (err) {
      console.error('[SKaraoke:Content] Mode switch failed:', err);
      showToast('Translation failed. Please try again.', 3000);
      opts.store.mode = previousMode;
      syncButtonStates(previousMode);
    } finally {
      if (currentSwitchGen === opts.store.switchGenRef.value) {
        opts.store.isSwitchingMode = false;
        hideToast(true);
        setLoadingState(false);
      }
    }
  }

  async function reapplyMode(): Promise<void> {
    const mode = opts.store.mode;
    const currentActiveLang = opts.store.currentActiveLang;
    const cache = opts.store.cache;
    const dualLyricsEnabled = opts.store.dualLyricsEnabled;

    if (mode === 'original' || opts.store.isSwitchingMode) return;

    let processed = cache.processed.get(currentActiveLang);
    if (!processed && mode === 'romanized' && cache.processed.size > 0) {
      const entries = Array.from(cache.processed.values());
      processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
    }

    if (!processed) {
      if (mode === 'romanized' && isLatinScript(cache.original)) {
        const targets = getTargets();
        console.log(`[SKaraoke:Mode] reapplyMode: Latin script detected for romanized mode. Using originals.`);
        applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
        opts.store.lyricsAppliedForKey = opts.store.songKey;
        setLoadingState(false);
        return;
      }

      if (mode !== 'original') {
        console.warn(`[SKaraoke:Mode] reapplyMode: Data missing for ${mode}. Triggering recovery fetch.`);
        await switchMode(mode, undefined, false, true);
      }
      return;
    }

    if (!hasAlignedProcessedLines(processed, mode, cache.original.length)) {
      console.warn('[SKaraoke:Mode] reapplyMode: stale processed cache rejected. Recomputing.');
      cache.processed.clear();
      await switchMode(mode, undefined, false, true);
      return;
    }

    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    const targets = getTargets();

    // If there are no lyrics lines in the DOM yet, bail out silently.
    // The lyricsObserver (which fires on DOM mutations) will call reapplyMode
    // again once the native lyrics are rendered — at which point the cache will
    // already be populated and the apply will succeed immediately.
    const domLines = targets ?? getLyricsLines();
    if (domLines.length === 0) return;

    if (targets && targets.length !== cache.original.length) {
      console.warn('[SKaraoke:Content] Alignment mismatch detected in reapplyMode. DOM:', targets.length, 'Cache:', cache.original.length);
    }
    console.log(`[sly-audit] 🔮 Processed Lyrics (Re-applying "${mode}" mode, First 5 lines):\n`, lines.slice(0, 5).map((l, i) => `  ${i + 1}: ${l}`).join('\n'));
    applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
    opts.store.lyricsAppliedForKey = opts.store.songKey;
    setLoadingState(false);
  }

  function autoSwitchIfNeeded(forceRefresh = false, cacheOverride?: SongCache): void {
    if (opts.store.isSwitchingMode && !forceRefresh) return;
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    const cache = cacheOverride ?? opts.store.cache;

    // Classic trigger: mode is still 'original' but user wants something else.
    const modeNeedsSwitch = mode === 'original' && preferredMode !== 'original';

    // Shimmer trigger: fire as soon as preferredMode is non-original and the
    // processed cache is empty — regardless of whether we have original lines yet.
    // This is intentionally decoupled from the fetch guard below.
    const shimmerNeeded =
      preferredMode !== 'original' &&
      cache.processed.size === 0 &&
      !opts.store.isSwitchingMode;

    // Fetch trigger: only fire when we have original lines to send to the processor.
    // Requires cache.original.length > 0 to avoid a useless no-op fetch.
    const optimisticNeedsFetch =
      !modeNeedsSwitch &&
      preferredMode !== 'original' &&
      cache.processed.size === 0 &&
      cache.original.length > 0;

    // If shimmer is needed but we cannot start the fetch yet (no originals),
    // activate the loading visual so the user sees feedback immediately.
    // switchMode will be called later once originals arrive (via lyricsObserver).
    if (shimmerNeeded && !optimisticNeedsFetch && !modeNeedsSwitch && !forceRefresh) {
      setLoadingState(true);
    }

    if (modeNeedsSwitch || forceRefresh || optimisticNeedsFetch) {
      // Pass forceRefresh=true when data isn't ready so switchMode bypasses the
      // same-mode early-return guard (mode === preferredMode after optimistic init).
      switchMode(preferredMode, undefined, false, forceRefresh || optimisticNeedsFetch, cacheOverride);
    }
  }

  return { switchMode, reapplyMode, autoSwitchIfNeeded };
}
