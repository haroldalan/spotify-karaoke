import { isContextValid, safeBrowserCall } from '../utils/browserUtils';
import { applyLinesToDOM } from '../dom/lyricsDOM';
import { setPillVisibility } from '../dom/lyricsControls';
import type { SongCache, LyricsCacheEntry, LyricsMode } from './lyricsTypes';
import { StateStore } from './store';

export interface StorageListenerOpts {
  store: StateStore;
  onSwitchMode: (mode: LyricsMode, lang?: string) => void;
}

export function startStorageListener(opts: StorageListenerOpts): void {
  safeBrowserCall(async () => {
    browser.storage.onChanged.addListener((changes, area) => {
      if (!isContextValid()) return;
      if (area === 'local') {
        if ('lc_index' in changes && changes.lc_index.newValue === undefined) {
          opts.store.runtimeCache.clear();
        }
        return;
      }
      if (area !== 'sync') return;

      if ('targetLang' in changes) {
        const newLang = (changes.targetLang.newValue as string | undefined) ?? 'en';
        opts.store.currentActiveLang = newLang;
        if (opts.store.mode === 'translated') {
          opts.onSwitchMode('translated', newLang);
        }
      }

      if ('dualLyrics' in changes) {
        const newDual = (changes.dualLyrics.newValue as boolean | undefined) ?? true;
        opts.store.dualLyricsEnabled = newDual;
        const cache = opts.store.cache;
        if (opts.store.mode !== 'original' && cache.original.length > 0) {
          const processed = cache.processed.get(opts.store.currentActiveLang);
          if (processed) {
            const lines = opts.store.mode === 'romanized' ? processed.romanized : processed.translated;
            applyLinesToDOM(lines, newDual ? cache.original : undefined, newDual, (v) => { opts.store.isApplying = v; });
          }
        }
      }

      if ('preferredMode' in changes) {
        const newPref = (changes.preferredMode.newValue as LyricsMode | undefined) ?? 'original';
        opts.store.preferredMode = newPref;
        if (newPref !== opts.store.mode) {
          opts.onSwitchMode(newPref);
        }
      }

      if ('showPill' in changes) {
        const newShowPill = (changes.showPill.newValue as boolean | undefined) ?? true;
        opts.store.showPill = newShowPill;
        setPillVisibility(newShowPill);
      }
    });
  });
}
