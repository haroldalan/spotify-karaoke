import { traceEvent } from '../testHooks';
import { safeBrowserCall, getTargetLang } from '../utils/browserUtils';
import { snapshotOriginals, applyLinesToDOM, purgeSlyDOM, cacheFitsNativeRows, noteCacheSkip, reconcileTakeoverCache } from '../dom/lyricsDOM';
import { getLyricsLines } from '../dom/domQueries';
import { syncButtonStates, setLoadingState } from '../dom/lyricsControls';
import { fetchProcessed, type FetchProcessedReport } from './fetchProcessed';
import { getStoredEntryDefect, resolveProcessed } from './processedCache';
import { isLatinScript } from '../lyrics/scriptDetector';
import { isLikelyRomanizedFallback } from '../lyrics/romanizedDetector';
import { showToast, hideToast } from '../dom/toast';
import type { LyricsMode, SongCache, ProcessedCache, LyricsCacheEntry } from './lyricsTypes';
import { StateStore } from './store';
import { hashString } from '../utils/hashUtils';

export interface ModeControllerOpts {
  store: StateStore;
}

/**
 * After a failed automatic switch (background returned nothing usable), do not
 * let the periodic auto-switch triggers (sly:state NATIVE_OK ticks, syncSetup)
 * re-request the same lyrics for this long. User-initiated switches and the
 * one-shot forced re-evaluations are not affected.
 */
const AUTO_SWITCH_FAILURE_BACKOFF_MS = 60_000;

