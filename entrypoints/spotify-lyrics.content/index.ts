import './style.css';

export default defineContentScript({
  matches: ['*://open.spotify.com/*'],
  runAt: 'document_idle',
  main,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type LyricsMode = 'original' | 'romanized' | 'translated';

interface ProcessedCache {
  translated: string[];
  romanized: string[];
}

interface SongCache {
  original: string[];
  // Key: targetLang code. Both romanized and translated stored together
  // since they come from the same API call.
  processed: Map<string, ProcessedCache>;
}

// Persistent cache types (browser.storage.local)
interface LyricsCacheEntry {
  original: string[];   // Snapshotted lyrics — used to validate cache coherence
  processed: {
    [targetLang: string]: ProcessedCache;
  };
  lastAccessed: number;     // Unix ms — used for LRU eviction
}

type LyricsIndex = {
  [songKey: string]: {
    size: number;   // Approx byte size of the entry
    lastAccessed: number;
  };
};

// ─── State ────────────────────────────────────────────────────────────────────

const CONTROLS_ID = 'sly-lyrics-controls';
let mode: LyricsMode = 'original';
let preferredMode: LyricsMode = 'original';
let currentActiveLang = 'en';
let dualLyricsEnabled = true;
let songKey = '';
let cache: SongCache = { original: [], processed: new Map() };
let domObserver: MutationObserver | null = null;
let lyricsObserver: MutationObserver | null = null;
let processGen = 0; // cancel stale in-flight requests
let setupDebounceTimer: number | null = null;
let pollId: number | null = null;
let isApplying = false;

// Synchronous in-memory mirror of recently processed songs.
// saveSongCache writes here so syncSetup can consume cached data without an
// async storage.local round-trip, eliminating the preloadedCacheEntry race.
const runtimeCache = new Map<string, LyricsCacheEntry>();
const RUNTIME_CACHE_MAX = 10;

// ─── Native Lyrics State ──────────────────────────────────────────────────────

// Native-script lines pending for a track that haven't been snapshotted yet
// (Scenario A: interceptor fires before trySetup)
const pendingNativeLines = new Map<string, string[]>();

// ─── DOM Queries ──────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, durationMs = 0): void {
  let toast = document.getElementById('sly-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sly-toast';
    toast.className = 'sly-toast';
    document.body.appendChild(toast);
  }

  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');

  // durationMs = 0 means persistent until hideToast() is called
  if (durationMs > 0) {
    toastTimer = setTimeout(() => hideToast(), durationMs);
  }
}

function hideToast(onlyPersistent = false): void {
  const toast = document.getElementById('sly-toast');
  if (!toast) return;
  // If onlyPersistent is true, don't dismiss a timed toast mid-countdown
  if (onlyPersistent && toastTimer !== null) return;
  toast.classList.remove('visible');
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

const getLyricsLines = (): Element[] =>
  Array.from(document.querySelectorAll('[data-testid="lyrics-line"] > div'));

const getLyricsContainer = (): Element | null =>
  document.querySelector('[data-testid="lyrics-line"]')?.parentElement ?? null;

const getNowPlayingKey = (): string =>
  document.querySelector('[data-testid="now-playing-widget"]')
    ?.getAttribute('aria-label') ?? '';

const getNowPlayingTrackId = (): string | null => {
  const widget = document.querySelector('[data-testid="now-playing-widget"]');
  if (!widget) return null;
  const link = widget.querySelector<HTMLAnchorElement>('a[href*="/track/"], a[href*="spotify:track:"]');
  if (!link) return null;
  const href = link.getAttribute('href') || '';
  const match = href.match(/track[:/]([A-Za-z0-9]+)/);
  return match ? match[1] : null;
};

const hasLyrics = (): boolean =>
  document.querySelector('[data-testid="lyrics-button"]:not([disabled])') !== null;

// ─── Snapshot ────────────────────────────────────────────────────────────────

function snapshotOriginals(): void {
  const lines = getLyricsLines();

  lines.forEach((el) => {
    if (el.hasAttribute('data-sly-original')) return;

    const dualSub = el.querySelector<HTMLElement>('.sly-dual-line');
    if (dualSub) {
      el.setAttribute('data-sly-original', dualSub.textContent ?? '');
      return;
    }
    const mainSpan = el.querySelector<HTMLElement>('.sly-main-line');
    if (mainSpan) {
      el.setAttribute('data-sly-original', mainSpan.textContent ?? '');
      return;
    }
    el.setAttribute('data-sly-original', el.textContent ?? '');
  });

  cache.original = lines.map(
    (el) => el.getAttribute('data-sly-original') ?? ''
  );
}

// ─── Controls UI ──────────────────────────────────────────────────────────────

function injectControls(container: Element): void {
  const existing = document.getElementById(CONTROLS_ID);
  if (existing) {
    existing.classList.remove('sly-loading');
    return;
  }

  const wrap = document.createElement('div');
  wrap.id = CONTROLS_ID;
  wrap.className = 'sly-lyrics-controls';

  const displayMode =
    mode === 'original' && preferredMode !== 'original' ? preferredMode : mode;

  (['original', 'romanized', 'translated'] as LyricsMode[]).forEach((m) => {
    const btn = document.createElement('button');
    btn.className = `sly-lyrics-btn${displayMode === m ? ' active' : ''}`;
    btn.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    btn.dataset.mode = m;
    btn.addEventListener('click', () => switchMode(m));
    wrap.appendChild(btn);
  });

  container.insertBefore(wrap, container.firstChild);
}

function syncButtonStates(): void {
  document
    .getElementById(CONTROLS_ID)
    ?.querySelectorAll<HTMLElement>('.sly-lyrics-btn')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
}

function setLoadingState(loading: boolean): void {
  document
    .getElementById(CONTROLS_ID)
    ?.querySelectorAll<HTMLButtonElement>('.sly-lyrics-btn')
    .forEach((b) => (b.disabled = loading));
  getLyricsContainer()?.classList.toggle('sly-loading', loading);
}

// ─── Lyrics Replacement ───────────────────────────────────────────────────────

function applyLinesToDOM(
  lines: string[] | null | undefined,
  originals?: string[]
): void {
  if (!Array.isArray(lines)) return;

  isApplying = true;

  getLyricsLines().forEach((el, i) => {
    if (lines[i] === undefined) return;

    if (originals?.[i] !== undefined) {
      el.setAttribute('data-sly-original', originals[i]);
    }

    const showDual =
      dualLyricsEnabled &&
      originals !== undefined &&
      originals[i] !== undefined &&
      originals[i] !== lines[i];

    if (showDual) {
      el.textContent = '';
      const mainSpan = document.createElement('span');
      mainSpan.className = 'sly-main-line';
      mainSpan.textContent = lines[i];
      el.appendChild(mainSpan);

      const subSpan = document.createElement('span');
      subSpan.className = 'sly-dual-line';
      subSpan.textContent = originals![i];
      el.appendChild(subSpan);
    } else {
      el.textContent = lines[i];
    }
  });

  setTimeout(() => { isApplying = false; }, 0);
}

// ─── Anti-Flicker Lyrics Observer ────────────────────────────────────────────

function startLyricsObserver(): void {
  lyricsObserver?.disconnect();
  const container = getLyricsContainer();
  if (!container) return;

  lyricsObserver = new MutationObserver(() => {
    if (isApplying || mode === 'original') return;

    const processed = cache.processed.get(currentActiveLang);
    if (!processed) return;

    const lines = mode === 'romanized' ? processed.romanized : processed.translated;
    const domLines = getLyricsLines();

    const needsReapply = domLines.some((el, i) => {
      if (lines[i] === undefined) return false;
      const mainSpan = el.querySelector<HTMLElement>('.sly-main-line');
      if (mainSpan) return mainSpan.textContent !== lines[i];
      return el.textContent !== lines[i];
    });

    if (needsReapply) {
      applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined);
    }
  });

  lyricsObserver.observe(container, {
    subtree: true,
    childList: true,
    // characterData omitted: extension writes at element level (textContent), not text nodes.
    // childList alone is sufficient to detect Spotify overwriting our injected text.
  });
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function getTargetLang(): Promise<string> {
  const data = await browser.storage.sync.get('targetLang');
  return (data.targetLang as string) ?? 'en';
}

// ─── Persistent Lyrics Cache ──────────────────────────────────────────────────

const EVICT_THRESHOLD_BYTES = 8 * 1024 * 1024; // 8 MB — start evicting
const EVICT_TARGET_BYTES = 6 * 1024 * 1024; // 6 MB — evict down to this

/**
 * Loads any previously cached processed results for the current song.
 * Validates the stored original against the live DOM snapshot to ensure
 * coherence (e.g. rejects a romanized-fallback cache after a native override).
 */
async function loadSongCache(key: string): Promise<void> {
  if (!key) return;
  try {
    let entry: LyricsCacheEntry | undefined;

    // Hot path: check the synchronous runtime cache first — no async yield needed.
    const runtimeEntry = runtimeCache.get(key);
    if (runtimeEntry) {
      entry = runtimeEntry;
    } else {
      // Cold path: first play of this song since browser start — read from storage.
      const storageKey = `lc:${key}`;
      const data = await browser.storage.local.get(storageKey);
      entry = data[storageKey] as LyricsCacheEntry | undefined;
    }

    if (!entry) return;

    // Validate: if originals differ the cache is stale (e.g. native vs romanized)
    if (JSON.stringify(entry.original) !== JSON.stringify(cache.original)) {
      deleteSongCache(key); // purge the stale entry
      return;
    }

    // Merge all stored language results into the in-memory Map
    for (const [lang, processed] of Object.entries(entry.processed)) {
      if (!cache.processed.has(lang)) {
        cache.processed.set(lang, processed);
      }
    }

    // Update lastAccessed in storage index (fire-and-forget)
    browser.storage.local.get('lc_index').then((d) => {
      const idx = (d['lc_index'] ?? {}) as LyricsIndex;
      if (idx[key]) {
        idx[key].lastAccessed = Date.now();
        browser.storage.local.set({ lc_index: idx });
      }
    }).catch(() => { });
  } catch (err) {
    console.warn('[SlyLyrics] loadSongCache failed:', err);
  }
}

/**
 * Persists the current in-memory cache for this song to storage.local.
 * Merges with any existing entry so multiple languages accumulate.
 * Fires LRU eviction if storage is getting full.
 */
async function saveSongCache(key: string): Promise<void> {
  if (!key || cache.original.length === 0) return;

  const processedObj: LyricsCacheEntry['processed'] = {};
  cache.processed.forEach((val, lang) => { processedObj[lang] = val; });

  const entry: LyricsCacheEntry = {
    original: cache.original,
    processed: processedObj,
    lastAccessed: Date.now(),
  };

  // Write to the synchronous runtime cache so the NEXT song's syncSetup can
  // find this entry without an async storage read (zero-latency hot path).
  runtimeCache.set(key, entry);
  if (runtimeCache.size > RUNTIME_CACHE_MAX) {
    runtimeCache.delete(runtimeCache.keys().next().value!);
  }

  const size = new TextEncoder().encode(JSON.stringify(entry)).length;
  const storageKey = `lc:${key}`;

  browser.storage.local.get('lc_index').then(async (d) => {
    const idx = (d['lc_index'] ?? {}) as LyricsIndex;
    idx[key] = { size, lastAccessed: entry.lastAccessed };
    await browser.storage.local.set({ [storageKey]: entry, lc_index: idx });
    evictIfNeeded(idx);
  }).catch((err) => console.warn('[SlyLyrics] saveSongCache failed:', err));
}

/** LRU eviction — removes oldest entries until storage.local is under 6 MB. */
function evictIfNeeded(idx: LyricsIndex): void {
  const runEviction = async (bytes: number) => {
    if (bytes <= EVICT_THRESHOLD_BYTES) return;

    const sorted = Object.entries(idx).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    const toRemove: string[] = [];
    let freed = 0;

    for (const [sk, meta] of sorted) {
      if (bytes - freed <= EVICT_TARGET_BYTES) break;
      toRemove.push(`lc:${sk}`);
      freed += meta.size;
      delete idx[sk];
    }

    if (toRemove.length === 0) return;
    await browser.storage.local.remove(toRemove);
    await browser.storage.local.set({ lc_index: idx });
  };

  if (typeof browser.storage.local.getBytesInUse === 'function') {
    browser.storage.local.getBytesInUse(null).then(runEviction).catch(() => { });
  } else {
    // Firefox MV2 does not implement getBytesInUse — estimate from index metadata instead
    const estimatedBytes = Object.values(idx).reduce((sum, m) => sum + m.size, 0);
    runEviction(estimatedBytes).catch(() => { });
  }
}

/** Removes a single song entry from storage and its index record. */
function deleteSongCache(key: string): void {
  if (!key) return;
  browser.storage.local.get('lc_index').then((d) => {
    const idx = (d['lc_index'] ?? {}) as LyricsIndex;
    delete idx[key];
    browser.storage.local.remove(`lc:${key}`);
    browser.storage.local.set({ lc_index: idx });
  }).catch(() => { });
}

/**
 * Fetches both translated and romanized lines in a single background call.
 * Caches by targetLang — switching between Romanized and Translated after
 * the first fetch for a given language is always a cache hit.
 */
async function fetchProcessed(
  lines: string[],
  lang: string
): Promise<ProcessedCache | null> {
  if (cache.processed.has(lang)) return cache.processed.get(lang)!;

  const gen = ++processGen;

  const result = await browser.runtime.sendMessage({
    type: 'PROCESS',
    lines,
    targetLang: lang,
  }) as ProcessedCache | null;

  if (gen !== processGen) return null; // stale — song or lang changed mid-flight
  if (!result || !Array.isArray(result.translated)) return null;

  cache.processed.set(lang, result);
  saveSongCache(songKey); // persist to storage.local (fire-and-forget)
  return result;
}

// ─── Mode Switching ───────────────────────────────────────────────────────────

// Unicode ranges for every non-Latin script that background.ts tracks.
// If none of these are present but letters exist, the song is Latin-script.
// Keep these ranges in sync with detectScript() in background.ts
const NON_LATIN_SCRIPT_RE =
  /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0900-\u0D7F\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F]/

function isLatinScript(lines: string[]): boolean {
  const text = lines.join('');
  return !NON_LATIN_SCRIPT_RE.test(text) && /\p{L}/u.test(text);
}

async function switchMode(next: LyricsMode, forceLang?: string): Promise<void> {
  if (next === mode && forceLang === undefined) return;
  if (cache.original.length === 0) snapshotOriginals();

  // Fast-path: romanizing Latin-script lyrics is a no-op — the original IS
  // the romanized form. Skip the network call and loading state entirely.
  if (next === 'romanized' && forceLang === undefined && isLatinScript(cache.original)) {
    mode = next;
    preferredMode = next;
    browser.storage.sync.set({ preferredMode: next });
    applyLinesToDOM(cache.original);
    syncButtonStates();
    return;
  }

  setLoadingState(true);

  try {
    if (next === 'original') {
      mode = next;
      preferredMode = next;
      browser.storage.sync.set({ preferredMode: next });
      // Apply text content while shimmer still hides it (-webkit-text-fill-color: transparent),
      // then reveal by removing the shimmer — both land in the same paint frame.
      applyLinesToDOM(cache.original);
      setLoadingState(false);
    } else {
      const lang = forceLang ?? (await getTargetLang());
      const processed = await fetchProcessed(cache.original, lang);

      if (processed === null) return;

      currentActiveLang = lang;
      mode = next;
      preferredMode = next;
      browser.storage.sync.set({ preferredMode: next });
      const lines = next === 'romanized' ? processed.romanized : processed.translated;
      // Apply text content while shimmer still hides it (-webkit-text-fill-color: transparent),
      // then reveal by removing the shimmer — both land in the same paint frame.
      applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined);
      setLoadingState(false);
    }

    syncButtonStates();
  } catch (err) {
    console.error('[SlyLyrics] Mode switch failed:', err);
    // Show a user-visible toast for 3 seconds, then auto-dismiss
    showToast('Translation failed. Please try again.', 3000);
    // Snap back to whichever mode was working before
    mode = mode === next ? 'original' : mode;
    syncButtonStates();
  } finally {
    hideToast(true);
    setLoadingState(false); // no-op if already cleared above, safe to call twice
  }
}

