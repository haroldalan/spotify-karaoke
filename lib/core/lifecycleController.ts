import { safeBrowserCall } from '../utils/browserUtils';
import { getNowPlayingKey, getLyricsContainer, getLyricsViewRoot, getLyricsLines } from '../dom/domQueries';
import { snapshotOriginals, applyLinesToDOM } from '../dom/lyricsDOM';
import { applyNativeOverride } from './nativeLyricsHandler';
import { loadSongCache, saveSongCache } from './lyricsCache';
import { injectControls, syncButtonStates, setLoadingState, CONTROLS_ID } from '../dom/lyricsControls';
import { createLyricsObserver } from '../dom/lyricsObserver';
import { createSyncedLyricsRenderer, type LrcLine } from './syncedLyricsRenderer';
import type { LyricsMode, SongCache, LyricsCacheEntry } from './lyricsTypes';
import { StateStore } from './store';
import { slyInternalState, spotifyState } from '../slyCore/state';

let setupLock = false;

/**
 * lifecycleController's owned extension state.
 * Updated at every state transition so internal yield checks (trySetup, syncSetup)
 * can use it instead of reading slyInternalState.isFetchingHUD / isAdHUDActive.
 * Note: godState reflects what lifecycleController KNOWS — slyInternalState remains
 * the source of truth for fields like pendingLyricsData that aren't yet bridged.
 */
let godState: 'IDLE' | 'LOADING' | 'NATIVE_OK' | 'RELEASING' | 'PIPELINE_A' | 'FETCHING' | 'FAILED' | 'AD' = 'IDLE';

/**
 * lyricsObserver is module-level so both createLifecycleController and setupSlyBridge
 * can manage it without threading it through StateStore. Moved from StateStore in Step 5.
 */
let lyricsObserver: MutationObserver | null = null;

const getTrackUri = () => (spotifyState?.track as { uri?: string } | null)?.uri;

export interface LifecycleControllerOpts {
  store: StateStore;
  switchMode: (m: LyricsMode, forceLang?: string, suppressLoading?: boolean) => Promise<void>;
  reapplyMode: () => Promise<void>;
  autoSwitchIfNeeded: () => void;
}

