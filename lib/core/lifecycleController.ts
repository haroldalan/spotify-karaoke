import { safeBrowserCall } from '../utils/browserUtils';
import { getNowPlayingKey, hasLyrics, getLyricsContainer } from '../dom/domQueries';
import { snapshotOriginals, applyLinesToDOM } from '../dom/lyricsDOM';
import { applyNativeOverride } from './nativeLyricsHandler';
import { loadSongCache, saveSongCache } from './lyricsCache';
import { injectControls, syncButtonStates, CONTROLS_ID } from '../dom/lyricsControls';
import { createLyricsObserver } from '../dom/lyricsObserver';
import type { LyricsMode, SongCache, LyricsCacheEntry } from './lyricsTypes';
import { StateStore } from './store';

export interface LifecycleControllerOpts {
  store: StateStore;
  switchMode: (m: LyricsMode, forceLang?: string, suppressLoading?: boolean) => Promise<void>;
  reapplyMode: () => Promise<void>;
  autoSwitchIfNeeded: () => void;
}

export function createLifecycleController(opts: LifecycleControllerOpts) {

  async function trySetup(): Promise<void> {
    if (!opts.store.songKey) {
      const key = getNowPlayingKey();
      if (key) opts.store.songKey = key;
    }
    if (!hasLyrics()) return;
    const container = getLyricsContainer();
    if (!container) return;
    
    const cache = opts.store.cache;
    if (cache.original.length === 0) snapshotOriginals(cache);
    
    injectControls(container, opts.store.showPill, opts.store.mode, opts.store.preferredMode, opts.switchMode);
    
    opts.store.lyricsObserver?.disconnect();
    opts.store.lyricsObserver = createLyricsObserver({
      getIsApplying: () => opts.store.isApplying,
      getMode: () => opts.store.mode,
      getCache: () => opts.store.cache,
      getCurrentActiveLang: () => opts.store.currentActiveLang,
      getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
      setApplying: (v) => { opts.store.isApplying = v; },
      onInvalidate: () => { opts.store.lyricsObserver = null; },
    });
    
    await opts.reapplyMode();
    opts.autoSwitchIfNeeded();
  }

  function syncSetup(): void {
    if (!opts.store.songKey) {
      const key = getNowPlayingKey();
      if (key) opts.store.songKey = key;
    }
    const container = getLyricsContainer();
    if (!container) return;

    const cache = opts.store.cache;
    if (cache.original.length === 0) snapshotOriginals(cache);
    applyNativeOverride({ cache, pendingNativeLines: opts.store.pendingNativeLines });

    const runtimeEntry = opts.store.runtimeCache.get(opts.store.songKey);
    if (runtimeEntry) {
      if (runtimeEntry.original.length === cache.original.length) {
        cache.original = [...runtimeEntry.original];
        for (const [lang, res] of Object.entries(runtimeEntry.processed)) {
          cache.processed.set(lang, res);
        }
        saveSongCache(opts.store.songKey, cache, opts.store.runtimeCache);
      }
    }

    injectControls(container, opts.store.showPill, opts.store.mode, opts.store.preferredMode, opts.switchMode);
    
    opts.store.lyricsObserver?.disconnect();
    opts.store.lyricsObserver = createLyricsObserver({
      getIsApplying: () => opts.store.isApplying,
      getMode: () => opts.store.mode,
      getCache: () => opts.store.cache,
      getCurrentActiveLang: () => opts.store.currentActiveLang,
      getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
      setApplying: (v) => { opts.store.isApplying = v; },
      onInvalidate: () => { opts.store.lyricsObserver = null; },
    });

    if (opts.store.isSwitchingMode) {
      const currentPollId = opts.store.pollId;
      if (currentPollId) { cancelAnimationFrame(currentPollId); opts.store.pollId = null; }
      return;
    }

    const preferredMode = opts.store.preferredMode;
    if (preferredMode !== 'original') {
      const currentActiveLang = opts.store.currentActiveLang;
      let processed = cache.processed.get(currentActiveLang);
      if (!processed && preferredMode === 'romanized' && cache.processed.size > 0) {
        const entries = Array.from(cache.processed.values());
        processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
      }

      if (processed) {
        opts.store.mode = preferredMode;
        const lines = preferredMode === 'romanized' ? processed.romanized : processed.translated;
        const dualLyricsEnabled = opts.store.dualLyricsEnabled;
        applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
        syncButtonStates(preferredMode);
        const currentPollId = opts.store.pollId;
        if (currentPollId) { cancelAnimationFrame(currentPollId); opts.store.pollId = null; }
        return;
      }
    }

    const currentPollId = opts.store.pollId;
    if (currentPollId) { cancelAnimationFrame(currentPollId); opts.store.pollId = null; }
    opts.autoSwitchIfNeeded();
  }

  function pollForLyricsContainer(attempts = 0): void {
    if (attempts > 120) {
      if (attempts === 121) {
        console.log('[SKaraoke:Content] Lyrics panel still hidden, switching to slow poll fallback...');
      }
      if (attempts > 130) return; 
      setTimeout(() => pollForLyricsContainer(attempts + 1), 500);
      return;
    }
    if (hasLyrics() && getLyricsContainer()) {
      trySetup();
    } else {
      opts.store.pollId = requestAnimationFrame(() => pollForLyricsContainer(attempts + 1));
    }
  }

  function onSongChange(newKey: string): void {
    const songKey = opts.store.songKey;
    if (newKey === songKey) return;
    opts.store.songKey = newKey;
    opts.store.mode = 'original';
    opts.store.processGenRef.value++;
    opts.store.lyricsObserver?.disconnect();
    opts.store.lyricsObserver = null;
    opts.store.cache = { original: [], processed: new Map() };
    opts.store.pendingNativeLines.clear();

    safeBrowserCall(() => browser.storage.local.get(`lc:${newKey}`)).then((data) => {
      const entry = data?.[`lc:${newKey}`] as LyricsCacheEntry | undefined;
      if (entry) opts.store.runtimeCache.set(newKey, entry);
    }).catch(() => {});

    const controls = document.getElementById(CONTROLS_ID);
    if (controls) controls.classList.add('sly-loading');

    const currentPollId = opts.store.pollId;
    if (currentPollId) cancelAnimationFrame(currentPollId);
    pollForLyricsContainer();
  }

  return { trySetup, syncSetup, pollForLyricsContainer, onSongChange };
}
