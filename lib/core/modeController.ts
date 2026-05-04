import { safeBrowserCall, getTargetLang } from '../utils/browserUtils';
import { snapshotOriginals, applyLinesToDOM } from '../dom/lyricsDOM';
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
  async function switchMode(next: LyricsMode, forceLang?: string, suppressLoading = false, forceRefresh = false): Promise<void> {
    const currentSwitchGen = ++opts.store.switchGenRef.value;
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    const cache = opts.store.cache;
    const dualLyricsEnabled = opts.store.dualLyricsEnabled;

    if (next === mode && forceLang === undefined && !forceRefresh) return;
    const previousMode = mode;
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
      applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
      syncButtonStates(next);
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
        applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, getTargets());
        setLoadingState(false);
      } else {
        const lang = forceLang ?? (await getTargetLang());

        let processed: ProcessedCache | null = null;
        if (next === 'romanized' && cache.processed.size > 0) {
          const entries = Array.from(cache.processed.values());
          processed = entries.find(e => !e.isLowQualityRomanization && e.romanized) ?? entries.find(e => e.romanized) ?? null;
        } 
        if (!processed) {
          const genRef = next === 'romanized' ? opts.store.romanizedGenRef : opts.store.translatedGenRef;
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
        applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
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

    if (mode === 'original') return;

    let processed = cache.processed.get(currentActiveLang);
    if (!processed && mode === 'romanized' && cache.processed.size > 0) {
      const entries = Array.from(cache.processed.values());
      processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
    }

    if (!processed) return;

    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    const targets = getTargets();
    if (targets && targets.length !== cache.original.length) {
      console.warn('[SKaraoke:Content] Alignment mismatch detected in reapplyMode. DOM:', targets.length, 'Cache:', cache.original.length);
    }
    applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
  }

  function autoSwitchIfNeeded(forceRefresh = false): void {
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    if ((mode === 'original' && preferredMode !== 'original') || forceRefresh) {
      switchMode(preferredMode, undefined, false, forceRefresh);
    }
  }

  return { switchMode, reapplyMode, autoSwitchIfNeeded };
}
