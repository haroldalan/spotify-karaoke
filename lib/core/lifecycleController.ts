import { safeBrowserCall } from '../utils/browserUtils';
import { hashString } from '../utils/hashUtils';
import { getNowPlayingKey, getLyricsContainer, getLyricsViewRoot, getLyricsLines, getNowPlayingTrackId } from '../dom/domQueries';
import { snapshotOriginals, applyLinesToDOM } from '../dom/lyricsDOM';
import { applyNativeOverride } from './nativeLyricsHandler';
import { deleteSongCache, loadSongCache, saveSongCache, warmRuntimeCacheFromSession } from './lyricsCache';
import { injectControls, syncButtonStates, setLoadingState, setButtonsDisabled, CONTROLS_ID } from '../dom/lyricsControls';
import { parkPill } from '../dom/pillStateManager';
import { createLyricsObserver } from '../dom/lyricsObserver';
import { createSyncedLyricsRenderer, type LrcLine } from './syncedLyricsRenderer';
import type { LyricsMode, SongCache, LyricsCacheEntry } from './lyricsTypes';
import { StateStore } from './store';
import { slyInternalState, spotifyState } from '../slyCore/state';
import { TakeoverEngine } from '../slyCore/takeoverEngine';
import { MetadataEngine } from '../slyCore/metadataEngine';
import { StatusEngine } from '../slyCore/statusEngine';
import { slyForensics } from '../slyCore/forensics';

/**
 * lyricsObserver is module-level so both createLifecycleController and setupSlyBridge
 * can manage it without threading it through StateStore. Moved from StateStore in Step 5.
 */
let lyricsObserver: MutationObserver | null = null;

const clearHUDFlags = (store?: StateStore) => {
  StatusEngine.clear();
  if (!store || !store.isSwitchingMode) {
    setLoadingState(false);
  }
};

export function auditOriginalLyrics(store: StateStore): void {
  const { songKey, cache, preferredMode } = store;
  if (songKey && songKey !== store.lastAuditedSongKey && cache.original.length > 0) {
    store.lastAuditedSongKey = songKey;
    console.log(`[sly-audit] 🎵 Active Track: "${songKey}"`);
    console.groupCollapsed(`%c[sly-debug] 📋 ENTIRE ORIGINAL LYRICS ON LOAD (${cache.original.length} lines)`, 'color: #1DB954; font-weight: bold; font-size: 12px;');
    const table = cache.original.map((line, idx) => ({
      Index: idx,
      Original: line
    }));
    console.table(table);
    console.log(`[sly-audit] ⚙️ Active Preferred Mode: "${preferredMode}"`);
    console.groupEnd();
  }
}

const getTrackUri = () => (spotifyState?.track as { uri?: string } | null)?.uri;

export interface LifecycleControllerOpts {
  store: StateStore;
  switchMode: (m: LyricsMode, forceLang?: string, suppressLoading?: boolean) => Promise<void>;
  reapplyMode: () => Promise<void>;
  autoSwitchIfNeeded: (forceRefresh?: boolean, cacheOverride?: SongCache) => void;
}

