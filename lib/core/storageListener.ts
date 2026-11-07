import { isContextValid, safeBrowserCall } from '../utils/browserUtils';
import { applyLinesToDOM } from '../dom/lyricsDOM';
import { setPillVisibility } from '../dom/lyricsControls';
import type { SongCache, LyricsCacheEntry, LyricsMode } from './lyricsTypes';
import { StateStore } from './store';
import { clearSessionProcessedCache } from './lyricsCache';

export interface StorageListenerOpts {
  store: StateStore;
  onSwitchMode: (mode: LyricsMode, lang?: string) => void;
  onReapplyMode: () => void;
  /** Called after a K7 cache reset cleared the content-side caches. */
  onCacheReset?: () => void;
}

/**
 * K7: the popup's "Reset Data" wrote sly_cacheResetAt. Drop every processed-lyrics
 * cache the content script owns so nothing stale comes back on replay/reload:
 * the in-memory runtime cache, the current song's processed results, the
 * sessionStorage mirror (sly_proc:*), pending native lines and canonical hashes.
 * (slyInternalState.l0Cache / window.slyRuntimeCache belong to slyCore.)
 */
export function resetContentCaches(store: StateStore): void {
  store.runtimeCache.clear();
  store.cache.processed.clear();
  store.pendingNativeLines.clear();
  store.canonicalHashes.clear();
  store.canonicalHash = null;
  const removed = clearSessionProcessedCache();
  console.log(`[sly-cache] 🧹 Cache reset: cleared runtime cache, processed results and ${removed} session entries.`);
}


export function startStorageListener(opts: StorageListenerOpts): void {
  safeBrowserCall(async () => {
    browser.storage.onChanged.addListener((changes, area) => {
      if (!isContextValid()) return;
      if (area === 'local') {
        if ('sly_cacheResetAt' in changes && changes.sly_cacheResetAt.newValue !== undefined) {
          resetContentCaches(opts.store);
          opts.onCacheReset?.();
          // Same coherence rule as BUG-12 below: no ghost processed DOM without data.
          if (opts.store.mode !== 'original') {
            opts.onSwitchMode('original');
          }
          return;
        }
        if ('lc_index' in changes && changes.lc_index.newValue === undefined) {
          opts.store.runtimeCache.clear();
          // BUG-12 Fix: If the cache is wiped, force-revert to original mode to
          // maintain coherence. Otherwise, the DOM stays in a "ghost" translated
          // state with no underlying data.
          if (opts.store.mode !== 'original') {
            opts.onSwitchMode('original');
          }
        }
        return;
      }
      if (area !== 'sync') return;

      let modeToSwitch: LyricsMode | null = null;
      let langToSwitch: string | null = null;

      if ('targetLang' in changes) {
        const newLang = (changes.targetLang.newValue as string | undefined) ?? 'en';
        opts.store.currentActiveLang = newLang;
        if (opts.store.mode === 'translated') {
          modeToSwitch = 'translated';
          langToSwitch = newLang;
        }
      }

      if ('dualLyrics' in changes) {
        const newDual = (changes.dualLyrics.newValue as boolean | undefined) ?? true;
        opts.store.dualLyricsEnabled = newDual;
        opts.onReapplyMode();
      }


      if ('preferredMode' in changes) {
        const newPref = (changes.preferredMode.newValue as LyricsMode | undefined) ?? 'original';
        opts.store.preferredMode = newPref;
        if (newPref !== opts.store.mode) {
          modeToSwitch = newPref;
          langToSwitch = null; // Use default
        }
      }

      if ('showPill' in changes) {
        const newShowPill = (changes.showPill.newValue as boolean | undefined) ?? true;
        opts.store.showPill = newShowPill;
        setPillVisibility(newShowPill);
      }

      // Batch: If multiple changes triggered a mode switch, only fire the final one.
      if (modeToSwitch) {
        opts.onSwitchMode(modeToSwitch, langToSwitch ?? undefined);
      }
    });
  });
}