export function createModeController(opts: ModeControllerOpts) {
  let lastAutoSwitchFailure: { key: string; at: number } | null = null;
  const failureKey = (mode: LyricsMode, lang: string, cache: SongCache): string =>
    `${opts.store.songKey}|${mode}|${lang}|${hashString(cache.original.join('|'))}`;

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

  const discardStaleProcessedCache = (cache: SongCache): void => {
    if (cache.original.length === 0) return;
    const expectedSourceHash = hashString(cache.original.join('|'));
    for (const [lang, entry] of cache.processed) {
      if (entry.sourceHash !== expectedSourceHash) {
        console.warn(`[sly-mode] 🧹 Rejecting processed cache for ${lang}: source lyrics hash is missing or mismatched.`);
        cache.processed.delete(lang);
        continue;
      }
      const defect = getStoredEntryDefect(cache.original, lang, entry);
      if (defect) {
        console.warn(`[sly-mode] 🧹 Rejecting processed cache for ${lang}: ${defect}.`);
        cache.processed.delete(lang);
      }
    }
  };

  const logEntireLyrics = (next: LyricsMode, cache: SongCache, lang: string): void => {
    console.groupCollapsed(`%c[sly-debug] 📋 ENTIRE LYRICS FOR MODE "${next.toUpperCase()}" (${cache.original.length} lines)`, 'color: #1DB954; font-weight: bold; font-size: 12px;');
    console.log(`[sly-debug] Song Key: "${opts.store.songKey}" | Target Translation Language: "${lang}"`);
    console.log(`[sly-debug] Cache Original Length: ${cache.original.length}`);
    
    if (next === 'original') {
      const table = cache.original.map((line, idx) => ({
        Index: idx,
        Original: line
      }));
      console.table(table);
    } else {
      const processed = resolveProcessed(cache.processed, lang, next);
      if (!processed) {
        console.log(`[sly-debug] ⚠️ No processed cache found for language: "${lang}"`);
        console.groupEnd();
        return;
      }
      const targetLines = next === 'romanized' ? processed.romanized : processed.translated;
      console.log(`[sly-debug] Target Lines Length: ${targetLines?.length ?? 0}`);
      const table = cache.original.map((origLine, idx) => ({
        Index: idx,
        Original: origLine,
        [next.charAt(0).toUpperCase() + next.slice(1)]: targetLines?.[idx] ?? '---'
      }));
      console.table(table);
    }
    console.groupEnd();
  };

  function applyOriginalModeLyrics(): void {
    const cache = opts.store.cache;
    const nativeLines = getLyricsLines().map(el => {
      const original = el.getAttribute('data-sly-original');
      return original !== null ? original : (el.textContent ?? '');
    });
    const hasNativeRomanizedSpotify = nativeLines.length > 0 && isLatinScript(nativeLines);
    const hasDeRomanizedCache = cache.original.length > 0 && !isLatinScript(cache.original);

    if (hasNativeRomanizedSpotify && hasDeRomanizedCache) {
      console.log(`[sly-audit] 📄 Spotify renders romanized native text, but cache contains de-romanized originals. Overriding DOM with cache.original.`);
      const targets = getTargets();
      const domElements = targets ?? getLyricsLines();
      
      opts.store.isApplying = true;
      domElements.forEach((el, idx) => {
        if (!el) return;
        const textToSet = cache.original[idx];
        if (textToSet === undefined) return;

        if (!el.hasAttribute('data-sly-original')) {
          el.setAttribute('data-sly-original', el.textContent ?? '');
        }
        el.textContent = textToSet;
      });
      setTimeout(() => { opts.store.isApplying = false; }, 50);
    } else {
      console.log(`[sly-audit] 📄 Reverting to pristine original lyrics and purging custom DOM elements.`);
      purgeSlyDOM();
    }
  }

  /** S1: remember a request the interceptor guards refused, for 'sly:interceptor_settled'. */
  const deferSwitch = (next: LyricsMode, forceLang: string | undefined, internal: boolean): void => {
    if (!internal) opts.store.pendingUserSwitch = { mode: next, lang: forceLang, songKey: opts.store.songKey };
  };

  /**
   * @param internal true for this controller's own re-runs (autoSwitchIfNeeded,
   *   reapplyMode recovery): they neither record nor cancel a deferred request
   *   (store.pendingUserSwitch); the settle handler re-runs preferredMode for them.
   */
  async function switchMode(next: LyricsMode, forceLang?: string, suppressLoading = false, forceRefresh = false, cacheOverride?: SongCache, internal = false): Promise<void> {
    traceEvent(`switchMode:${next}`);
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    const cache = cacheOverride || opts.store.cache;
    const dualLyricsEnabled = opts.store.dualLyricsEnabled;

    const isNoop = next === mode && forceLang === undefined && !forceRefresh;
    // The rows on screen belong to another track (e.g. the previous song's rows
    // are still mounted): nothing to switch. Return before touching mode, pill,
    // loading state, switchGen or a deferred request, so the NATIVE_OK ticks that
    // re-run this do not churn. Switching to Original always proceeds.
    const snapshot = !isNoop && cache.original.length === 0 ? snapshotOriginals(cache) : null;
    if (snapshot === 'refused' && next !== 'original') {
      console.log(`[sly-mode] ⏭️ switchMode("${next}") skipped: the rows on screen belong to another track.`);
      return;
    }
    // The same early return when cache.original does not belong to the native rows
    // on screen (a takeover's lines after sly:release, another song's cache): both
    // the Latin fallback and the processed apply would paint it on them, and the
    // NATIVE_OK ticks re-run this. mode, preferredMode and lyricsAppliedForKey stay.
    // After a takeover ended on the same song the cache is the takeover's: re-read
    // the native rows instead (reconcileTakeoverCache replaces it in place).
    if (!isNoop && next !== 'original' && !getTargets() && !cacheFitsNativeRows(cache.original) &&
        !(cache === opts.store.cache && reconcileTakeoverCache(opts.store, `switchMode("${next}")`))) {
      noteCacheSkip(`switchMode("${next}")`, cache.original.length, getLyricsLines().length);
      return;
    }

    // A newer request replaces a deferred one. Re-applying the painted mode with a
    // language or a forced refresh (native upgrade, popup language change) is not one.
    if (!internal && (next !== mode || (forceLang === undefined && !forceRefresh))) opts.store.pendingUserSwitch = null;
    if (isNoop) return;

    const currentSwitchGen = ++opts.store.switchGenRef.value;
    const previousMode = mode;
    console.log(`[sly-audit] 🔄 Mode Change Requested: "${previousMode}" ➡️ "${next}"`);
    discardStaleProcessedCache(cache);

    const isNativeLanguage = (window as any).SLY_NATIVE_LANGUAGES?.has((window as any).spotifyState?.language);

    // BUG-4: the originals are Latin but the song's language is non-Latin, i.e.
    // Spotify is showing its own romanization. Wait ONLY while the interceptor is
    // still fetching the native script (K4: interceptorActive is true between
    // SLY_INTERCEPT_START and SLY_INTERCEPT_END). The request is remembered and
    // 'sly:interceptor_settled' replays it (automatic switches: preferredMode is
    // re-run instead). Once it has settled, the Latin lines are the only
    // lyrics available and Romanized/Translated must work on them (a late native
    // upgrade still replaces them via SKL_NATIVE_LYRICS).
    // IMPORTANT: Only for romanized/translated — switching to 'original' must ALWAYS
    // be allowed (Round 2, Bug 2).
    const interceptorInFlight = !!(window as any).slyInternalState?.interceptorActive;
    if (next !== 'original' && interceptorInFlight && cache.original.length > 0 && isLatinScript(cache.original) &&
        (isNativeLanguage || isLikelyRomanizedFallback(cache.original, (window as any).spotifyState?.language ?? null).romanized)) {
      console.warn(`[sly-mode] ⚠️ BUG-4: Originals are Latin for a non-Latin song and the interceptor is in flight. Waiting for the native upgrade.`);
      deferSwitch(next, forceLang, internal);
      opts.store.mode = previousMode;
      syncButtonStates(previousMode);
      // This call is the newest generation: it owns (and must release) the flag.
      opts.store.isSwitchingMode = false;
      setLoadingState(false);
      return;
    }

    // A cache entry must be derived from this song's exact lyric text, not
    // merely have the same number of lines. This prevents an old track's
    // romanization (e.g. Korean) being painted over a new source (e.g. Japanese).
    if (cache.original.length > 0) {
      const expectedSourceHash = hashString(cache.original.join('|'));
      for (const [lang, entry] of cache.processed) {
        if (entry.sourceHash !== expectedSourceHash) {
          console.warn(`[sly-mode] 🧹 Rejecting stale processed lyrics for ${lang}: source hash mismatch/missing.`);
          cache.processed.delete(lang);
        }
      }
    }

    // Latin originals are already "romanized": show them as they are. This holds
    // for romanized fallbacks of non-Latin songs too (no native upgrade arrived).
    if (next === 'romanized' && forceLang === undefined && isLatinScript(cache.original)) {
      // (A cache.original that does not belong to the native rows returned above.)
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
      logEntireLyrics(next, cache, opts.store.currentActiveLang || 'en');
      applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
      opts.store.lyricsAppliedForKey = opts.store.songKey;
      syncButtonStates(next);
      // This call is the newest generation: release a flag left by a superseded switch.
      opts.store.isSwitchingMode = false;
      setLoadingState(false);
      return;
    }

    opts.store.mode = next;
    syncButtonStates(next);

    if (!suppressLoading) setLoadingState(true);
    opts.store.isSwitchingMode = true;

    if (next !== 'original' && cache.original.length === 0) {
      // BUG-3 Fix: Roll back mode to prevent state corruption.
      // store.mode was set to `next` on line 135 above, but we're about to return
      // without applying any lyrics. If we leave mode as 'romanized', all future
      // switchMode calls hit the `next === mode` guard (line 108) and become no-ops.
      // The user sees Original lyrics but the pill says Romanized, and clicking
      // any button does nothing.
      // While the interceptor is in flight the snapshot was refused (BUG-4): retry on settle.
      if (interceptorInFlight) deferSwitch(next, forceLang, internal);
      opts.store.mode = previousMode;
      syncButtonStates(previousMode);
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
        applyOriginalModeLyrics();
        opts.store.lyricsAppliedForKey = opts.store.songKey;
        setLoadingState(false);
      } else {
        const lang = forceLang || opts.store.currentActiveLang || await getTargetLang();

        let processed: ProcessedCache | null = null;
        if (next === 'romanized' && cache.processed.size > 0) {
          processed = resolveProcessed(cache.processed, lang, 'romanized') ?? null;
        } 
        if (processed && !hasAlignedProcessedLines(processed, next, cache.original.length)) {
          console.warn('[SKaraoke:Content] Stale processed cache rejected. Mode:', next, 'Processed:', (next === 'romanized' ? processed.romanized : processed.translated)?.length, 'Original:', cache.original.length);
          cache.processed.clear();
          processed = null;
        }
        const fetchReport: FetchProcessedReport = {};
        if (!processed) {
          const genRef = opts.store.globalProcessGenRef;
          processed = await fetchProcessed(cache.original, lang, cache, opts.store.songKey, opts.store.runtimeCache, genRef, fetchReport);
        }

        if (currentSwitchGen !== opts.store.switchGenRef.value) return;

        // K1: total failure (null), or Translated mode with a failed translation
        // (romanization from the same response stays cached in memory).
        const translationUnavailable = next === 'translated' && processed !== null && !Array.isArray(processed.translated);
        if (processed === null || translationUnavailable) {
          opts.store.mode = previousMode;
          syncButtonStates(previousMode);
          setLoadingState(false); // SLY FIX: Clear loading state on failed processing!
          if (translationUnavailable || fetchReport.status === 'failed') {
            lastAutoSwitchFailure = { key: failureKey(next, lang, cache), at: Date.now() };
            showToast(translationUnavailable ? 'Translation failed. Please try again.' : 'Processing failed. Please try again.', 3000);
          }
          return;
        }
        lastAutoSwitchFailure = null;

        opts.store.currentActiveLang = lang;
        if (preferredMode !== next) {
          opts.store.preferredMode = next;
          safeBrowserCall(() => browser.storage.sync.set({ preferredMode: next }));
        }
        const lines = (next === 'romanized' ? processed.romanized : processed.translated) ?? [];
        const targets = getTargets();
        if (targets && targets.length !== cache.original.length) {
          console.warn('[SKaraoke:Content] Alignment mismatch detected (Processed). DOM:', targets.length, 'Cache:', cache.original.length);
        }
        console.log(`[sly-audit] 🔮 Processed Lyrics ("${next}" mode, First 5 lines):\n`, lines.slice(0, 5).map((l, i) => `  ${i + 1}: ${l}`).join('\n'));
        logEntireLyrics(next, cache, lang);
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
    traceEvent('reapplyMode');
    const mode = opts.store.mode;
    const currentActiveLang = opts.store.currentActiveLang;
    const cache = opts.store.cache;
    const dualLyricsEnabled = opts.store.dualLyricsEnabled;
    discardStaleProcessedCache(cache);

    if (mode === 'original') {
      if (opts.store.isSwitchingMode) return;
      applyOriginalModeLyrics();
      opts.store.lyricsAppliedForKey = opts.store.songKey;
      return;
    }
    if (opts.store.isSwitchingMode) return;

    const processed = resolveProcessed(cache.processed, currentActiveLang, mode);

    if (!processed) {
      if (mode === 'romanized' && isLatinScript(cache.original)) {
        const targets = getTargets();
        if (!targets && !cacheFitsNativeRows(cache.original)) {
          noteCacheSkip('reapplyMode Latin path', cache.original.length, getLyricsLines().length);
          return;
        }
        console.log(`[SKaraoke:Mode] reapplyMode: Latin script detected for romanized mode. Using originals.`);
        logEntireLyrics('romanized', cache, currentActiveLang);
        applyLinesToDOM(cache.original, undefined, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
        opts.store.lyricsAppliedForKey = opts.store.songKey;
        setLoadingState(false);
        return;
      }

      if ((mode as LyricsMode) !== 'original') {
        console.warn(`[SKaraoke:Mode] reapplyMode: Data missing for ${mode}. Triggering recovery fetch.`);
        await switchMode(mode, undefined, false, true, undefined, true);
      }
      return;
    }

    if (!hasAlignedProcessedLines(processed, mode, cache.original.length)) {
      console.warn('[SKaraoke:Mode] reapplyMode: stale processed cache rejected. Recomputing.');
      cache.processed.clear();
      await switchMode(mode, undefined, false, true, undefined, true);
      return;
    }

    const lines = (mode === 'romanized' ? processed.romanized : processed.translated) ?? [];
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
    logEntireLyrics(mode, cache, currentActiveLang);
    applyLinesToDOM(lines, cache.original, dualLyricsEnabled, (v) => { opts.store.isApplying = v; }, targets);
    opts.store.lyricsAppliedForKey = opts.store.songKey;
    setLoadingState(false);
  }

  function autoSwitchIfNeeded(forceRefresh = false, cacheOverride?: SongCache): void {
    if (opts.store.isSwitchingMode && !forceRefresh) return;
    const mode = opts.store.mode;
    const preferredMode = opts.store.preferredMode;
    const cache = cacheOverride ?? opts.store.cache;
    discardStaleProcessedCache(cache);

    const nativeLines = getLyricsLines().map(el => {
      const original = el.getAttribute('data-sly-original');
      return original !== null ? original : (el.textContent ?? '');
    });
    const hasNativeRomanizedSpotify = nativeLines.length > 0 && isLatinScript(nativeLines);
    const hasDeRomanizedCache = cache.original.length > 0 && !isLatinScript(cache.original);
    const needsOriginalOverride = preferredMode === 'original' && hasNativeRomanizedSpotify && hasDeRomanizedCache;

    // Classic trigger: mode is still 'original' but user wants something else,
    // or preferredMode is 'original' but we need to apply the de-romanized override.
    const modeNeedsSwitch = (mode === 'original' && preferredMode !== 'original') || needsOriginalOverride;

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
      // Rejection-loop guard: the periodic triggers must not re-request lyrics
      // the background just failed to process (each attempt would flash the
      // loading state and toast again every poll tick).
      if (!forceRefresh && preferredMode !== 'original' && lastAutoSwitchFailure &&
          Date.now() - lastAutoSwitchFailure.at < AUTO_SWITCH_FAILURE_BACKOFF_MS &&
          lastAutoSwitchFailure.key === failureKey(preferredMode, opts.store.currentActiveLang, cache)) {
        setLoadingState(false);
        return;
      }
      // Pass forceRefresh=true when data isn't ready so switchMode bypasses the
      // same-mode early-return guard (mode === preferredMode after optimistic init).
      switchMode(preferredMode, undefined, false, forceRefresh || optimisticNeedsFetch, cacheOverride, true);
    } else {
      setLoadingState(false); // SLY FIX: Clear the loading state if no switch is needed!
    }
  }

  /** K7: forget in-session failure memory after a cache reset. */
  function resetFailureMemory(): void {
    lastAutoSwitchFailure = null;
  }

  return { switchMode, reapplyMode, autoSwitchIfNeeded, resetFailureMemory };
}
