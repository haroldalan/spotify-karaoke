import { safeBrowserCall } from '../utils/browserUtils';
import { getNowPlayingKey, getLyricsContainer } from '../dom/domQueries';
import { snapshotOriginals, applyLinesToDOM } from '../dom/lyricsDOM';
import { applyNativeOverride } from './nativeLyricsHandler';
import { loadSongCache, saveSongCache } from './lyricsCache';
import { injectControls, syncButtonStates, CONTROLS_ID } from '../dom/lyricsControls';
import { createLyricsObserver } from '../dom/lyricsObserver';
import { createSyncedLyricsRenderer, type LrcLine } from './syncedLyricsRenderer';
import type { LyricsMode, SongCache, LyricsCacheEntry } from './lyricsTypes';
import { StateStore } from './store';
import { slyInternalState } from '../slyCore/state';

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
    const container = getLyricsContainer();
    if (!container) return; // Unlikely due to polling, but safe

    // Abort if slyCore is actively displaying custom lyrics. It handles its own pill injection.
    if (document.querySelector('main.' + ((window as any).SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS') + '.sly-active')) {
      return;
    }
    
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

    // Notify slyCore that native lyrics are in the DOM. Triggers its injection
    // gate immediately for the common case (fetch completed before panel opened),
    // eliminating up to 500ms of poll latency. Poll remains fallback for slow fetches.
    document.dispatchEvent(new CustomEvent('sly:lyrics_injected'));
  }

  function pollForLyricsContainer(attempts = 0): void {
    if (attempts > 120) {
      if (attempts === 121) {
        console.log('[SKaraoke:Content] Lyrics panel still hidden, switching to infinite slow poll fallback...');
      }
      opts.store.pollId = window.setTimeout(() => pollForLyricsContainer(attempts + 1), 2000) as unknown as number;
      return;
    }
    if (getLyricsContainer()) {
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
    opts.store.isSwitchingMode = false;
    opts.store.romanizedGenRef.value++;
    opts.store.translatedGenRef.value++;
    opts.store.switchGenRef.value++;
    opts.store.lyricsObserver?.disconnect();
    opts.store.lyricsObserver = null;
    opts.store.cache = { original: [], processed: new Map() };
    opts.store.pendingNativeLines.clear();

    // Clear stale container references immediately so autoSwitchIfNeeded
    // doesn't write into detached DOM nodes before the slyCore poll fires.
    opts.store.slyActiveContainer = null;
    opts.store.slyActiveDomElements = [];

    // Remove any body-orphaned pill from a prior sly:release
    const orphan = document.getElementById(CONTROLS_ID);
    if (orphan && orphan.parentElement === document.body) {
      orphan.remove();
    }

    safeBrowserCall(() => browser.storage.local.get(`lc:${newKey}`)).then((data) => {
      const entry = data?.[`lc:${newKey}`] as LyricsCacheEntry | undefined;
      if (entry) opts.store.runtimeCache.set(newKey, entry);
    }).catch(() => {});

    const controls = document.getElementById(CONTROLS_ID);
    if (controls) controls.classList.add('sly-loading');

    const currentPollId = opts.store.pollId;
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

  return { trySetup, syncSetup, pollForLyricsContainer, onSongChange, trySetupOrPoll };
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
  autoSwitchIfNeeded: () => void,
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
    lineBaseClass:   () => (window as any).SPOTIFY_CLASSES?.lineBase   ?? '',
    activeClass:     () => (window as any).SPOTIFY_CLASSES?.activeLine ?? '',
    passedClass:     () => (window as any).SPOTIFY_CLASSES?.passedLine ?? '',
    futureClass:     () => (window as any).SPOTIFY_CLASSES?.futureLine ?? '',
    isUserScrolling: () => slyInternalState.isUserScrolling,
    onActiveIndexChange: (index) => { slyInternalState.lastActiveIndex = index; },
  });

  // slyCore's injection gate dispatches this when pendingLyricsData is ready and the
  // panel is open. Pipeline B is now the full orchestrator — it calls slyCore's DOM
  // creation functions as individual tools and dispatches sly:takeover itself.
  // slyInjectLyrics is no longer in the call chain after this expansion.
  document.addEventListener('sly:inject', (e: Event) => {
    const { lyricsObj } = (e as CustomEvent<{ lyricsObj: Record<string, unknown> }>).detail;
    if (!lyricsObj || lyricsObj.failed) return;

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
    const plainLines = plainLinesRaw.filter(text => !(!text.trim() && lyricsObj.isSynced));

    const lrcLines: LrcLine[] = lyricsObj.isSynced 
      ? (lyricsObj.lines as LrcLine[]).filter(l => l.text.trim()) 
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
    store.cache.original = plainLines;
    // Clear processed cache to prevent zipping old Native translations onto the Custom DOM
    store.cache.processed.clear();
    store.slyActiveContainer = root;
    // Store padding-free elements so getOuterElements() returns the same set
    // that lrcLines was built from — index 0 is the first lyric, not a padding div.
    store.slyActiveDomElements = domElements ?? [];

    // Move the existing pill into slyCore's lyrics content div so it sits at
    // the same structural level as in native mode. #lyrics-root-sync is the
    // outer container — the pill must go inside the inner div that directly
    // wraps the [data-testid="lyrics-line"] elements (mirrors getLyricsContainer()).
    // slyBuildLyricsList has already run at this point, so the lines are in the DOM.
    const firstLine = root.querySelector('[data-testid="lyrics-line"]');
    const pillTarget = (firstLine?.parentElement ?? root) as HTMLElement;

    const existingPill = document.getElementById(CONTROLS_ID);
    if (existingPill) {
      pillTarget.insertBefore(existingPill, pillTarget.firstChild);
      existingPill.classList.remove('sly-loading');
      existingPill.style.display = store.showPill ? '' : 'none';
    } else {
      injectControls(pillTarget, store.showPill, store.mode, store.preferredMode, switchMode);
    }

    // Disconnect the lyricsObserver — it was aimed at the now-hidden native
    // container and cannot usefully fire while slyCore owns the lyrics DOM.
    store.lyricsObserver?.disconnect();
    store.lyricsObserver = null;

    // Load any previously cached translations before re-applying mode.
    // cache.original is already set above so loadSongCache's coherence check
    // (entry.original.length === cache.original.length) passes correctly.
    // This makes repeat plays instant — no background round-trip needed.
    loadSongCache(store.songKey, store.cache, store.runtimeCache).then(() => {
      // Start Pipeline B's RAF sync loop for synced tracks. Sets the
      // slySyncedRendererActive flag so slyCore's own loop yields immediately.
      if (isSynced && lrcLines.length > 0) {
        slyInternalState.slySyncedRendererActive = true;
        renderer.start(lrcLines);
      }
      autoSwitchIfNeeded(true);
    });
  });

  document.addEventListener('sly:release', () => {
    // #lyrics-root-sync (and the pill inside it) has been removed from the DOM.
    // Stop Pipeline B's sync loop, clear the flag so slyCore's loop can run
    // again if needed, then clean up the observer reference.
    slyInternalState.slySyncedRendererActive = false;
    renderer.stop();

    // Rescue the pill before #lyrics-root-sync is torn down so it doesn't flash.
    // Parking it on document.body ensures it survives the transition.
    const pill = document.getElementById(CONTROLS_ID);
    if (pill) {
      pill.classList.add('sly-loading');
      document.body.appendChild(pill);
    }

    store.slyActiveContainer = null;
    store.slyActiveDomElements = [];  // prevent stale elements from a prior song
    store.lyricsObserver?.disconnect();
    store.lyricsObserver = null;

    // Unblock trySetup() immediately by removing the active flag from main.
    // Prevents the "sly-active found, aborting" guard from skipping Song B's setup.
    const main = document.querySelector(`main.${(window as any).SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}`) as HTMLElement | null;
    if (main) main.classList.remove('sly-active');
  });
}
