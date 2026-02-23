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

// ─── Native Lyrics State ──────────────────────────────────────────────────────

// Spotify track ID parsed from the color-lyrics API URL by fetchInterceptor.js
let currentTrackId = '';
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
  if (document.getElementById(CONTROLS_ID)) return;

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
    characterData: true,
  });
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function getTargetLang(): Promise<string> {
  const data = await browser.storage.sync.get('targetLang');
  return (data.targetLang as string) ?? 'en';
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
  return result;
}

// ─── Mode Switching ───────────────────────────────────────────────────────────

async function switchMode(next: LyricsMode, forceLang?: string): Promise<void> {
  if (next === mode && forceLang === undefined) return;
  if (cache.original.length === 0) snapshotOriginals();

  setLoadingState(true);

  try {
    if (next === 'original') {
      mode = next;
      preferredMode = next;
      browser.storage.sync.set({ preferredMode: next });
      applyLinesToDOM(cache.original);
    } else {
      const lang = forceLang ?? (await getTargetLang());
      const processed = await fetchProcessed(cache.original, lang);

      if (processed === null) return;

      currentActiveLang = lang;
      mode = next;
      preferredMode = next;
      browser.storage.sync.set({ preferredMode: next });

      const lines = next === 'romanized' ? processed.romanized : processed.translated;
      applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : undefined);
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
    setLoadingState(false);
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
  const native = pendingNativeLines.get(currentTrackId);
  if (!native || native.length === 0) return;

  pendingNativeLines.delete(currentTrackId);
  cache.original = native;

  // Rewrite the DOM lines so Spotify shows native script
  getLyricsLines().forEach((el, i) => {
    if (native[i] !== undefined) el.textContent = native[i];
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
  if (trackId !== currentTrackId || cache.original.length === 0) return;

  // Remove from pending — we're handling it now.
  pendingNativeLines.delete(trackId);

  // Overwrite the snapshot with real native-script lines.
  cache.original = nativeLines;

  // Discard all processed data derived from the wrong (romanized) source.
  cache.processed.clear();

  // Cancel any in-flight PROCESS request that used the old lines.
  processGen++;

  // Immediately show native script in the DOM so the user isn't stuck
  // staring at romanized text while the new API round-trip completes.
  getLyricsLines().forEach((el, i) => {
    if (nativeLines[i] !== undefined) el.textContent = nativeLines[i];
  });

  // Update the data-sly-original attributes to match
  getLyricsLines().forEach((el, i) => {
    if (nativeLines[i] !== undefined) {
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
  injectControls(container);
  startLyricsObserver();
  await reapplyMode();
  autoSwitchIfNeeded();
}

function debouncedSetup(): void {
  if (setupDebounceTimer) cancelAnimationFrame(setupDebounceTimer);
  setupDebounceTimer = requestAnimationFrame(() => trySetup());
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
  currentTrackId = ''; // will be set when SKL_NATIVE_LYRICS arrives
  lyricsObserver?.disconnect();
  lyricsObserver = null;
  cache = { original: [], processed: new Map() };
  document.getElementById(CONTROLS_ID)?.remove();

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
    for (const mut of mutations) {
      if (
        mut.type === 'attributes' &&
        mut.attributeName === 'aria-label' &&
        (mut.target as Element).closest('[data-testid="now-playing-widget"]')
      ) {
        onSongChange(getNowPlayingKey());
        continue;
      }

      if (mut.type !== 'childList') continue;

      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (
          node.matches('[data-testid="lyrics-line"]') ||
          node.querySelector('[data-testid="lyrics-line"]')
        ) {
          debouncedSetup();
          break;
        }
      }

      for (const node of mut.removedNodes) {
        if (node instanceof Element && node.id === CONTROLS_ID) {
          debouncedSetup();
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

  // Listen for native-script lines posted by the main-world fetchInterceptor
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.type !== 'SKL_NATIVE_LYRICS') return;
    // Update currentTrackId the first time we hear about this track
    if (!currentTrackId) currentTrackId = msg.trackId as string;
    handleNativeLyrics(msg.trackId as string, msg.nativeLines as string[]);
  });

  startObserver();
  startStorageListener();
  trySetup();
}