// ─── Reapply & Auto-Switch ────────────────────────────────────────────────────

async function reapplyMode(): Promise<void> {
  if (mode === 'original') return;

  const processed = cache.processed.get(currentActiveLang);
  if (!processed) return;

  const lines = mode === 'romanized' ? processed.romanized : processed.translated;
  applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined);
}

function autoSwitchIfNeeded(): void {
  if (mode === 'original' && preferredMode !== 'original') {
    switchMode(preferredMode);
  }
}

// ─── Native Lyrics Override ───────────────────────────────────────────────────

/**
 * Scenario A helper — called from trySetup() right after snapshotOriginals().
 * If native lines are already waiting for the current track, swap them into
 * cache.original and rewrite the DOM before controls are injected.
 */
function applyNativeOverride(): void {
  const domTrackId = getNowPlayingTrackId();
  if (!domTrackId) return;

  const native = pendingNativeLines.get(domTrackId);
  if (!native || native.length === 0) return;

  pendingNativeLines.delete(domTrackId);
  cache.original = native;

  // Rewrite the DOM lines so Spotify shows native script, and update
  // data-sly-original to match (snapshotOriginals wrote the romanized fallback;
  // leaving it stale would permanently desync the DOM from cache.original).
  getLyricsLines().forEach((el, i) => {
    if (native[i] !== undefined) {
      el.textContent = native[i];
      el.setAttribute('data-sly-original', native[i]);
    }
  });
}

