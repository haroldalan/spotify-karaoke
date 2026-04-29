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
  async function switchMode(next: LyricsMode, forceLang?: string, suppressLoading = false): Promise<void> {
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    const cache = opts.store.cache;
    const dualLyricsEnabled = opts.store.dualLyricsEnabled;

    if (next === mode && forceLang === undefined) return;
    const previousMode = mode;
    if (cache.original.length === 0) snapshotOriginals(cache);

    if (next === 'romanized' && forceLang === undefined && isLatinScript(cache.original)) {
      opts.store.mode = next;
      if (preferredMode !== next) {
        opts.store.preferredMode = next;
        safeBrowserCall(() => browser.storage.sync.set({ preferredMode: next }));
      }
      applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
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
        applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
        setLoadingState(false);
      } else {
        const lang = forceLang ?? (await getTargetLang());

        let processed: ProcessedCache | null = null;
        if (next === 'romanized' && cache.processed.size > 0) {
          const entries = Array.from(cache.processed.values());
          processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0] ?? null;
        } else {
          processed = await fetchProcessed(cache.original, lang, cache, opts.store.songKey, opts.store.runtimeCache, opts.store.processGenRef);
        }

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
        applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
        setLoadingState(false);
      }
    } catch (err) {
      console.error('[SKaraoke:Content] Mode switch failed:', err);
      showToast('Translation failed. Please try again.', 3000);
      opts.store.mode = previousMode;
      syncButtonStates(previousMode);
    } finally {
      opts.store.isSwitchingMode = false;
      hideToast(true);
      setLoadingState(false);
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
    applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
  }

  function autoSwitchIfNeeded(): void {
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    if (mode === 'original' && preferredMode !== 'original') {
      switchMode(preferredMode);
    }
  }

  return { switchMode, reapplyMode, autoSwitchIfNeeded };
}