export function createLifecycleController(opts: LifecycleControllerOpts) {
  const store = opts.store;
  // Internal implementation state moved from StateStore (Step 5).
  // Only used within this function's closure — not shared with setupSlyBridge.
  let cacheReadyPromise: Promise<void> | null = null;
  let pollId: number | null = null;
  let pendingKickTimer: ReturnType<typeof setTimeout> | null = null;
  function clearPoll() {
    if (pollId) {
      cancelAnimationFrame(pollId);
      window.clearTimeout(pollId);
      pollId = null;
    }
  }

  /**
   * Single owner of the mode pill.
   *
   * When `stateCtx` is a named state ('NATIVE_OK' | 'PIPELINE_A'), the injection
   * target is resolved deterministically from the extension's known state.
   * When `stateCtx` is a boolean or omitted, the legacy heuristic is used
   * (during the Step 1→2 transition, before the full sly:state bus is live).
   *
   * Crucially, this function performs a GLOBAL document search for the existing
   * pill — covering the document.body rescue location used by sly:release —
   * and relocates it to the correct container before delegating to injectControls().
   * injectControls() therefore never needs to re-parent.
   */
  function syncPill(stateCtx?: 'NATIVE_OK' | 'PIPELINE_A' | boolean) {
    const listCls = window.SPOTIFY_CLASSES?.lyricsList || 'GmI3DMxKYRsaA5DM';
    const customRoot = document.getElementById('lyrics-root-sync');

    let injectionTarget: HTMLElement | null;
    let shouldShow: boolean;

    if (stateCtx === 'NATIVE_OK') {
      // SLY FIX: Targeted injection logic for native lyrics container.
      const nativeContainer = getLyricsContainer();
      if (!nativeContainer || store.godState !== 'NATIVE_OK') return;
      injectionTarget = nativeContainer;
      shouldShow = store.showPill;
    } else if (stateCtx === 'PIPELINE_A') {
      // SLY FIX: Targeted injection logic for our own Pipeline A container.
      if (!customRoot || store.godState !== 'PIPELINE_A') return;
      const customInner = customRoot.querySelector(`.${listCls}`);
      injectionTarget = (customInner ?? customRoot) as HTMLElement;
      shouldShow = store.showPill;
    } else {
      // Heuristic path — used when state is not yet explicitly known.
      // Priority: Pipeline A inner list > native container > native shell.
      const root = getLyricsViewRoot();
      const container = getLyricsContainer();
      const customInner = customRoot?.querySelector(`.${listCls}`);
      injectionTarget = (customInner ?? container) as HTMLElement | null;
      const detection = window.slyDetectNativeState?.() ?? {};
      const hasContent = detection.hasNativeLines || store.slyActiveContainer?.isConnected;
      shouldShow = typeof stateCtx === 'boolean' ? (stateCtx && store.showPill) : (store.showPill && !!hasContent);
    }

    if (!injectionTarget) {
      return {
        container: getLyricsContainer(),
        root: getLyricsViewRoot(),
        injectionTarget: null,
        shouldShow,
      };
    }

    // Global pill relocation: find the pill anywhere in the document
    // (including document.body where sly:release rescues it) and move it
    // to the correct container before injectControls() runs.
    // injectControls() therefore never needs its own re-parenting logic.
    const existingPill = document.getElementById(CONTROLS_ID);
    if (existingPill && existingPill.parentElement !== injectionTarget) {
      injectionTarget.insertBefore(existingPill, injectionTarget.firstChild);
    }

    injectControls(injectionTarget, shouldShow, opts.store.mode, opts.store.preferredMode, opts.switchMode);

    return {
      container: getLyricsContainer(),
      root: getLyricsViewRoot(),
      injectionTarget,
      shouldShow,
    };
  }

  function verifyAndHealCache(cache: SongCache): void {
    if (store.isApplying) return;
    if (store.slyActiveContainer || document.getElementById('lyrics-root-sync') || store.godState === 'PIPELINE_A') return;

    const nativeLines = getLyricsLines().map(el => {
      const original = el.getAttribute('data-sly-original');
      return original !== null ? original : (el.textContent ?? '');
    });

    if (nativeLines.length === 0) return;

    // Hybrid State-Gate: if the DOM lines match the canonical hash, we can safely unlock the transition gate!
    if (slyInternalState.isTransitioning && store.canonicalHash !== null) {
      const entryHash = hashString(nativeLines.join('|'));
      if (Number(entryHash) === Number(store.canonicalHash)) {
        slyInternalState.isTransitioning = false;
        if ((window as any).slyTransitionTimeout) {
          clearTimeout((window as any).slyTransitionTimeout);
          (window as any).slyTransitionTimeout = null;
        }
        console.log('[sly-lifecycle] 🔓 Hash verification matches! Instantly unlocked transition gate.');
      }
    }

    if (slyInternalState.isTransitioning) return;
    if (slyInternalState?.currentLyrics && !slyInternalState.currentLyrics.failed) return;

    const registryState = (window as any).slyPreFetchRegistry?.getState(store.songKey);
    const nativeStatus = registryState?.nativeStatus;
    if (nativeStatus === 'UNSYNCED' || nativeStatus === 'MISSING') return;
    if (spotifyState?.isTimeSynced === false || spotifyState?.nativeHasLyrics === false) return;

    // Strict Hash Coherence check!
    if (store.canonicalHash !== null) {
      const currentHash = hashString(nativeLines.join('|'));
      
      // If DOM hash does not match canonical hash, DOM is still settling. Early exit.
      if (currentHash !== store.canonicalHash) {
        return;
      }
      
      console.log(`[sly-coherence] 🔒 DOM fully settled and matches canonical hash: ${currentHash}`);

      if (cache.original.length === 0) {
        snapshotOriginals(cache);
      } else {
        const cacheHash = hashString(cache.original.join('|'));
        if (currentHash !== cacheHash) {
          // Live verified DOM differs from Cache. Overwrite and heal.
          console.warn(`[sly-coherence] ⚠️ Cache Mismatch! Healing cache with verified DOM.`);
          cache.processed.clear();
          snapshotOriginals(cache);
          saveSongCache(opts.store.songKey, cache, opts.store.runtimeCache);
          
          applyLinesToDOM(cache.original, cache.original, false, (v) => { store.isApplying = v; });
        }
      }
    } else {
      // Fallback: If no canonical hash received yet, only snapshot when cache is completely empty and DOM is stable.
      if (cache.original.length === 0) {
        snapshotOriginals(cache);
      }
    }
  }

  async function trySetup(): Promise<void> {
    // Ensure viewport observer is connected dynamically
    if (opts.store.domObserver) {
      (opts.store.domObserver as any).connectViewport();
    }

    const entryKey = getNowPlayingKey();
    if (store.setupLock && store.lockOwnerKey === entryKey) return;
    store.setupLock = true;
    store.lockOwnerKey = entryKey;
    try {
    const activeKey = getNowPlayingKey();
    if (activeKey && opts.store.songKey !== activeKey) {
      console.log(`[sly-lifecycle] 🔄 trySetup detected out-of-sync songKey. Forcing onSongChange to ${activeKey}.`);
      onSongChange(activeKey);
    } else if (!opts.store.songKey && activeKey) {
      opts.store.songKey = activeKey;
    }
    
    const { container } = syncPill(true); // Force visibility instantly. Do not let Ghost Guard or async tasks hide it.

    if (!container) return; // Wait for actual lines before proceeding with content sync

    // SLY FIX: Synchronize track info on trySetup execution to ensure slyCore's fallback detector is aligned
    const meta = MetadataEngine.getNowPlaying();
    if (meta.uri && typeof (window as any).slyInternalState === 'object') {
      const sly = (window as any).slyInternalState;
      sly.lastUri = meta.uri;
      const titleFromKey = opts.store.songKey.replace('Now playing: ', '').split(' by ')[0] || '';
      if (titleFromKey) {
        sly.lastTitle = titleFromKey;
      }
    }

    console.log(`[sly-lifecycle] ⚙️ trySetup executing. activeKey: "${activeKey}", store.songKey: "${opts.store.songKey}"`);

    // Yield to Pipeline B if it's already working. This prevents the Native Pipeline
    // from proactively snapshotting (and potentially poisoning) the Romanization cache
    // if a Takeover is imminent.
    // Yield to Pipeline B if a HUD is active (godState) or lyrics data is pending (slyInternalState).
    if (store.godState === 'FETCHING' || store.godState === 'FAILED' || store.godState === 'AD' || slyInternalState.pendingLyricsData) {
      console.log('[sly-lifecycle] ⏳ Yielding trySetup: HUD active or pending lyrics.');
      // BUG-1 Fix: Break the temporal deadlock. trySetup found the lyrics container
      // (pollForLyricsContainer called us), but yields because pendingLyricsData is set.
      // The injection gate in slyCheckNowPlaying may not have fired yet (it waits for
      // isOnLyricsPage + non-LOADING lyrics state). Without this kick, neither side
      // proceeds: trySetup yields on pendingLyricsData, injection gate waits for DOM.
      // Schedule a delayed kick to give Spotify's React ~300ms to settle the DOM.
      if (slyInternalState.pendingLyricsData && (window as any).slyCheckNowPlaying) {
        const kickKey = opts.store.songKey;
        if (pendingKickTimer) clearTimeout(pendingKickTimer);
        pendingKickTimer = setTimeout(() => {
          pendingKickTimer = null;
          if (opts.store.songKey !== kickKey) return; // Song changed, abort
          if (!slyInternalState.pendingLyricsData) return; // Already consumed
          console.log('[sly-lifecycle] 🔄 BUG-1: Kicking injection gate after trySetup yield.');
          (window as any).slyCheckNowPlaying();
        }, 300);
      }
      return;
    }

    // Abort if slyCore is actively displaying custom lyrics. It handles its own pill injection.
    if (document.querySelector('main.' + (window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS') + '.sly-active')) {
      console.log('[sly-lifecycle] 🚫 Bridge trySetup aborted: slyCore is active.');
      return;
    }

    const currentKey = opts.store.songKey;
    if (cacheReadyPromise) {
      await cacheReadyPromise;
    }
    
    // Race Condition Guard: If the track changed while we were waiting for the cache, abort.
    if (opts.store.songKey !== currentKey) {
      console.warn('[sly] trySetup aborted: Track changed during cache wait.');
      return;
    }

    // FAST PATH: Apply processed lyrics BEFORE verifyAndHealCache can clear them.
    // verifyAndHealCache compares the live DOM against the cached originals. During the
    // frame(s) after a song change, React may still be incrementally rendering the native
    // lyrics — causing a spurious mismatch that wipes the processed cache. Applying the
    // cached result first and returning early avoids this race entirely.
    // This mirrors the identical fast path that already exists in syncSetup (lines 319-360).
    const fpPreferredMode = opts.store.preferredMode;
    if (fpPreferredMode !== 'original') {
      const fpLang = opts.store.currentActiveLang;
      const fpCache = opts.store.cache;
      let fpProcessed = fpCache.processed.get(fpLang);
      if (!fpProcessed && fpPreferredMode === 'romanized' && fpCache.processed.size > 0) {
        const entries = Array.from(fpCache.processed.values());
        fpProcessed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
      }
      if (fpProcessed) {
        // HASH VERIFICATION GUARD:
        if (opts.store.canonicalHash !== null) {
          const runtimeEntry = opts.store.runtimeCache.get(opts.store.songKey);
          const cacheHash = runtimeEntry?.originalHash ?? hashString(fpCache.original.join('|'));
          if (runtimeEntry && !runtimeEntry.originalHash) runtimeEntry.originalHash = cacheHash;

          if (Number(cacheHash) !== Number(opts.store.canonicalHash)) {
            console.warn(`[sly-lifecycle] trySetup fast path: Hash mismatch (${cacheHash} vs canonical ${opts.store.canonicalHash}). Discarding stale cache.`);
            deleteSongCache(opts.store.songKey, opts.store.runtimeCache);
            opts.store.cache = { original: [], processed: new Map() };
            fpProcessed = undefined;
          }
        }
      }
      if (fpProcessed) {
        opts.store.mode = fpPreferredMode;
        const fpLines = fpPreferredMode === 'romanized' ? fpProcessed.romanized : fpProcessed.translated;
        const fpDual = opts.store.dualLyricsEnabled;

        lyricsObserver?.disconnect();
        lyricsObserver = createLyricsObserver({
          getIsApplying: () => opts.store.isApplying,
          getMode: () => opts.store.mode,
          getCache: () => opts.store.cache,
          getCurrentActiveLang: () => opts.store.currentActiveLang,
          getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
          setApplying: (v) => { opts.store.isApplying = v; },
          onInvalidate: () => { lyricsObserver = null; },
        });

        applyLinesToDOM(fpLines, fpCache.original, fpDual, (v) => { opts.store.isApplying = v; });
        opts.store.lyricsAppliedForKey = opts.store.songKey;
        syncButtonStates(fpPreferredMode);
        setLoadingState(false);
        clearHUDFlags(store);
        console.log(`[sly-lifecycle] ✅ Bridge trySetup complete (hot cache fast path, 0 flicker).`);
        return;
      }
    }

    const cache = opts.store.cache;
    verifyAndHealCache(cache);
    auditOriginalLyrics(opts.store);

    lyricsObserver?.disconnect();
    lyricsObserver = createLyricsObserver({
      getIsApplying: () => opts.store.isApplying,
      getMode: () => opts.store.mode,
      getCache: () => opts.store.cache,
      getCurrentActiveLang: () => opts.store.currentActiveLang,
      getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
      setApplying: (v) => { opts.store.isApplying = v; },
      onInvalidate: () => { lyricsObserver = null; },
    });

      const s = performance.now();

      // SHIMMER TRIGGER (cold-cache, non-original mode):
      // If preferredMode is Romanized/Translated and the processed cache is empty,
      // a background PROCESS fetch is about to start via reapplyMode/autoSwitchIfNeeded.
      // We fire setLoadingState(true) here — synchronously before the async work —
      // so the shimmer is immediately visible. Without this, the processing window
      // is completely silent with no visual feedback.
      //
      // This does NOT fire for the hot-cache fast path (which returns early above)
      // or for original mode (nothing to process).
      if (opts.store.preferredMode !== 'original' && opts.store.cache.processed.size === 0) {
        setLoadingState(true);
      }

      await opts.reapplyMode();
      opts.autoSwitchIfNeeded();

      
      // Setup successful. Clear any stale loading HUDs.
      clearHUDFlags(store);

      const e = performance.now();
      console.log(`[sly-lifecycle] ✅ Bridge trySetup complete. Pill injected/updated (${(e - s).toFixed(2)}ms).`);
    } finally {
      if (store.lockOwnerKey === entryKey) {
        store.setupLock = false;
        store.lockOwnerKey = null;
      }
    }
  }

  async function syncSetup(): Promise<void> {
    const entryKey = getNowPlayingKey();
    if (store.setupLock && store.lockOwnerKey === entryKey) return;
    store.setupLock = true;
    store.lockOwnerKey = entryKey;
    try {
      const activeKey = getNowPlayingKey();
      if (activeKey && opts.store.songKey !== activeKey) {
        console.log(`[sly-lifecycle] 🔄 syncSetup detected out-of-sync songKey. Forcing onSongChange to ${activeKey}.`);
        onSongChange(activeKey);
      } else if (!opts.store.songKey && activeKey) {
        opts.store.songKey = activeKey;
      }
      syncPill(true); // Force visibility instantly. Do not let Ghost Guard or async tasks hide it.
      const container = getLyricsContainer();
      if (!container) return;

      // Yield to Pipeline B if it's already working
      // Yield to Pipeline B if a HUD is active (godState) or lyrics data is pending (slyInternalState).
      if (store.godState === 'FETCHING' || store.godState === 'FAILED' || store.godState === 'AD' || slyInternalState.pendingLyricsData) {
        console.log('[sly-lifecycle] ⏳ Yielding syncSetup: HUD active or pending lyrics.');
        // BUG-1 Fix: Same deadlock-breaking kick as trySetup (see above).
        if (slyInternalState.pendingLyricsData && (window as any).slyCheckNowPlaying) {
          const kickKey = opts.store.songKey;
          if (pendingKickTimer) clearTimeout(pendingKickTimer);
          pendingKickTimer = setTimeout(() => {
            pendingKickTimer = null;
            if (opts.store.songKey !== kickKey) return;
            if (!slyInternalState.pendingLyricsData) return;
            console.log('[sly-lifecycle] 🔄 BUG-1: Kicking injection gate after syncSetup yield.');
            (window as any).slyCheckNowPlaying();
          }, 300);
        }
        return;
      }

      // Abort if slyCore is actively displaying custom lyrics. It handles its own pill injection.
      // This prevents the Native pipeline from "stealing" the pill back from the Takeover container.
      const mainCls = window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS';
      if (opts.store.slyActiveContainer || document.querySelector(`main.${mainCls}.sly-active`) || document.getElementById('lyrics-root-sync')) {
        console.log('[sly-lifecycle] 🚫 Bridge syncSetup aborted: slyCore is active.');
        return;
      }

      const currentKey = opts.store.songKey;

      // Synchronously pre-warm from in-memory runtime cache to eliminate the async yield frame-flash (port of v3.0.6).
      const runtimeEntry = opts.store.runtimeCache.get(opts.store.songKey);
      if (runtimeEntry) {
        // HASH VERIFICATION GUARD:
        if (opts.store.canonicalHash !== null) {
          const entryHash = runtimeEntry.originalHash ?? hashString(runtimeEntry.original.join('|'));
          if (!runtimeEntry.originalHash) runtimeEntry.originalHash = entryHash;

          if (Number(entryHash) !== Number(opts.store.canonicalHash)) {
            console.warn(`[sly-lifecycle] syncSetup pre-warm: Hash mismatch (${entryHash} vs canonical ${opts.store.canonicalHash}). Discarding stale cache.`);
            deleteSongCache(opts.store.songKey, opts.store.runtimeCache);
          } else {
            if (opts.store.cache.original.length === 0) opts.store.cache.original = [...runtimeEntry.original];
            for (const [lang, res] of Object.entries(runtimeEntry.processed)) {
              if (!opts.store.cache.processed.has(lang)) opts.store.cache.processed.set(lang, res);
            }
          }
        } else {
          if (opts.store.cache.original.length === 0) opts.store.cache.original = [...runtimeEntry.original];
          for (const [lang, res] of Object.entries(runtimeEntry.processed)) {
            if (!opts.store.cache.processed.has(lang)) opts.store.cache.processed.set(lang, res);
          }
        }
      }

      const syncPreferredMode = opts.store.preferredMode;
      if (syncPreferredMode !== 'original') {
        const currentActiveLang = opts.store.currentActiveLang;
        let processed = opts.store.cache.processed.get(currentActiveLang);
        if (!processed && syncPreferredMode === 'romanized' && opts.store.cache.processed.size > 0) {
          const entries = Array.from(opts.store.cache.processed.values());
          processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
        }

        if (processed) {
          // HASH VERIFICATION GUARD:
          if (opts.store.canonicalHash !== null) {
            const runtimeEntry = opts.store.runtimeCache.get(opts.store.songKey);
            const cacheHash = runtimeEntry?.originalHash ?? hashString(opts.store.cache.original.join('|'));
            if (runtimeEntry && !runtimeEntry.originalHash) runtimeEntry.originalHash = cacheHash;

            if (Number(cacheHash) !== Number(opts.store.canonicalHash)) {
              console.warn(`[sly-lifecycle] syncSetup fast path: Hash mismatch (${cacheHash} vs canonical ${opts.store.canonicalHash}). Discarding stale cache.`);
              deleteSongCache(opts.store.songKey, opts.store.runtimeCache);
              opts.store.cache = { original: [], processed: new Map() };
              processed = undefined;
            }
          }
        }

        if (processed) {
          verifyAndHealCache(opts.store.cache);
          auditOriginalLyrics(opts.store);
          applyNativeOverride(opts.store.songKey, { cache: opts.store.cache, pendingNativeLines: opts.store.pendingNativeLines });

          lyricsObserver?.disconnect();
          lyricsObserver = createLyricsObserver({
            getIsApplying: () => opts.store.isApplying,
            getMode: () => opts.store.mode,
            getCache: () => opts.store.cache,
            getCurrentActiveLang: () => opts.store.currentActiveLang,
            getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
            setApplying: (v) => { opts.store.isApplying = v; },
            onInvalidate: () => { lyricsObserver = null; },
          });

          opts.store.mode = syncPreferredMode;
          const lines = syncPreferredMode === 'romanized' ? processed.romanized : processed.translated;
          const dualLyricsEnabled = opts.store.dualLyricsEnabled;
          applyLinesToDOM(lines, opts.store.cache.original, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
          syncButtonStates(syncPreferredMode);
          setLoadingState(false);
          
          // Native lyrics applied. Clear any fetching/loading HUDs.
          clearHUDFlags(store);
          
          syncPill('NATIVE_OK');

          clearPoll();

          opts.store.lyricsAppliedForKey = opts.store.songKey;
          document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
          return; // Instant, fully synchronous return! ZERO frames flashed!
        }
      }

      // Safety fallback: Wait for storage.local read to finish if cache wasn't in memory
      if (cacheReadyPromise) {
        await cacheReadyPromise;
      }

      // Race Condition Guard: If the track changed while we were waiting for the cache, abort.
      if (opts.store.songKey !== currentKey) {
        console.warn('[sly] syncSetup aborted: Song key changed during cache wait.');
        return;
      }
      // POST-STORAGE FAST PATH: Apply processed lyrics before verifyAndHealCache can clear them.
      // On hard reload, cacheReadyPromise is a real storage.local read. Once it resolves the
      // processed data is available, but verifyAndHealCache may still clear it if the native DOM
      // hasn't fully settled yet. Apply here (same guard as trySetup fast path) to eliminate
      // the cold-start original→romanized flash.
      const spPreferredMode = opts.store.preferredMode;
      if (spPreferredMode !== 'original') {
        const spLang = opts.store.currentActiveLang;
        const spCache = opts.store.cache;
        let spProcessed = spCache.processed.get(spLang);
        if (!spProcessed && spPreferredMode === 'romanized' && spCache.processed.size > 0) {
          const entries = Array.from(spCache.processed.values());
          spProcessed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
        }
        if (spProcessed) {
          // HASH VERIFICATION GUARD:
          if (opts.store.canonicalHash !== null) {
            const runtimeEntry = opts.store.runtimeCache.get(opts.store.songKey);
            const cacheHash = runtimeEntry?.originalHash ?? hashString(spCache.original.join('|'));
            if (runtimeEntry && !runtimeEntry.originalHash) runtimeEntry.originalHash = cacheHash;

            if (Number(cacheHash) !== Number(opts.store.canonicalHash)) {
              console.warn(`[sly-lifecycle] syncSetup post-storage fast path: Hash mismatch (${cacheHash} vs canonical ${opts.store.canonicalHash}). Discarding stale cache.`);
              deleteSongCache(opts.store.songKey, opts.store.runtimeCache);
              opts.store.cache = { original: [], processed: new Map() };
              spProcessed = undefined;
            }
          }
        }
        if (spProcessed) {
          opts.store.mode = spPreferredMode;
          const spLines = spPreferredMode === 'romanized' ? spProcessed.romanized : spProcessed.translated;
          const spDual = opts.store.dualLyricsEnabled;

          syncPill('NATIVE_OK');

          lyricsObserver?.disconnect();
          lyricsObserver = createLyricsObserver({
            getIsApplying: () => opts.store.isApplying,
            getMode: () => opts.store.mode,
            getCache: () => opts.store.cache,
            getCurrentActiveLang: () => opts.store.currentActiveLang,
            getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
            setApplying: (v) => { opts.store.isApplying = v; },
            onInvalidate: () => { lyricsObserver = null; },
          });

          applyLinesToDOM(spLines, spCache.original, spDual, (v) => { opts.store.isApplying = v; });
          opts.store.lyricsAppliedForKey = opts.store.songKey;
          syncButtonStates(spPreferredMode);
          setLoadingState(false);
          clearHUDFlags(store);
          document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
          console.log('[sly-lifecycle] ✅ Bridge syncSetup complete (post-storage fast path, 0 flicker).');
          return;
        }
      }

      verifyAndHealCache(opts.store.cache);

      auditOriginalLyrics(opts.store);
      applyNativeOverride(opts.store.songKey, { cache: opts.store.cache, pendingNativeLines: opts.store.pendingNativeLines });

      // BUG-5 Fix: Only call loadSongCache if the processed map is still empty.
      // The synchronous runtimeCache pre-warm above (lines ~311-317) or the first
      // cacheReadyPromise call may have already populated cache. Calling loadSongCache
      // again when data is warm is redundant and triggers an unnecessary
      // SLY_UPDATE_L0_INDEX storage write on every panel reopen.
      if (opts.store.cache.processed.size === 0) {
        await loadSongCache(opts.store.songKey, opts.store.cache, opts.store.runtimeCache);
      }

      // BUG-10 Fix: If cache.original is still empty, snapshotOriginals returned
      // early because the lyrics DOM had < 3 non-empty lines (still loading).
      // Schedule a 500ms retry so the hash coherence gate is not bypassed on the
      // next loadSongCache call with a populated DOM.
      if (opts.store.cache.original.length === 0) {
        const retryKey = opts.store.songKey;
        setTimeout(() => {
          // Abort if the song changed while we were waiting.
          if (opts.store.songKey !== retryKey) return;
          // Abort if Pipeline A has taken over.
          if (opts.store.slyActiveContainer || document.getElementById('lyrics-root-sync')) return;
          snapshotOriginals(opts.store.cache);
          if (opts.store.cache.original.length > 0) {
            console.log('[sly-lifecycle] BUG-10 retry: snapshot succeeded. Reloading cache with hash coherence.');
            loadSongCache(retryKey, opts.store.cache, opts.store.runtimeCache).then(() => {
              opts.reapplyMode();
            });
          }
        }, 500);
      }

      // State-driven pill injection: pill belongs in the native lyrics container.
      // syncPill() performs a global document search (covers document.body rescue
      // location from sly:release) so the pill is always correctly relocated here.
      syncPill('NATIVE_OK');

      lyricsObserver?.disconnect();
      lyricsObserver = createLyricsObserver({
        getIsApplying: () => opts.store.isApplying,
        getMode: () => opts.store.mode,
        getCache: () => opts.store.cache,
        getCurrentActiveLang: () => opts.store.currentActiveLang,
        getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
        setApplying: (v) => { opts.store.isApplying = v; },
        onInvalidate: () => { lyricsObserver = null; },
      });

      if (opts.store.isSwitchingMode) {
        clearPoll();
        return;
      }

      const preferredMode = opts.store.preferredMode;
      if (preferredMode !== 'original') {
        const currentActiveLang = opts.store.currentActiveLang;
        // V17 Fix: Use opts.store.cache consistently instead of mixing with
        // the outer closure's 'cache' variable. They currently reference the same
        // object, but this is fragile if store.cache is ever reassigned.
        let processed = opts.store.cache.processed.get(currentActiveLang);
        if (!processed && preferredMode === 'romanized' && opts.store.cache.processed.size > 0) {
          const entries = Array.from(opts.store.cache.processed.values());
          processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
        }

        if (processed) {
          opts.store.mode = preferredMode;
          const lines = preferredMode === 'romanized' ? processed.romanized : processed.translated;
          const dualLyricsEnabled = opts.store.dualLyricsEnabled;
          applyLinesToDOM(lines, opts.store.cache.original, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
          opts.store.lyricsAppliedForKey = opts.store.songKey;
          syncButtonStates(preferredMode);
          setLoadingState(false);
          
          // Native lyrics applied. Clear any fetching/loading HUDs.
          clearHUDFlags(store);

          clearPoll();
          opts.store.lyricsAppliedForKey = opts.store.songKey;
          return;
        }
      }

      if (opts.store.mode === opts.store.preferredMode && opts.store.songKey === opts.store.lyricsAppliedForKey && document.getElementById(CONTROLS_ID)?.parentElement === getLyricsContainer()) {
        return;
      }

      clearPoll();
      opts.autoSwitchIfNeeded();

      const s = performance.now();
      // Notify slyCore that native lyrics are in the DOM. Triggers its injection
      // gate immediately for the common case (fetch completed before panel opened),
      // eliminating up to 500ms of poll latency. Poll remains fallback for slow fetches.
      document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
      const e = performance.now();
      console.log(`[sly-lifecycle] ✅ Bridge syncSetup complete. Native lyrics identified (${(e - s).toFixed(2)}ms).`);
    } finally {
      if (store.lockOwnerKey === entryKey) {
        store.setupLock = false;
        store.lockOwnerKey = null;
      }
    }
  }


  let discoveryTime = 0;

  function pollForLyricsContainer(attempts = 0): void {
    // Ensure viewport observer is connected dynamically
    if (opts.store.domObserver) {
      (opts.store.domObserver as any).connectViewport();
    }

    if (attempts === 0) discoveryTime = performance.now();

    // Abort poll if slyCore is actively displaying custom lyrics.
    const mainCls = (window as any).SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS';
    if (document.getElementById('lyrics-root-sync') || document.querySelector(`main.${mainCls}.sly-active`)) {
      return;
    }

    if (attempts > 120) {
      if (attempts === 121) {
        console.log('[SKaraoke:Content] Lyrics panel still hidden, switching to infinite slow poll fallback...');
      }
      pollId = window.setTimeout(() => pollForLyricsContainer(attempts + 1), 2000) as unknown as number;
      return;
    }

    const root = getLyricsViewRoot();
    const container = getLyricsContainer();
    
    if (container) {
      const foundTime = performance.now();
      console.log(`[sly-lifecycle] 🔍 Full lyrics container detected after ${(foundTime - discoveryTime).toFixed(2)}ms.`);
      trySetup();
      // We found the lines, we can stop polling.
    } else if (root) {
      const foundTime = performance.now();
      if (attempts === 0 || attempts % 10 === 0) {
        console.log(`[sly-lifecycle] 🔍 Lyrics view root detected after ${(foundTime - discoveryTime).toFixed(2)}ms. Waiting for lines (attempt ${attempts})...`);
      }
      trySetup(); // Call once to inject the pill into the shell
      // View root found but lines missing — poll again with a slight delay
      pollId = window.setTimeout(() => pollForLyricsContainer(attempts + 1), 300) as unknown as number;
    } else {
      pollId = requestAnimationFrame(() => pollForLyricsContainer(attempts + 1));
    }
  }


  function onSongChange(newKey: string): void {
    if (!newKey || newKey === 'undefined' || newKey === 'null') return;
    const songKey = opts.store.songKey;
    console.log(`[sly-lifecycle] 🔄 onSongChange triggered. Moving from "${songKey || 'None'}" ➡️ "${newKey}". Synchronously purging TAKEOVER elements.`);
    
    TakeoverEngine.purge();
    StatusEngine.clear();

    if (newKey === songKey) return;

    // BUG-29 Note: The interceptor heartbeat (interceptorActive) is reset to false by
    // ui.ts TRACK_SWITCH before this onSongChange handler fires. Checking it here
    // produces a false positive on every song change. slyCore's content.ts manages
    // interceptorFailed with accurate self-healing logic (sets true if still missing,
    // resets to false when the interceptor confirms activity for the new track).


    // Synchronously clear slyCore's currentLyrics to prevent stale restore/re-injection race conditions
    if (typeof (window as any).slyInternalState === 'object') {
      const sly = (window as any).slyInternalState;
      console.log('[sly-lifecycle] Synchronously clearing slyCore fetching/HUD state to prevent stale restore.');
      sly.currentLyrics = null;
      sly.lastDecision = '';
      sly.fetchingForUri.clear();
      sly.fetchingForTitle = '';
      sly.isFetchingHUD = false;
      sly.statusHUDActive = false;
      sly.isAdHUDActive = false;
      sly.forceFallback = false;

      // Transactional State-Gate: lock the transition phase
      sly.isTransitioning = true;
      if ((window as any).slyTransitionTimeout) clearTimeout((window as any).slyTransitionTimeout);
      (window as any).slyTransitionTimeout = setTimeout(() => {
        if (typeof (window as any).slyInternalState === 'object') {
          (window as any).slyInternalState.isTransitioning = false;
          console.log('[sly-lifecycle] ⏰ Transition timeout fallback triggered. Clearing isTransitioning.');
        }
      }, 1500);
    }

    // SLY FIX (Magical Seamless Swap): If we have a VALID L0 takeover hit, 
    // do NOT destroy the takeover container or remove 'sly-active'.
    // We lookup by URI (consistent with ui.ts) instead of the songKey string.
    
    // SLY FIX: Robust URI extraction via MetadataEngine.
    // Handles race conditions where DOM widget is not yet ready.
    const meta = MetadataEngine.getNowPlaying();
    const titleFromKey = newKey.replace('Now playing: ', '').split(' by ')[0] || '';
    const isStateStale = meta.title && titleFromKey && meta.title.toLowerCase() !== titleFromKey.toLowerCase();
    const isUriStale = isStateStale && !getNowPlayingTrackId();
    const uri = isUriStale ? null : meta.uri;

    // SLY FIX: Synchronize track info immediately to slyInternalState to prevent the double-reset race
    if (typeof (window as any).slyInternalState === 'object') {
      const sly = (window as any).slyInternalState;
      if (uri) sly.lastUri = uri;
      if (titleFromKey) sly.lastTitle = titleFromKey;
    }

    const l0Hit = uri ? (window as any).slyInternalState?.l0Cache?.get(uri) : null;
    const isNativeSynced = uri ? (window as any).slyPreFetchRegistry?.getState(uri)?.nativeStatus === 'SYNCED' : false;

    const isTakeoverHit = !!(l0Hit && !l0Hit.failed && !isNativeSynced && (l0Hit.lines || l0Hit.syncedLyrics || l0Hit.plainLyrics));

    if (!isTakeoverHit) {
      // Synchronously destroy the custom takeover container instantly on track skip
      // to eliminate the staggered unmount/delay for Takeover tracks.
      document.querySelectorAll('#lyrics-root-sync').forEach(el => el.remove());
      document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`)?.classList.remove('sly-active');
    }

    // Revert the dual lyrics DOM to their single original native text
    // to ensure both lines disappear cleanly and simultaneously during track change.
    // This also keeps React's reconciler completely happy on unmount.
    getLyricsLines().forEach((el) => {
      const original = el.getAttribute('data-sly-original');
      if (original !== null) {
        el.textContent = original;
        el.removeAttribute('data-sly-original');
      }
    });

    if (newKey) store.lastAuditedSongKey = '';
    store.godState = 'LOADING'; // Track is changing — no stable pill target until next state event.
    store.songKey = newKey;
    
    // Synchronize canonicalHash from pre-warm map for the new song
    const trackId = getNowPlayingTrackId();
    store.canonicalHash = trackId ? (store.canonicalHashes.get(trackId) ?? null) : null;
    console.log(`[sly-lifecycle] 🔄 Set active canonicalHash to: ${store.canonicalHash} for track ${trackId}`);

    // mode represents what is actually painted, not what the user wants.
    // The preferred mode is applied only after processed lines reach the DOM.
    store.mode = 'original';
    store.lyricsAppliedForKey = '';
    store.isSwitchingMode = false;
    store.romanizedGenRef.value++;
    store.translatedGenRef.value++;
    store.globalProcessGenRef.value++;
    store.switchGenRef.value++;
    lyricsObserver?.disconnect();
    lyricsObserver = null;
    opts.store.cache = { original: [], processed: new Map() };
    opts.store.pendingNativeLines.clear();
    opts.store.slyActiveContainer = null;
    opts.store.slyActiveDomElements = [];


    // Session-cache warm: synchronously hydrate runtimeCache from sessionStorage
    // before the hasHotCache check. On a within-tab reload (Ctrl+Shift+R) the
    // in-memory runtimeCache is empty but sessionStorage still holds the last
    // save. warmRuntimeCacheFromSession populates runtimeCache in one synchronous
    // JSON.parse, making hasHotCache=true and routing through the existing
    // zero-flash hot-cache fast path without any async storage read.
    warmRuntimeCacheFromSession(newKey, opts.store.runtimeCache);

    const hasHotCache = opts.store.runtimeCache.has(newKey);
    console.log(`[sly-lifecycle] 🗄️ onSongChange cache path: hasHotCache=${hasHotCache} for "${newKey.slice(0, 60)}..."`);
    if (hasHotCache) {
      const runtimeEntry = opts.store.runtimeCache.get(newKey);
      if (runtimeEntry) {
        opts.store.cache.original = [...runtimeEntry.original];
        for (const [lang, res] of Object.entries(runtimeEntry.processed)) {
          opts.store.cache.processed.set(lang, res);
        }
      }

      // IMMEDIATE OBSERVER (hot cache only): Wires up the lyricsObserver synchronously
      // so it's in place before any React re-render of the lyrics list. Only created
      // when the lyrics panel is already open (getLyricsViewRoot() returns non-null);
      // createLyricsObserver returns null when the panel is closed, so this is a no-op
      // when the user is navigating with the panel closed. trySetup/syncSetup recreate
      // it correctly when they first run with a valid container.
      if (store.preferredMode !== 'original') {
        lyricsObserver?.disconnect();
        lyricsObserver = createLyricsObserver({
          getIsApplying: () => opts.store.isApplying,
          getMode: () => opts.store.mode,
          getCache: () => opts.store.cache,
          getCurrentActiveLang: () => opts.store.currentActiveLang,
          getDualLyricsEnabled: () => opts.store.dualLyricsEnabled,
          setApplying: (v) => { opts.store.isApplying = v; },
          onInvalidate: () => { lyricsObserver = null; },
        });
        console.log(`[sly-lifecycle] 🔭 onSongChange IMMEDIATE OBSERVER (hot cache): ${lyricsObserver ? 'created ✅' : 'null (panel closed) ⚠️'}`);
      }

      // BUG-7 Fix
      cacheReadyPromise = Promise.resolve();
      cacheReadyPromise.finally(() => { cacheReadyPromise = null; });
    } else {
      const loadPromise = loadSongCache(newKey, opts.store.cache, opts.store.runtimeCache);
      cacheReadyPromise = loadPromise;
      cacheReadyPromise.finally(() => { cacheReadyPromise = null; });

      // REACTIVE APPLY: when the storage read finishes, immediately re-apply
      // processed lyrics to whatever DOM is present at that moment.
      //
      // Problem: the lyricsObserver fires as soon as lyrics appear in the DOM,
      // but cache.processed is empty (read still in flight) so it bails out.
      // syncSetup then awaits the pending cacheReadyPromise, yielding to the
      // task queue — the browser paints original lyrics during that gap.
      //
      // Fix: chain .then(reapplyMode) so the moment the storage read resolves,
      // processed lyrics are applied regardless of whether the DOM appeared
      // before or after the read. If the DOM isn't ready yet, reapplyMode
      // finds no lines and no-ops; the lyricsObserver or next trySetup call
      // will apply once lines exist (now with a populated cache).
      loadPromise.then(() => {
        if (opts.store.songKey !== newKey) return;           // song changed mid-flight
        if (opts.store.slyActiveContainer) return;           // Pipeline A owns the DOM
        if (document.getElementById('lyrics-root-sync')) return; // takeover active
        if (opts.store.preferredMode === 'original') return; // nothing to process
        if (opts.store.cache.processed.size === 0) return;  // cache empty (fetch failed)
        // NEW-SESSION COLD-CACHE FIX:
        // Call quickApply() directly instead of autoSwitchIfNeeded(forceRefresh=true).
        //
        // Problem: autoSwitchIfNeeded → switchMode is async. Even when all processed data
        // is already in cache.processed (just populated by loadSongCache above), switchMode
        // still yields microtask ticks via its async function frame — giving the browser a
        // chance to paint original lyrics before the processed ones are applied.
        //
        // quickApply() is fully synchronous: it reads from cache.processed and writes to
        // the DOM in one call, with no awaits. Running it here, inside the .then() callback,
        // means it executes in the same microtask batch as the storage-read resolution —
        // before the browser can paint a frame.
        //
        // autoSwitchIfNeeded(forceRefresh=true) still runs as a fallback for the case where
        // the DOM isn't ready yet (quickApply bails if getLyricsLines() is empty). In that
        // case the lyricsObserver or the next trySetup/syncSetup call will apply the data
        // once lines exist — now with a fully populated cache.
        quickApply();
        if (getLyricsLines().length === 0) {
          // DOM not ready yet — fall back to the full async path so the processed
          // lyrics are applied once lines appear (via lyricsObserver or trySetup).
          opts.autoSwitchIfNeeded(true);
        }
      });
    }

    // Clear stale container references immediately so autoSwitchIfNeeded
    // doesn't write into detached DOM nodes before the slyCore poll fires.
    opts.store.slyActiveContainer = null;
    opts.store.slyActiveDomElements = [];

    // For cold-cache songs (never played before): park the pill on document.body
    // in a visible loading state instead of deleting it. This ensures the user
    // never sees it disappear while we wait for the new lyrics container to load.
    //
    // For hot-cache songs (already played this session): the pill may still be
    // in a prior container; leave it alone — syncPill() in trySetup/syncSetup
    // will relocate it once the new container is ready.
    if (!hasHotCache) {
      parkPill(opts.store.preferredMode, opts.store.showPill);
    } else {
      // Hot cache: just ensure the pill is not in loading state.
      const controls = document.getElementById(CONTROLS_ID);
      controls?.classList.remove('sly-loading');
    }

    clearPoll();

    pollForLyricsContainer();

    // Notify slyCore of the track change reactively so it no longer needs to
    // detect this in its 500ms poll. URI is sourced from window.spotifyState
    // which slyCore's scanner already populates — no new coupling.
    if (uri && uri !== 'undefined' && uri !== 'null') {
      document.dispatchEvent(new CustomEvent('sly:song_change', { detail: { uri } }));
    }
    // Wake up the main polling loop instantly on track change to bypass Spotify search latency
    if (typeof (window as any).slyStartThrottledPoll === 'function') {
      (window as any).slyStartThrottledPoll();
    }
  }

  function trySetupOrPoll(): void {
    if (getLyricsContainer()) {
      trySetup();
    } else {
      pollForLyricsContainer();
    }
  }

  /**
   * Lock-free synchronous fast-apply called directly from onLyricsInjected.
   *
   * Problem: when lyrics lines appear in the DOM, the domObserver fires
   * onLyricsInjected → syncSetup. But if trySetup already holds the setupLock
   * (its poll timer fired at the same moment), syncSetup returns immediately
   * without applying processed lyrics — leaving original text visible until
   * trySetup completes its full async cycle.
   *
   * Fix: perform the critical synchronous apply here, BEFORE syncSetup even
   * tries the lock. This runs as a MutationObserver microtask — before the
   * browser can paint — so processed lyrics are written before the first frame.
   *
   * Priority: runtimeCache (hot, same-session) → cache.processed (warmed by
   * reactive .then() or prior load) → bail (let syncSetup handle the full flow).
   */
  function quickApply(): void {
    if (opts.store.preferredMode === 'original') return;
    if (opts.store.slyActiveContainer) return;
    if (document.getElementById('lyrics-root-sync')) return;

    const domLines = getLyricsLines();
    if (domLines.length === 0) return;

    const songKey = opts.store.songKey;
    const preferredMode = opts.store.preferredMode;
    const currentActiveLang = opts.store.currentActiveLang;

    // Try runtimeCache first (populated for same-session repeats)
    let processed = opts.store.cache.processed.get(currentActiveLang);
    if (!processed && preferredMode === 'romanized' && opts.store.cache.processed.size > 0) {
      const entries = Array.from(opts.store.cache.processed.values());
      processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
    }

    if (processed && opts.store.canonicalHash !== null) {
      const runtimeEntry = opts.store.runtimeCache.get(opts.store.songKey);
      const cacheHash = runtimeEntry?.originalHash ?? hashString(opts.store.cache.original.join('|'));
      if (runtimeEntry && !runtimeEntry.originalHash) runtimeEntry.originalHash = cacheHash;

      if (Number(cacheHash) !== Number(opts.store.canonicalHash)) {
        console.warn(`[sly-lifecycle] quickApply: Hash mismatch (${cacheHash} vs canonical ${opts.store.canonicalHash}). Discarding stale cache.`);
        deleteSongCache(opts.store.songKey, opts.store.runtimeCache);
        opts.store.cache = { original: [], processed: new Map() };
        processed = undefined;
      }
    }

    // Fallback: check runtimeCache directly in case onSongChange's pre-warm ran
    // but the cache object was replaced before the entries were copied over.
    if (!processed) {
      const runtimeEntry = opts.store.runtimeCache.get(songKey);
      if (runtimeEntry) {
        if (opts.store.canonicalHash !== null) {
          const entryHash = runtimeEntry.originalHash ?? hashString(runtimeEntry.original.join('|'));
          if (!runtimeEntry.originalHash) runtimeEntry.originalHash = entryHash;

          if (Number(entryHash) !== Number(opts.store.canonicalHash)) {
            console.warn(`[sly-lifecycle] quickApply runtimeCache: Hash mismatch (${entryHash} vs canonical ${opts.store.canonicalHash}). Discarding stale cache.`);
            deleteSongCache(songKey, opts.store.runtimeCache);
          } else {
            const rp = runtimeEntry.processed;
            const rpEntry = rp[currentActiveLang]
              ?? (preferredMode === 'romanized'
                ? Object.values(rp).find((e: any) => !e.isLowQualityRomanization) ?? Object.values(rp)[0]
                : undefined);
            processed = rpEntry as typeof processed;
          }
        } else {
          const rp = runtimeEntry.processed;
          const rpEntry = rp[currentActiveLang]
            ?? (preferredMode === 'romanized'
              ? Object.values(rp).find((e: any) => !e.isLowQualityRomanization) ?? Object.values(rp)[0]
              : undefined);
          processed = rpEntry as typeof processed;
        }
      }
    }

    if (!processed) return; // No data yet — syncSetup will handle it

    const lines = preferredMode === 'romanized' ? processed.romanized : processed.translated;
    const dualEnabled = opts.store.dualLyricsEnabled;
    opts.store.mode = preferredMode;
    applyLinesToDOM(
      lines,
      dualEnabled ? opts.store.cache.original : undefined,
      dualEnabled,
      (v) => { opts.store.isApplying = v; },
      domLines,
    );
    opts.store.lyricsAppliedForKey = opts.store.songKey;
    syncButtonStates(preferredMode);
    setLoadingState(false);
    console.log('[sly-lifecycle] ⚡ quickApply: processed lyrics applied synchronously on lyrics injection.');
  }

  return { trySetup, syncSetup, pollForLyricsContainer, onSongChange, trySetupOrPoll, syncPill, quickApply };
}



/**
 * Registers listeners for the sly:takeover and sly:release events dispatched
 * by slyCore's domEngine/ui modules.
 *
 * sly:takeover — slyCore has hidden the native container and injected
 *   #lyrics-root-sync. We physically move the mode pill into the new container
 *   so it remains visible to the user.
 *
 * sly:release  — slyCore has removed #lyrics-root-sync (song change or panel
 *   close). The pill was inside it and is now gone. We disconnect the stale
 *   lyricsObserver; domObserver's onLyricsInjected() will re-inject the pill
 *   when native lyrics next appear.
 *
 * Must be called once at boot, after createLifecycleController.
 */
export function setupSlyBridge(
  store: StateStore,
  switchMode: (m: LyricsMode, forceLang?: string, suppressLoading?: boolean) => Promise<void>,
  autoSwitchIfNeeded: (forceRefresh?: boolean) => void,
  syncPill: (stateCtx?: 'NATIVE_OK' | 'PIPELINE_A' | boolean) => void,
): void {
  // Created once — opts are evaluated lazily each RAF frame so scavenged CSS
  // classes and playback state are always current, not captured at boot time.
  const renderer = createSyncedLyricsRenderer({
    getPlaybackSeconds: () => (window as any).slyGetPlaybackSeconds?.() ?? 0,
    // Use the padding-free domElements array stored by sly:takeover instead of
    // re-querying via querySelectorAll. slyBuildLyricsList adds 2 invisible padding
    // divs that share [data-testid="lyrics-line"], so querySelectorAll returns
    // N+3 elements while lrcLines only has N entries — causing a 2-line index
    // offset that makes synced lyrics appear out-of-sync when skipping mid-song.
    getOuterElements: () => store.slyActiveDomElements,
    lineBaseClass: () => window.SPOTIFY_CLASSES?.lineBase ?? '',
    activeClass: () => window.SPOTIFY_CLASSES?.activeLine ?? '',
    passedClass: () => window.SPOTIFY_CLASSES?.passedLine ?? '',
    futureClass: () => window.SPOTIFY_CLASSES?.futureLine ?? '',
    isUserScrolling: () => slyInternalState.isUserScrolling,
    setUserScrolling: (v: boolean) => { slyInternalState.isUserScrolling = v; },
    onActiveIndexChange: (index) => { slyInternalState.lastActiveIndex = index; },
  });

  function getTakeoverSourceLines(lyricsObj: any): string[] {
    if (lyricsObj.isSynced) {
      const parsed = (window as any).slyParseLRC?.(String(lyricsObj.syncedLyrics || '')) || [];
      return parsed.map((l: { text: string }) => l.text);
    }
    return String(lyricsObj.plainLyrics || '').split('\n');
  }

  function sameLines(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((line, idx) => line.trim() === b[idx].trim());
  }

  // slyCore's injection gate dispatches this when pendingLyricsData is ready and the
  // panel is open. Pipeline B is now the full orchestrator — it calls slyCore's DOM
  // creation functions as individual tools and dispatches sly:takeover itself.
  // slyInjectLyrics is no longer in the call chain after this expansion.
  document.addEventListener('sly:inject', async (e: Event) => {
    const entryUri = (window as any).spotifyState?.track?.uri as string | undefined;
    if (store.setupLock && store.lockOwnerKey === entryUri) {
      console.log('[sly-lifecycle] 🚫 Bridge sly:inject aborted: setupLock is active for this URI.');
      return;
    }
    
    store.setupLock = true;
    store.lockOwnerKey = entryUri || 'unknown';

    try {
      // Clear the logical fetching flag immediately to prevent the content.ts poll 
      // from re-injecting a "Ghost HUD" during the 1-frame await below.
      slyInternalState.isFetchingHUD = false;

      const { lyricsObj, isInstant } = (e as CustomEvent<{ lyricsObj: Record<string, unknown>, isInstant?: boolean }>).detail;

      if (lyricsObj.isSynced && lyricsObj.processed) {
        delete lyricsObj.processed;
      }
      
      // SLY FIX: "Pre-Inject Cache Hydration"
      // The background script's lc: key uses the Spotify URI, but the content script's
      // processed cache is stored under store.songKey (the aria-label). These never match,
      // so lyricsObj.processed arrives from the background as undefined.
      // We fix this here, before TakeoverEngine renders, by looking up the correct key.
      if (store.preferredMode !== 'original' && !lyricsObj.processed) {
        const songKey = store.songKey || getNowPlayingKey();
        const sourceLines = getTakeoverSourceLines(lyricsObj);
        if (songKey) {
          // Fast path: check in-memory runtime cache (zero latency)
          const runtimeEntry = store.runtimeCache.get(songKey);
          if (runtimeEntry?.processed && Object.keys(runtimeEntry.processed).length > 0 && sameLines(runtimeEntry.original, sourceLines)) {
            lyricsObj.processed = runtimeEntry.processed;
          } else {
            // Slow path: read from persistent storage using the correct key
            const storageKey = `lc:${songKey}`;
            const data = await safeBrowserCall(() => browser.storage.local.get(storageKey));
            const entry = data?.[storageKey] as { processed?: Record<string, unknown> } | undefined;
            if (entry?.processed && Object.keys(entry.processed).length > 0 && sameLines((entry as any).original, sourceLines)) {
              lyricsObj.processed = entry.processed;
            }
          }
        }
      }

      // Delegate to the specialized TakeoverEngine for the "0ms Swap"
      await TakeoverEngine.executeTakeover(lyricsObj, store, syncPill, !!isInstant);

    } finally {
      if (store.lockOwnerKey === (entryUri || 'unknown')) {
        store.setupLock = false;
        store.lockOwnerKey = null;
      }
    }
  });

  document.addEventListener('sly:takeover', (e: Event) => {
    const { container: root, plainLines, isSynced, lrcLines, domElements, trackId, processed, renderedMode } = (e as CustomEvent<{
      container: HTMLElement;
      plainLines: string[];
      isSynced: boolean;
      lrcLines: LrcLine[];
      domElements: HTMLElement[];
      trackId?: string;
      processed?: Record<string, any>;
      renderedMode?: string;
    }>).detail;

    const targetKey = trackId || store.songKey;

    if (store.songKey !== targetKey) {
      console.warn(`[sly] sly:takeover discarded: Event is for track ${targetKey} but active track is ${store.songKey}`);
      return;
    }

    // Feed slyCore's lyrics into Pipeline B's data model. This populates
    // cache.original so switchMode can process and apply them.
    
    // Invalidate processed cache if the source of truth has changed.
    // This prevents "Cache Poisoning" where a proactive Native snapshot captured 
    // padding lines before the Takeover arrived.
    const isDifferent = store.cache.original.length !== plainLines.length ||
                        !store.cache.original.every((l, i) => l === plainLines[i]);
    if (store.cache.original.length > 0 && isDifferent) {
      // FORENSIC GUARD: If existing cache is native script but takeover data is Latin, 
      // do NOT clear the cache or overwrite it.
      const cacheForensics = slyForensics.analyzeText(store.cache.original);
      const plainForensics = slyForensics.analyzeText(plainLines);
      if (cacheForensics.hasAnyNative && !plainForensics.hasAnyNative) {
        console.log('[sly] 🛡️ Forensic Guard: Takeover data is Romanized, but cache has native script. Keeping cache.');
        return; // Abort the cache update
      }

      const origSnippet = store.cache.original.slice(0, 3).join(' | ');
      const plainSnippet = plainLines.slice(0, 3).join(' | ');
      console.log(`[sly-lifecycle] 🔄 Cache Invalidation: Takeover data differs from Native snapshot. Clearing processed map.\nOld: "${origSnippet}"\nNew: "${plainSnippet}"`);
      store.cache.processed.clear();
      deleteSongCache(targetKey, store.runtimeCache);
      store.globalProcessGenRef.value++; // Cancel any active/in-flight background processing
    }

    store.cache.original = plainLines;

    // SLY FIX: Instant Cache & Mode Hydration — placed AFTER cache invalidation.
    // By hydrating here, we guarantee the payload's processed data survives the
    // .clear() above. This prevents the redundant background PROCESS call that
    // caused the "shimmer" on fully-cached songs.
    // STALE DATA GUARD: If processed.romanized.length ≠ plainLines.length, the
    // cache was computed for a different lyrics version (e.g., unsynced plainLyrics
    // romanized but now displaying synced LRC with a different line count). Discard it.
    if (processed) {
      const firstEntry = Object.values(processed)[0] as any;
      const processedLineCount = firstEntry?.romanized?.length ?? firstEntry?.translated?.length ?? 0;
      const isStale = processedLineCount > 0 && processedLineCount !== plainLines.length;

      if (isStale) {
        console.warn(`[sly] sly:takeover: Discarding stale processed cache (${processedLineCount} lines vs ${plainLines.length} LRC lines). Will recompute.`);
      } else {
        for (const [lang, data] of Object.entries(processed)) {
          store.cache.processed.set(lang, data);
        }
        if (renderedMode && renderedMode !== 'original') {
          store.mode = renderedMode as any;
          syncButtonStates(store.mode);
        }
      }
    }

    store.slyActiveContainer = root;
    // Store padding-free elements so getOuterElements() returns the same set
    // that lrcLines was built from — index 0 is the first lyric, not a padding div.
    store.slyActiveDomElements = domElements ?? [];

    // Disconnect the lyricsObserver — it was aimed at the now-hidden native
    // container and cannot usefully fire while slyCore owns the lyrics DOM.
    lyricsObserver?.disconnect();
    lyricsObserver = null;

    // SLY FIX: Relocate pill SYNCHRONOUSLY before the async cache load to eliminate
    // the "glitch" where the pill is rescued to body and hidden during track switch.
    store.godState = 'PIPELINE_A';
    syncPill('PIPELINE_A');


    // Load any previously cached translations before re-applying mode.
      const capturedCache = store.cache;
      const takeoverKey = store.songKey;
      loadSongCache(takeoverKey, capturedCache, store.runtimeCache).then(() => {
        // Race Condition Guard: If the track changed while we were waiting for the cache, abort.
        if (store.songKey !== takeoverKey) {
          console.warn('[sly] sly:takeover aborted: Track changed during cache wait.');
          return;
        }

        // State-driven pill injection: pill belongs in the Pipeline A container.
        // syncPill() resolves the target deterministically from #lyrics-root-sync.
        syncPill('PIPELINE_A');

        // SLY FIX: Skip force-refresh if TakeoverEngine already rendered the correct mode.
        // autoSwitchIfNeeded(true) always calls switchMode which re-applies DOM via applyLinesToDOM,
        // causing a visible shimmer even when the content is identical. If renderedMode already
        // matches the preferredMode and cache is populated, the DOM is correct — no re-apply needed.
        // EXCEPTION: Dual lyrics requires applyLinesToDOM to set data-sly-original on each line.
        // TakeoverEngine/slyBuildLyricsList only renders one mode, so we must NOT skip when dual is on.
        const modeAlreadyApplied = renderedMode === store.preferredMode && 
                                   capturedCache.processed.size > 0 &&
                                   !store.dualLyricsEnabled;
        if (!modeAlreadyApplied) {
          autoSwitchIfNeeded(true, capturedCache);
        }

      // Start Pipeline B's RAF sync loop for synced tracks. Sets the
      // slySyncedRendererActive flag so slyCore's own loop yields immediately.
      if (isSynced && lrcLines.length > 0) {
        slyInternalState.slySyncedRendererActive = true;
        // SLY FIX: Force an initial sync update on re-injection by passing -1.
        // This ensures the renderer instantly highlights the active line and 
        // scrolls into view behavior: 'instant', rather than waiting for 
        // the next time transition.
        renderer.start(lrcLines, -1);
      }
      auditOriginalLyrics(store);
      
      // Point of No Return: Successfully taken over. Clear all HUD flags and DOM.
      StatusEngine.clear();
      if (!store.isSwitchingMode) {
        setLoadingState(false);
      }
    });
  });

  document.addEventListener('sly:release', () => {
    store.godState = 'RELEASING'; // Pill is being rescued to document.body; awaiting next state event.
    store.mode = 'original'; // SLY FIX: Reset the painted mode back to original to keep the UI state coherent
    const s = performance.now();
    // #lyrics-root-sync (and the pill inside it) has been removed from the DOM.
    // Stop Pipeline B's sync loop, clear the flag so slyCore's loop can run
    // again if needed, then clean up the observer reference.
    slyInternalState.slySyncedRendererActive = false;
    renderer.stop();
    // setupLock is NOT reset here (BUG-A2/B2 fix). 
    // It is released by the holder's finally block to prevent concurrent inject races.

    // Park the pill on document.body in a visible loading state so it never
    // disappears during the song transition. parkPill() is idempotent and
    // respects store.showPill — it will NOT set display:none.
    parkPill(store.preferredMode, store.showPill);
    console.log('[sly-lifecycle] ---- Bridge: Mode Pill parked on document.body (visible, loading).');

    // Only disconnect lyricsObserver if a Pipeline A takeover was actually active.
    // sly:release fires even for native-only tracks when TRACK SWITCH's nuclear cleanup
    // removes a lingering #lyrics-root-sync. Unconditionally disconnecting here leaves
    // a window where React re-renders original lyrics with no observer to catch it.
    const wasInTakeover = !!store.slyActiveContainer;
    store.slyActiveContainer = null;
    store.slyActiveDomElements = [];  // prevent stale elements from a prior song
    if (wasInTakeover) {
      lyricsObserver?.disconnect();
      lyricsObserver = null;
    } else if (store.preferredMode !== 'original') {
      // NATIVE-TRACK DOM-SWAP FIX:
      // The lyricsObserver was created in onSongChange targeting the OLD song's
      // getLyricsViewRoot() node. React then swaps the entire lyrics root element
      // for the new song — leaving the observer watching a detached, dead node that
      // will never fire again. Re-target it to the current live root right now, so
      // the moment Pavazha Malli's (or any new song's) lines are injected by React,
      // the observer catches the mutation and applies processed lyrics synchronously.
      lyricsObserver?.disconnect();
      lyricsObserver = createLyricsObserver({
        getIsApplying: () => store.isApplying,
        getMode: () => store.mode,
        getCache: () => store.cache,
        getCurrentActiveLang: () => store.currentActiveLang,
        getDualLyricsEnabled: () => store.dualLyricsEnabled,
        setApplying: (v) => { store.isApplying = v; },
        onInvalidate: () => { lyricsObserver = null; },
      });
      console.log(`[sly-lifecycle] 🔭 sly:release OBSERVER RE-TARGET (native track): ${lyricsObserver ? 'retargeted to live root ✅' : 'null (no live root yet) ⚠️'}`);
    }

    // Unblock trySetup() immediately by removing the active flag from main.
    // Prevents the "sly-active found, aborting" guard from skipping Song B's setup.
    const main = document.querySelector(`main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`) as HTMLElement | null;
    if (main) main.classList.remove('sly-active');

    const e = performance.now();
    console.log(`[sly-lifecycle] -- Step 2.1: Bridge Release Logic (${(e - s).toFixed(2)}ms)`);
  });

  // sly:state — typed state transitions emitted by slyCore's decision engine.
  //
  // NATIVE_OK: native lyrics are working → sync pill into native container.
  //            Fires on every standing-down poll tick (idempotent by design),
  //            providing up to 5s recovery if React removes the pill without
  //            removing lyrics-line nodes (onControlsRemoved handles immediate recovery
  //            in parallel until confirmed safe to remove in production).
  //
  // FETCHING | FAILED | AD: a HUD is active → hide the pill immediately.
  //
  // PIPELINE_A and RELEASING are handled by their own events (sly:takeover, sly:release).
  document.addEventListener('sly:state', (e: Event) => {
    const { state } = (e as CustomEvent<{ state: string }>).detail;
    if (state === 'NATIVE_OK') {
      store.godState = 'NATIVE_OK';
      syncPill('NATIVE_OK');

      // R2-Bug4 Fix: After panel close → reopen (same song), sly:release resets
      // store.mode to 'original'. syncSetup/pollForLyricsContainer only run on
      // song changes, so nobody triggers the switch back to the user's preferredMode.
      // The pill shows the fakeout (Romanized highlighted) but lyrics stay Original.
      // Fix: if the mode is stale, call autoSwitchIfNeeded() to apply processed
      // lyrics from the hot cache. This is safe to call on every NATIVE_OK tick
      // because autoSwitchIfNeeded has its own isSwitchingMode and mode guards —
      // once mode matches preferredMode, it becomes a no-op.
      if (store.mode !== store.preferredMode && store.preferredMode !== 'original') {
        autoSwitchIfNeeded();
      }
    } else if (state === 'FETCHING' || state === 'FAILED' || state === 'AD') {
      store.godState = state as any;
      // SLY FIX: Only hide the pill for terminal HUD states (FAILED, AD).
      // FETCHING is transient — before modularization, statusHud.ts never dispatched
      // sly:state at all, so the pill was never hidden during fetching. The pill
      // sits in document.body rescue mode until sly:takeover relocates it to
      // #lyrics-root-sync. Explicitly hiding it during FETCHING causes it to not
      // reappear when sly:takeover fires and calls syncPill('PIPELINE_A').
      if (state !== 'FETCHING') {
        syncPill(false); // HUD is active — hide the pill
      }
    }
  });
}