/**
 * Called when the fetch interceptor posts a SKL_NATIVE_LYRICS message.
 *
 * Scenario A — trySetup() hasn't fired yet:
 *   Store lines in pendingNativeLines; applyNativeOverride() will pick them up.
 *
 * Scenario B — trySetup() already ran with romanized lines as source:
 *   Overwrite cache.original, invalidate stale processed data, cancel any
 *   in-flight PROCESS request, rewrite the DOM immediately, and re-trigger
 *   the current mode so it re-processes from the correct native lines.
 */
async function handleNativeLyrics(
  trackId: string,
  nativeLines: string[]
): Promise<void> {
  // Always store in the pending map (Scenario A pick-up).
  pendingNativeLines.set(trackId, nativeLines);

  // Scenario B: the song is already active and its lines have been snapshotted.
  // We check against the literal DOM track ID to ignore prefetch API calls.
  if (trackId !== getNowPlayingTrackId() || cache.original.length === 0) return;

  // Remove from pending — we're handling it now.
  pendingNativeLines.delete(trackId);

  // Overwrite the snapshot with real native-script lines.
  cache.original = nativeLines;

  // Discard all processed data derived from the wrong (romanized) source.
  cache.processed.clear();
  // Invalidate the persistent entry — its originals and processed data are
  // both stale now. It will be rebuilt correctly after the next fetchProcessed.
  deleteSongCache(songKey);

  // Cancel any in-flight PROCESS request that used the old lines.
  processGen++;

  // Immediately show native script in the DOM so the user isn't stuck
  // staring at romanized text while the new API round-trip completes.
  // Also update data-sly-original to keep it in sync with cache.original.
  getLyricsLines().forEach((el, i) => {
    if (nativeLines[i] !== undefined) {
      el.textContent = nativeLines[i];
      el.setAttribute('data-sly-original', nativeLines[i]);
    }
  });

  // If a processed mode was active, re-trigger it from the correct originals.
  if (mode !== 'original') {
    await switchMode(mode, currentActiveLang);
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function trySetup(): Promise<void> {
  if (!hasLyrics()) return;
  const container = getLyricsContainer();
  if (!container) return;
  if (cache.original.length === 0) snapshotOriginals();
  // Scenario A: apply any native lines that arrived before the DOM was ready
  applyNativeOverride();
  // Load from storage (or the preloaded entry if syncSetup couldn't consume it)
  await loadSongCache(songKey);

  injectControls(container);
  startLyricsObserver();
  await reapplyMode();
  autoSwitchIfNeeded();
}

/**
 * Executes a completely synchronous setup pipeline immediately after Spotify
 * injects new lyrics into the DOM, intercepting the text before the browser
 * paints the frame. This eliminates the "flash" of original lyrics and keeps
 * the UI pill continuously visible.
 */
function syncSetup(): void {
  // Note: hasLyrics() (mic-button check) intentionally omitted here.
  // syncSetup is only fired from the MutationObserver after confirming
  // `lyrics-line` nodes exist in the DOM. Spotify enables the mic button
  // asynchronously after inserting the nodes; waiting for it costs a paint
  // frame and introduces the flash we are trying to eliminate.
  const container = getLyricsContainer();
  if (!container) return;

  if (cache.original.length === 0) snapshotOriginals();
  applyNativeOverride();

  // Consume from the synchronous runtime cache — no async storage round-trip.
  const runtimeEntry = runtimeCache.get(songKey);
  if (runtimeEntry) {
    if (runtimeEntry.original.join('\n') === cache.original.join('\n')) {
      for (const [lang, res] of Object.entries(runtimeEntry.processed)) {
        cache.processed.set(lang, res);
      }
      saveSongCache(songKey); // bump lastAccessed
    } else {
      deleteSongCache(songKey); // originals mismatch — invalidate stale entry
    }
  }

  injectControls(container);
  startLyricsObserver();

  // Instantly apply translation if mode requires it, bypassing async switchMode
  if (preferredMode !== 'original') {
    const processed = cache.processed.get(currentActiveLang);
    if (processed) {
      mode = preferredMode;
      const lines = mode === 'romanized' ? processed.romanized : processed.translated;
      applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined);
      syncButtonStates();
      // Cancel the poll so pollForLyricsContainer doesn't fire a redundant
      // trySetup that would yield to a paint frame via 'await reapplyMode()'.
      if (pollId) { cancelAnimationFrame(pollId); pollId = null; }
      return; // Fast path complete!
    }
  }

  // Cache miss — let the async poll/setup handle the API call.
  // Cancel the poll so trySetup can't fire a second autoSwitchIfNeeded
  // in the next rAF frame, which would waste an API call via a duplicate PROCESS.
  if (pollId) { cancelAnimationFrame(pollId); pollId = null; }
  autoSwitchIfNeeded();
}

// ─── Song Change ─────────────────────────────────────────────────────────────

function pollForLyricsContainer(attempts = 0): void {
  if (attempts > 120) return;
  if (hasLyrics() && getLyricsContainer()) {
    trySetup();
  } else {
    pollId = requestAnimationFrame(() => pollForLyricsContainer(attempts + 1));
  }
}

function onSongChange(newKey: string): void {
  if (newKey === songKey) return;
  songKey = newKey;
  mode = 'original';
  processGen++;
  lyricsObserver?.disconnect();
  lyricsObserver = null;
  cache = { original: [], processed: new Map() };

  // Visually disable the controls pill instead of deleting it
  const controls = document.getElementById(CONTROLS_ID);
  if (controls) controls.classList.add('sly-loading');

  if (pollId) cancelAnimationFrame(pollId);
  pollForLyricsContainer();
}

// ─── Storage Listener ────────────────────────────────────────────────────────

function startStorageListener(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;

    if ('targetLang' in changes && mode === 'translated') {
      const newLang = (changes.targetLang.newValue as string | undefined) ?? 'en';
      switchMode('translated', newLang);
    }

    if ('dualLyrics' in changes) {
      dualLyricsEnabled = (changes.dualLyrics.newValue as boolean | undefined) ?? true;
      if (mode !== 'original' && cache.original.length > 0) {
        const processed = cache.processed.get(currentActiveLang);
        if (processed) {
          const lines = mode === 'romanized' ? processed.romanized : processed.translated;
          applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined);
        }
      }
    }

    // Handles reset — snaps mode back to Original immediately
    // if the panel is open when the user resets settings
    if ('preferredMode' in changes) {
      const newPref = (changes.preferredMode.newValue as LyricsMode | undefined) ?? 'original';
      preferredMode = newPref;
      if (newPref === 'original' && mode !== 'original') {
        switchMode('original');
      }
    }
  });
}