export function createLifecycleController(opts: LifecycleControllerOpts) {
  // Internal implementation state moved from StateStore (Step 5).
  // Only used within this function's closure — not shared with setupSlyBridge.
  let cacheReadyPromise: Promise<void> | null = null;
  let pollId: number | null = null;

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

    if (stateCtx === 'PIPELINE_A') {
      // Deterministic: pill belongs in the Pipeline A scroll container.
      injectionTarget = (customRoot?.querySelector(`.${listCls}`) ?? customRoot) as HTMLElement | null;
      shouldShow = opts.store.showPill;
    } else if (stateCtx === 'NATIVE_OK') {
      // Deterministic: pill belongs in the native lyrics container.
      injectionTarget = getLyricsContainer() as HTMLElement | null;
      shouldShow = opts.store.showPill;
    } else {
      // Heuristic path — used when state is not yet explicitly known.
      // Priority: Pipeline A inner list > native container > native shell.
      const root = getLyricsViewRoot();
      const container = getLyricsContainer();
      const customInner = customRoot?.querySelector(`.${listCls}`);
      injectionTarget = (customInner ?? container) as HTMLElement | null;
      const detection = window.slyDetectNativeState?.() ?? {};
      const hasContent = detection.hasNativeLines || opts.store.slyActiveContainer?.isConnected;
      shouldShow = typeof stateCtx === 'boolean' ? stateCtx : (opts.store.showPill && !!hasContent);
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

  async function trySetup(): Promise<void> {
    if (setupLock) return;
    setupLock = true;
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

    // Yield to Pipeline B if it's already working. This prevents the Native Pipeline
    // from proactively snapshotting (and potentially poisoning) the Romanization cache
    // if a Takeover is imminent.
    // Yield to Pipeline B if a HUD is active (godState) or lyrics data is pending (slyInternalState).
    if (godState === 'FETCHING' || godState === 'FAILED' || godState === 'AD' || slyInternalState.pendingLyricsData) {
      console.log('[sly-lifecycle] ⏳ Yielding trySetup: HUD active or pending lyrics.');
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

    const cache = opts.store.cache;
    if (cache.original.length === 0) snapshotOriginals(cache);

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
      await opts.reapplyMode();
      opts.autoSwitchIfNeeded();
      const e = performance.now();
      console.log(`[sly-lifecycle] ✅ Bridge trySetup complete. Pill injected/updated (${(e - s).toFixed(2)}ms).`);
    } finally {
      setupLock = false;
    }
  }

  async function syncSetup(): Promise<void> {
    if (setupLock) return;
    setupLock = true;
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
      if (godState === 'FETCHING' || godState === 'FAILED' || godState === 'AD' || slyInternalState.pendingLyricsData) {
        console.log('[sly-lifecycle] ⏳ Yielding syncSetup: HUD active or pending lyrics.');
        return;
      }

      // Abort if slyCore is actively displaying custom lyrics. It handles its own pill injection.
      // This prevents the Native pipeline from "stealing" the pill back from the Takeover container.
      const mainCls = window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS';
      if (opts.store.slyActiveContainer || document.querySelector(`main.${mainCls}.sly-active`) || document.getElementById('lyrics-root-sync')) {
        console.log('[sly-lifecycle] 🚫 Bridge syncSetup aborted: slyCore is active.');
        return;
      }

      const currentUri = getTrackUri();
      const cache = opts.store.cache;

      // Synchronously pre-warm from in-memory runtime cache to eliminate the async yield frame-flash (port of v3.0.6).
      const runtimeEntry = opts.store.runtimeCache.get(opts.store.songKey);
      if (runtimeEntry) {
        if (cache.original.length === 0) cache.original = [...runtimeEntry.original];
        for (const [lang, res] of Object.entries(runtimeEntry.processed)) {
          if (!cache.processed.has(lang)) cache.processed.set(lang, res);
        }
      }

      const syncPreferredMode = opts.store.preferredMode;
      if (syncPreferredMode !== 'original') {
        const currentActiveLang = opts.store.currentActiveLang;
        let processed = cache.processed.get(currentActiveLang);
        if (!processed && syncPreferredMode === 'romanized' && cache.processed.size > 0) {
          const entries = Array.from(cache.processed.values());
          processed = entries.find(e => !e.isLowQualityRomanization) ?? entries[0];
        }

        if (processed) {
          if (cache.original.length === 0) snapshotOriginals(cache);
          applyNativeOverride({ cache, pendingNativeLines: opts.store.pendingNativeLines });

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
          applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; });
          syncButtonStates(syncPreferredMode);
          setLoadingState(false);
          syncPill('NATIVE_OK');

          const currentPollId = pollId;
          if (currentPollId) { cancelAnimationFrame(currentPollId); pollId = null; }
          
          document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
          return; // Instant, fully synchronous return! ZERO frames flashed!
        }
      }

      // Safety fallback: Wait for storage.local read to finish if cache wasn't in memory
      if (cacheReadyPromise) {
        await cacheReadyPromise;
      }

      // Race Condition Guard: If the track changed while we were waiting for the cache, abort.
      if (getTrackUri() !== currentUri) {
        console.warn('[sly] syncSetup aborted: Track URI changed during cache wait.');
        return;
      }

      if (cache.original.length === 0) snapshotOriginals(cache);
      applyNativeOverride({ cache, pendingNativeLines: opts.store.pendingNativeLines });

      // Ensure the cache is warm (check runtime then storage) before proceeding.
      // loadSongCache also performs a hash coherence check against the newly snapshotted originals.
      await loadSongCache(opts.store.songKey, cache, opts.store.runtimeCache);

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
        const currentPollId = pollId;
        if (currentPollId) { cancelAnimationFrame(currentPollId); pollId = null; }
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
          setLoadingState(false);
          const currentPollId = pollId;
          if (currentPollId) { cancelAnimationFrame(currentPollId); pollId = null; }
          return;
        }
      }

      if (opts.store.songKey === getNowPlayingKey() && document.getElementById(CONTROLS_ID)?.parentElement === getLyricsContainer()) {
        return;
      }

      const currentPollId = pollId;
      if (currentPollId) { cancelAnimationFrame(currentPollId); pollId = null; }
      opts.autoSwitchIfNeeded();

      const s = performance.now();
      // Notify slyCore that native lyrics are in the DOM. Triggers its injection
      // gate immediately for the common case (fetch completed before panel opened),
      // eliminating up to 500ms of poll latency. Poll remains fallback for slow fetches.
      document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
      const e = performance.now();
      console.log(`[sly-lifecycle] ✅ Bridge syncSetup complete. Native lyrics identified (${(e - s).toFixed(2)}ms).`);
    } finally {
      setupLock = false;
    }
  }


  let discoveryTime = 0;

  function pollForLyricsContainer(attempts = 0): void {
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
      console.log(`[sly-lifecycle] 🔍 Lyrics view root detected after ${(foundTime - discoveryTime).toFixed(2)}ms. Waiting for lines...`);
      trySetup(); // Call once to inject the pill into the shell
      // View root found but lines missing — poll again with a slight delay
      pollId = window.setTimeout(() => pollForLyricsContainer(attempts + 1), 300) as unknown as number;
    } else {
      pollId = requestAnimationFrame(() => pollForLyricsContainer(attempts + 1));
    }
  }


  function onSongChange(newKey: string): void {
    const songKey = opts.store.songKey;
    if (newKey === songKey) return;

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

    godState = 'LOADING'; // Track is changing — no stable pill target until next state event.
    opts.store.songKey = newKey;
    opts.store.mode = 'original';
    opts.store.isSwitchingMode = false;
    opts.store.romanizedGenRef.value++;
    opts.store.translatedGenRef.value++;
    opts.store.switchGenRef.value++;
    opts.store.mode = 'original';
    lyricsObserver?.disconnect();
    lyricsObserver = null;
    opts.store.cache = { original: [], processed: new Map() };
    opts.store.pendingNativeLines.clear();
    setupLock = false;

    // Proactively load processed cache for this song so it's ready for trySetup/syncSetup.
    // We don't await here as we want to start the poll immediately, but the promise
    // ensures coherence for any subsequent snapshotOriginals calls.
    cacheReadyPromise = loadSongCache(newKey, opts.store.cache, opts.store.runtimeCache);

    // Clear stale container references immediately so autoSwitchIfNeeded
    // doesn't write into detached DOM nodes before the slyCore poll fires.
    opts.store.slyActiveContainer = null;
    opts.store.slyActiveDomElements = [];

    // Remove any body-orphaned pill from a prior sly:release
    const orphan = document.getElementById(CONTROLS_ID);
    if (orphan && orphan.parentElement === document.body) {
      orphan.remove();
    }

    if (opts.store.preferredMode !== 'original') {
      setLoadingState(true);
    }

    const controls = document.getElementById(CONTROLS_ID);
    if (controls) {
      controls.classList.add('sly-loading');
      // No longer hiding the pill here to prevent the "pop-in" effect.
      // We rely on React's DOM diffing to leave our pill alone (like in v3.0.6).
    }

    const currentPollId = pollId;
    if (currentPollId) cancelAnimationFrame(currentPollId);

    pollForLyricsContainer();

    // Notify slyCore of the track change reactively so it no longer needs to
    // detect this in its 500ms poll. URI is sourced from window.spotifyState
    // which slyCore's scanner already populates — no new coupling.
    const uri = (window as any).spotifyState?.track?.uri as string | undefined;
    document.dispatchEvent(new CustomEvent('sly:song_change', { detail: { uri } }));
  }

  function trySetupOrPoll(): void {
    if (getLyricsContainer()) {
      trySetup();
    } else {
      pollForLyricsContainer();
    }
  }

  return { trySetup, syncSetup, pollForLyricsContainer, onSongChange, trySetupOrPoll, syncPill };
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
    onActiveIndexChange: (index) => { slyInternalState.lastActiveIndex = index; },
  });

  // slyCore's injection gate dispatches this when pendingLyricsData is ready and the
  // panel is open. Pipeline B is now the full orchestrator — it calls slyCore's DOM
  // creation functions as individual tools and dispatches sly:takeover itself.
  // slyInjectLyrics is no longer in the call chain after this expansion.
  document.addEventListener('sly:inject', async (e: Event) => {
    if (setupLock) {
      console.log('[sly-lifecycle] 🚫 Bridge sly:inject aborted: setupLock is active.');
      return;
    }
    setupLock = true;
    try {
      const { lyricsObj } = (e as CustomEvent<{ lyricsObj: Record<string, unknown> }>).detail;
      if (!lyricsObj || lyricsObj.failed) return;

      // Wait for a frame to ensure React has finished any immediate DOM shuffling
      // from the track transition before we start our own injection.
      await new Promise(r => requestAnimationFrame(r));

      const sly = window as any;

      // 1. Prepare the #lyrics-root-sync container (create or clear existing).
      const root: HTMLElement | null = sly.slyPrepareContainer?.();
      if (!root) return;


    // 2. Inject core CSS once (sync button styles, custom transitions).
    sly.slyInjectCoreStyles?.();

    // 3. Copy Spotify's CSS custom properties; hide the native lyrics container.
    const nativeRef = document.querySelector(
      `main.${sly.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'} .${sly.SPOTIFY_CLASSES?.container}:not(#lyrics-root-sync)`
    ) as HTMLElement | null;
    sly.slyMirrorNativeTheme?.(root, lyricsObj, nativeRef);

    // 4. Build the lyrics DOM lines.
    //    Also populates lyricsObj.lines and lyricsObj.domElements — required below.
    sly.slyBuildLyricsList?.(root, lyricsObj);

    // 5. Pipeline B dispatches sly:takeover — slyInjectLyrics no longer does this.
    //    lyricsObj.lines is now populated by slyBuildLyricsList, so lrcLines is correct.
    const plainLinesRaw = lyricsObj.isSynced
      ? (lyricsObj.lines as LrcLine[]).map(l => l.text)
      : ((lyricsObj.plainLyrics as string) || '').split('\n');

    // Filter to match domEngine's exact logic so arrays align perfectly
    const plainLines = plainLinesRaw;

    const lrcLines: LrcLine[] = lyricsObj.isSynced
      ? (lyricsObj.lines as LrcLine[])
      : [];
    // Pass domElements (padding-free) so sly:takeover can give them directly to
    // the renderer — avoids the querySelectorAll index-offset bug.
    const domElements = (lyricsObj.domElements as HTMLElement[]) ?? [];
    document.dispatchEvent(new CustomEvent('sly:takeover', {
      detail: { container: root, plainLines, isSynced: !!lyricsObj.isSynced, lrcLines, domElements },
    }));

      // 6. Setup the floating Sync button.
      // slyCore's sly:inject listener records currentLyrics — no write needed here.
      sly.slySetupSyncButton?.(lyricsObj);
      // slyUpdateSync is intentionally omitted — Pipeline B's syncedLyricsRenderer owns sync.
    } finally {
      setupLock = false;
    }
  });

  document.addEventListener('sly:takeover', (e: Event) => {
    const { container: root, plainLines, isSynced, lrcLines, domElements } = (e as CustomEvent<{
      container: HTMLElement;
      plainLines: string[];
      isSynced: boolean;
      lrcLines: LrcLine[];
      domElements: HTMLElement[];
    }>).detail;

    // Feed slyCore's lyrics into Pipeline B's data model. This populates
    // cache.original so switchMode can process and apply them.
    
    // Invalidate processed cache if the source of truth has changed.
    // This prevents "Cache Poisoning" where a proactive Native snapshot captured 
    // padding lines before the Takeover arrived.
    if (store.cache.original.length !== plainLines.length) {
      store.cache.processed.clear();
      console.log('[sly-lifecycle] 🔄 Cache Invalidation: Takeover data length differs from Native snapshot. Clearing processed map.');
    }

    store.cache.original = plainLines;
    store.slyActiveContainer = root;
    // Store padding-free elements so getOuterElements() returns the same set
    // that lrcLines was built from — index 0 is the first lyric, not a padding div.
    store.slyActiveDomElements = domElements ?? [];

    // Disconnect the lyricsObserver — it was aimed at the now-hidden native
    // container and cannot usefully fire while slyCore owns the lyrics DOM.
    lyricsObserver?.disconnect();
    lyricsObserver = null;

    // Load any previously cached translations before re-applying mode.
    loadSongCache(store.songKey, store.cache, store.runtimeCache).then(() => {
      // State-driven pill injection: pill belongs in the Pipeline A container.
      // syncPill() resolves the target deterministically from #lyrics-root-sync.
      syncPill('PIPELINE_A');
      godState = 'PIPELINE_A'; // lifecycleController now knows it owns the Pipeline A DOM.

      // Start Pipeline B's RAF sync loop for synced tracks. Sets the
      // slySyncedRendererActive flag so slyCore's own loop yields immediately.
      if (isSynced && lrcLines.length > 0) {
        slyInternalState.slySyncedRendererActive = true;
        renderer.start(lrcLines, slyInternalState.lastActiveIndex);
      }
      autoSwitchIfNeeded(true);
    });
  });

  document.addEventListener('sly:release', () => {
    godState = 'RELEASING'; // Pill is being rescued to document.body; awaiting next state event.
    const s = performance.now();
    // #lyrics-root-sync (and the pill inside it) has been removed from the DOM.
    // Stop Pipeline B's sync loop, clear the flag so slyCore's loop can run
    // again if needed, then clean up the observer reference.
    slyInternalState.slySyncedRendererActive = false;
    renderer.stop();
    setupLock = false;

    // Rescue the pill before #lyrics-root-sync is torn down so it doesn't flash.
    // Parking it on document.body ensures it survives the transition.
    const pill = document.getElementById(CONTROLS_ID);
    if (pill) {
      pill.classList.add('sly-loading');
      pill.style.display = 'none'; // Hide during rescue
      document.body.appendChild(pill);
      console.log('[sly-lifecycle] ---- Bridge: Mode Pill rescued to document.body and hidden.');
    }

    store.slyActiveContainer = null;
    store.slyActiveDomElements = [];  // prevent stale elements from a prior song
    lyricsObserver?.disconnect();
    lyricsObserver = null;

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
      godState = 'NATIVE_OK';
      syncPill('NATIVE_OK');
    } else if (state === 'FETCHING' || state === 'FAILED' || state === 'AD') {
      godState = state as typeof godState;
      syncPill(false); // HUD is active — hide the pill
    }
  });
}