// ─── Global MutationObserver ─────────────────────────────────────────────────

function startObserver(): void {
  if (domObserver) return;

  domObserver = new MutationObserver((mutations) => {
    // Pass 1 — Song key update.
    // Process aria-label attribute mutations FIRST so that songKey is always
    // updated before Pass 2 reads runtimeCache.get(songKey) inside syncSetup.
    // Without this split, Spotify can emit lyrics DOM nodes and the aria-label
    // change in the same batch with lyrics first, causing syncSetup to look up
    // the wrong (previous) song key and get a cache miss even for cached songs.
    for (const mut of mutations) {
      if (
        mut.type === 'attributes' &&
        mut.attributeName === 'aria-label' &&
        (mut.target as Element).closest('[data-testid="now-playing-widget"]')
      ) {
        onSongChange(getNowPlayingKey());
      }
    }

    // Pass 2 — DOM structure changes (lyrics injection / controls removal).
    for (const mut of mutations) {
      if (mut.type !== 'childList') continue;

      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (
          node.matches('[data-testid="lyrics-line"]') ||
          node.querySelector('[data-testid="lyrics-line"]')
        ) {
          syncSetup();
          break;
        }
      }

      for (const node of mut.removedNodes) {
        if (node instanceof Element && node.id === CONTROLS_ID) {
          trySetup();
          break;
        }
      }
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const prefs = await browser.storage.sync.get(['dualLyrics', 'targetLang', 'preferredMode']);
    dualLyricsEnabled = prefs.dualLyrics !== undefined
      ? (prefs.dualLyrics as boolean)
      : true;
    currentActiveLang = (prefs.targetLang as string) ?? 'en';
    preferredMode = (prefs.preferredMode as LyricsMode) ?? 'original';
  } catch {
    console.warn('[SlyLyrics] storage.sync unavailable, using defaults');
    dualLyricsEnabled = true;
    currentActiveLang = 'en';
    preferredMode = 'original';
  }

  // Listen for messages posted by the main-world fetchInterceptor.
  // We only care about SKL_NATIVE_LYRICS. We no longer track SKL_TRACK_START
  // because Spotify prefetches the next song's lyrics before the DOM changes,
  // which caused race conditions. Instead we verify track IDs against the DOM.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.type !== 'SKL_NATIVE_LYRICS') return;
    handleNativeLyrics(msg.trackId as string, msg.nativeLines as string[]);
  });

  startObserver();
  startStorageListener();
  trySetup();
}
