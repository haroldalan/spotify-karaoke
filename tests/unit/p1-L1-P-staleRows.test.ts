/**
 * Live round 1, group P2: stale rows bound to the wrong song.
 * After a skip Spotify keeps the previous song's rows mounted for a while;
 * Pipeline B bound rows to a song only by the widget aria-label, so they were
 * snapshotted as the new song's lyrics and later painted over the next song's
 * rows. DOM-only guards: retired rows, the reverse canonical-hash lookup and a
 * cache-vs-rows check on the native-row paint paths.
 *
 * Synthetic 2026-11 panel fixture; every lyric line, title and id is invented.
 */
import { ROMANIZER_VERSION } from '../../lib/core/processedCache';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModeController } from '../../lib/core/modeController';
import { createLifecycleController, setupSlyBridge } from '../../lib/core/lifecycleController';
import { handleNativeLyrics } from '../../lib/core/nativeLyricsHandler';
import { StateStore } from '../../lib/core/store';
import { getLyricsContainer, getLyricsLines } from '../../lib/dom/domQueries';
import { cacheMatchesRows, snapshotOriginals, RETIRED_ROWS_WINDOW_MS, resetNativeOverrides, rowsOnScreenAreRetired } from '../../lib/dom/lyricsDOM';
import { hashString } from '../../lib/utils/hashUtils';
import { slyInternalState, spotifyState } from '../../lib/slyCore/state';

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf-8');
const OLD_TITLE = 'Test Song';
const OLD_KEY = 'Now playing: Test Song by Test Artist, Second Artist';
const NEW_TITLE = 'Quiet Harbour';
const NEW_KEY = 'Now playing: Quiet Harbour by Invented Band';
const OLD_ID = 'OldTrackAaaaaaaaaaaaa1';
const NEW_ID = 'NewTrackBbbbbbbbbbbbb2';
const NEXT_ID = 'NextTrackCccccccccccc3';

// Invented Devanagari stand-ins for the fixture's 7 rows ('♪' at index 2).
const NATIVE_7 = ['नदी किनारे', 'हवा चली', '♪', 'रात सुहानी', 'दीप जले', 'गीत पुराना', 'सुबह हुई'];
const ROMAN_7 = ['nadi kinare', 'hawa chali', '♪', 'raat suhani', 'deep jale', 'geet purana', 'subah hui'];
const ENGLISH_7 = ['by the river', 'the wind blew', '♪', 'a pleasant night', 'lamps are lit', 'an old song', 'morning came'];

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

function makeRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-testid', 'lyrics-line');
  row.className = 'MFEBmMwUCW5Qmg8VwGim tixQoLB1xUrPglVJ91J4';
  const inner = document.createElement('div');
  inner.className = 'tUO1WBVA3vpkKoCsTCU_';
  inner.textContent = text;
  row.appendChild(inner);
  return row;
}

function replaceRows(texts: string[]): void {
  getLyricsContainer()!.replaceChildren(...texts.map(makeRow));
}

function setWidget(title: string, key: string): void {
  const widget = document.querySelector('[data-testid="now-playing-widget-v2"]')!;
  widget.setAttribute('aria-label', key);
  widget.querySelector('a[href^="/album/"]')!.textContent = title;
}

function setBridgeTrack(id: string | null, name = ''): void {
  (spotifyState as any).track = id ? { uri: `spotify:track:${id}`, name } : null;
}

const rowTexts = () => getLyricsLines().map(el => el.getAttribute('data-sly-original') ?? el.textContent ?? '');
const screenTexts = () => getLyricsLines().map(el => el.textContent ?? '');
const hasOurMarkup = () => getLyricsLines().some(el => el.hasAttribute('data-sly-original') || el.querySelector('.sly-main-line, .sly-dual-line'));
const processedFor = (original: string[], romanized: string[], translated: string[]) =>
  ({ romanized, translated, sourceHash: hashString(original.join('|')), romanizerVersion: ROMANIZER_VERSION });

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const settle = async (ms = 50) => { await flush(); await vi.advanceTimersByTimeAsync(ms); await flush(); };

// One store, controller and bridge for the file: setupSlyBridge's document
// listeners cannot be removed, so it is wired exactly once.
const store = new StateStore();
let mc: ReturnType<typeof createModeController>;
let lifecycle: ReturnType<typeof createLifecycleController>;
let warnSpy: ReturnType<typeof vi.spyOn>;
const warnings = (needle: string) => warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes(needle)).length;

beforeAll(() => {
  mc = createModeController({ store });
  lifecycle = createLifecycleController({ store, switchMode: mc.switchMode, reapplyMode: mc.reapplyMode, autoSwitchIfNeeded: mc.autoSwitchIfNeeded });
  setupSlyBridge(store, mc.switchMode, mc.autoSwitchIfNeeded, () => {});
});

beforeEach(() => {
  vi.useFakeTimers();
  loadFixture();
  for (const m of ['log', 'table', 'groupCollapsed', 'groupEnd', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  sessionStorage.clear();
  Object.assign(store, new StateStore());
  store.songKey = OLD_KEY;
  store.currentActiveLang = 'en';
  mc.resetFailureMemory();
  (window as any).browser.runtime.id = 'test-id';
  (window as any).browser.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
  setBridgeTrack(null);
  spotifyState.language = null;
  slyInternalState.interceptorActive = false;
  slyInternalState.isTransitioning = false;
  slyInternalState.currentLyrics = null;
  slyInternalState.pendingLyricsData = null;
  slyInternalState.colorLyricsSeenAt.clear();
  resetNativeOverrides();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  setBridgeTrack(null);
});

let skipCount = 0;
let newKey = NEW_KEY;

/**
 * Plays OLD in Romanized mode (Latin rows: snapshot + Latin fallback), then skips
 * to NEW with OLD's rows still mounted. Each call uses its own new song key
 * (refusal warnings are logged once per song key and reason).
 */
async function skipWithOldRowsMounted(): Promise<string[]> {
  newKey = `${NEW_KEY} ${++skipCount}`;
  store.preferredMode = 'romanized';
  setBridgeTrack(OLD_ID, OLD_TITLE);
  await lifecycle.trySetup();
  await settle();
  expect(store.mode).toBe('romanized');
  expect(getLyricsLines()[0].querySelector('.sly-main-line')).not.toBeNull();
  const oldRows = rowTexts();

  setWidget(NEW_TITLE, newKey);
  setBridgeTrack(NEW_ID, NEW_TITLE);
  lifecycle.onSongChange(newKey); // no canonical hash for the new track
  await settle();
  return oldRows;
}

describe('p1-L1-P stale rows after a skip (retired rows)', () => {
  it('onSongChange with the old rows still mounted and no hash leaves cache.original [] and mode unchanged', async () => {
    await skipWithOldRowsMounted();
    expect(store.songKey).toBe(newKey);
    expect(store.trackId).toBe(NEW_ID);
    expect(store.canonicalHash).toBeNull();
    expect(store.cache.original).toEqual([]);
    expect(store.mode).toBe('original');
    expect(store.isSwitchingMode).toBe(false);
    expect(hasOurMarkup()).toBe(false);
    expect(warnings('rows belong to the previous track')).toBe(1);
  });

  it('stops refusing the same rows once the window has passed, when Spotify requested lyrics for the new track', async () => {
    const oldRows = await skipWithOldRowsMounted();
    expect(snapshotOriginals(store.cache)).toBe('refused');
    slyInternalState.colorLyricsSeenAt.set(NEW_ID, Date.now());
    await settle(RETIRED_ROWS_WINDOW_MS);
    expect(snapshotOriginals(store.cache)).toBe('ok');
    expect(store.cache.original).toEqual(oldRows);
  });

  it('keeps refusing the previous track\'s lingering rows past the window for a track without lyrics (no request ever seen)', async () => {
    await skipWithOldRowsMounted();
    await settle(RETIRED_ROWS_WINDOW_MS * 2);
    expect(snapshotOriginals(store.cache)).toBe('refused');
    expect(store.cache.original).toEqual([]);
    await mc.switchMode('translated');
    expect(store.mode).toBe('original');
    expect(hasOurMarkup()).toBe(false);
  });

  it('accepts the new song once its rows are new nodes', async () => {
    await skipWithOldRowsMounted();
    const newRows = ['', 'Naya safar shuru hua', 'Raaste mein phool khile', 'Dil ne kaha chalo'];
    replaceRows(newRows);
    expect(snapshotOriginals(store.cache)).toBe('ok');
    expect(store.cache.original).toEqual(newRows);
  });

  it('accepts the same nodes once Spotify rewrote them in place with the new text', async () => {
    await skipWithOldRowsMounted();
    const inners = getLyricsLines();
    const newRows = ['Pehli nayi line', 'Doosri nayi line', '♪', 'Teesri nayi line', 'Chauthi nayi line', 'Paanchvi nayi line', 'Chhathi nayi line'];
    inners.forEach((el, i) => { el.textContent = newRows[i]; });
    await mc.switchMode('romanized');
    expect(store.cache.original).toEqual(newRows);
    expect(store.mode).toBe('romanized');
  });

  it('accepts retired rows whose hash is the new track\'s own canonical hash (two versions of one song)', async () => {
    const oldRows = await skipWithOldRowsMounted();
    store.canonicalHash = hashString(oldRows.join('|'));
    expect(snapshotOriginals(store.cache)).toBe('ok');
    expect(store.cache.original).toEqual(oldRows);
  });

  it('a refused snapshot inside switchMode does not toggle mode, loading, switchGen or a deferred request', async () => {
    await skipWithOldRowsMounted();
    const gen = store.switchGenRef.value;
    const deferred = { mode: 'translated' as const, lang: 'en', songKey: newKey };
    store.pendingUserSwitch = deferred;
    const container = getLyricsContainer()!;
    container.classList.add('sly-loading');

    await mc.switchMode('romanized'); // a click
    expect(store.mode).toBe('original');
    expect(store.switchGenRef.value).toBe(gen);
    expect(store.isSwitchingMode).toBe(false);
    expect(store.pendingUserSwitch).toBe(deferred);
    expect(container.classList.contains('sly-loading')).toBe(true); // setLoadingState was not called

    container.classList.remove('sly-loading');
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: 'NATIVE_OK' } })); // slyCore poll ticks
      await flush();
    }
    expect(store.switchGenRef.value).toBe(gen);
    expect(store.mode).toBe('original');
    expect(container.classList.contains('sly-loading')).toBe(false);
    expect(warnings('rows belong to the previous track')).toBe(1);
  });

  it('switching to Original still works while the rows are refused', async () => {
    await skipWithOldRowsMounted();
    store.mode = 'romanized'; // so that Original is a real switch, not a no-op
    await mc.switchMode('original');
    expect(store.preferredMode).toBe('original');
    expect(hasOurMarkup()).toBe(false);
  });
});

describe('p1-L1-P reverse canonical-hash lookup', () => {
  beforeEach(() => {
    store.songKey = OLD_KEY;
  });

  it('refuses rows whose hash is another track\'s canonical hash, without writing attributes', () => {
    setBridgeTrack(OLD_ID, OLD_TITLE);
    store.canonicalHashes.set(NEXT_ID, hashString(rowTexts().join('|')));
    expect(snapshotOriginals(store.cache)).toBe('refused');
    expect(store.trackId).toBe(OLD_ID); // resolved lazily by the guard
    expect(store.cache.original).toEqual([]);
    expect(hasOurMarkup()).toBe(false);
    expect(snapshotOriginals(store.cache)).toBe('refused');
    expect(warnings('rows belong to another track')).toBe(1); // once per (song, reason)
  });

  it('accepts them when they also match the current track\'s canonical hash', () => {
    setBridgeTrack(OLD_ID, OLD_TITLE);
    const rowsHash = hashString(rowTexts().join('|'));
    store.canonicalHashes.set(NEXT_ID, rowsHash);
    store.canonicalHashes.set(OLD_ID, rowsHash);
    expect(snapshotOriginals(store.cache)).toBe('ok');
  });

  it('never refuses on this rule while the track id is unknown', () => {
    setBridgeTrack(null);
    store.canonicalHashes.set(NEXT_ID, hashString(rowTexts().join('|')));
    expect(snapshotOriginals(store.cache)).toBe('ok');
    expect(store.cache.original).toHaveLength(7);
  });
});

describe('p1-L1-P cache-vs-rows guard on the native-row paint paths', () => {
  it('38 cached lines are never painted over 46 unrelated rows', async () => {
    const rows46 = ['', '', ...Array.from({ length: 44 }, (_, i) => `별빛 아래 ${i + 1}번째 노래`)];
    replaceRows(rows46);
    store.songKey = OLD_KEY;
    store.preferredMode = 'romanized';
    store.mode = 'romanized'; // set by the earlier (stale) Latin fallback
    store.cache.original = ['', '', ...Array.from({ length: 36 }, (_, i) => `Purani dhun ki line ${i + 1}`)];
    expect(store.cache.original).toHaveLength(38);

    await mc.reapplyMode();
    await mc.switchMode('romanized', undefined, false, true);
    await lifecycle.trySetup();
    lifecycle.quickApply();
    await lifecycle.syncSetup();
    await settle();

    expect(hasOurMarkup()).toBe(false);
    expect(screenTexts()).toEqual(rows46);
    expect(store.lyricsAppliedForKey).toBe('');
  });

  it('the takeover-sourced cache is not painted onto native rows after release', async () => {
    const takeover = ['♪', ...NATIVE_7.filter(l => l !== '♪')]; // Pipeline A's lines: other text, other layout
    const takeoverRoman = ['♪', ...ROMAN_7.filter(l => l !== '♪')];
    const takeoverEnglish = ['♪', ...ENGLISH_7.filter(l => l !== '♪')];
    const spotifyRows = screenTexts();
    store.songKey = OLD_KEY;
    store.preferredMode = 'romanized';
    store.mode = 'romanized';
    store.godState = 'PIPELINE_A';
    store.cache.original = takeover;
    store.cache.processed.set('en', processedFor(takeover, takeoverRoman, takeoverEnglish));
    store.slyActiveContainer = document.createElement('div');

    document.dispatchEvent(new CustomEvent('sly:release'));
    // What onControlsRemoved / onLyricsInjected run once the native rows are back:
    lifecycle.syncPill(true);
    await lifecycle.trySetup();
    lifecycle.quickApply();
    await lifecycle.syncSetup();
    await settle();

    expect(hasOurMarkup()).toBe(false);
    expect(screenTexts()).toEqual(spotifyRows);
    expect(store.mode).toBe('original');
    expect(store.lyricsAppliedForKey).toBe('');
    expect(store.cache.original).toEqual(takeover); // skipped, not torn down

    // slyCore stands down for the native rows: its NATIVE_OK ticks run
    // autoSwitchIfNeeded → switchMode, whose apply must skip the cache as well.
    const gen = store.switchGenRef.value;
    for (let i = 0; i < 2; i++) {
      document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: 'NATIVE_OK' } }));
      await settle();
    }
    expect(hasOurMarkup()).toBe(false);
    expect(screenTexts()).toEqual(spotifyRows);
    expect(store.mode).toBe('original');
    expect(store.lyricsAppliedForKey).toBe('');
    expect(store.switchGenRef.value).toBe(gen); // early return: no churn per tick
    expect(store.isSwitchingMode).toBe(false);
  });

  it('quickApply with dual off and an upgraded cache (one trailing \'\') still applies', () => {
    getLyricsLines().forEach((el, i) => { el.textContent = NATIVE_7[i]; }); // in-time upgrade: Spotify rendered the native lines
    store.songKey = OLD_KEY;
    store.preferredMode = 'romanized';
    store.dualLyricsEnabled = false;
    store.cache.original = [...NATIVE_7, ''];
    store.cache.processed.set('en', processedFor(store.cache.original, [...ROMAN_7, ''], [...ENGLISH_7, '']));

    lifecycle.quickApply();

    const lines = getLyricsLines();
    expect(lines[0].querySelector('.sly-main-line')?.textContent).toBe('Nadi kinare');
    expect(lines[6].querySelector('.sly-main-line')?.textContent).toBe('Subah hui');
    expect(lines.some(el => el.querySelector('.sly-dual-line'))).toBe(false);
    expect(store.mode).toBe('romanized');
    expect(store.lyricsAppliedForKey).toBe(OLD_KEY);
  });

  it('a late native override still applies, and its rows keep passing the guard after a re-render', async () => {
    setBridgeTrack(OLD_ID, OLD_TITLE);
    store.songKey = OLD_KEY;
    const spotifyRows = screenTexts();
    store.cache.original = [...spotifyRows];
    const state = {
      cache: store.cache, pendingNativeLines: store.pendingNativeLines, songKey: store.songKey,
      mode: store.mode, currentActiveLang: 'en', runtimeCache: store.runtimeCache as any,
    };

    const applied = await handleNativeLyrics(OLD_ID, [...NATIVE_7, ''], state, () => {}, async () => {}, { late: true, spotifyLineCount: 8 });
    expect(applied).toBe(true);
    expect(store.cache.original).toEqual(NATIVE_7);
    expect(screenTexts()).toEqual(NATIVE_7); // rows rewritten (Original mode)

    store.preferredMode = 'romanized';
    store.dualLyricsEnabled = true;
    store.cache.processed.set('en', processedFor(NATIVE_7, ROMAN_7, ENGLISH_7));
    lifecycle.quickApply();
    expect(getLyricsLines()[0].querySelector('.sly-main-line')?.textContent).toBe('Nadi kinare');
    expect(getLyricsLines()[0].querySelector('.sly-dual-line')?.textContent).toBe(NATIVE_7[0]);

    // React re-renders Spotify's own (romanized) text into the rows.
    getLyricsLines().forEach((el, i) => { el.removeAttribute('data-sly-original'); el.textContent = spotifyRows[i]; });
    lifecycle.quickApply();
    expect(getLyricsLines()[3].querySelector('.sly-main-line')?.textContent).toBe('Raat suhani');

    getLyricsLines().forEach((el, i) => { el.removeAttribute('data-sly-original'); el.textContent = spotifyRows[i]; });
    await lifecycle.syncSetup();
    expect(getLyricsLines()[3].querySelector('.sly-main-line')?.textContent).toBe('Raat suhani');
  });
});

describe('p1-L1-P track id after the song change', () => {
  it('a first song with track id null re-resolves it later and adopts its canonical hash', () => {
    store.songKey = '';
    setBridgeTrack(OLD_ID, ''); // bridge tick before the widget content: empty name
    store.canonicalHashes.set(OLD_ID, 4242);
    lifecycle.onSongChange(OLD_KEY);
    expect(store.trackId).toBeNull();
    expect(store.canonicalHash).toBeNull();

    setBridgeTrack(OLD_ID, OLD_TITLE);
    lifecycle.quickApply();
    expect(store.trackId).toBe(OLD_ID);
    expect(store.canonicalHash).toBe(4242);
  });
});

describe('p1-L1-P cacheMatchesRows', () => {
  it('matches by hash, ignoring a trailing \'\' line and spacer layout', () => {
    expect(cacheMatchesRows([...NATIVE_7, ''], NATIVE_7)).toBe(true);
    expect(cacheMatchesRows(['', '', ...NATIVE_7], NATIVE_7)).toBe(true);
  });

  it('matches by word-line count plus at least half of the rows\' text', () => {
    const edited = [...NATIVE_7];
    edited[0] = 'नदी  किनारे ';            // whitespace only
    edited[1] = 'हवा चली थी';               // a real edit
    edited[3] = 'रात बड़ी सुहानी';            // a real edit
    expect(cacheMatchesRows(NATIVE_7, edited)).toBe(true); // 5 of the 7 non-empty rows ('♪' included) found
    edited[4] = 'दीप जल गए';
    expect(cacheMatchesRows(NATIVE_7, edited)).toBe(true); // 4 of 7
    edited[5] = 'गीत नया';
    expect(cacheMatchesRows(NATIVE_7, edited)).toBe(false); // 3 of 7
  });

  it('does not match rows of another song or another layout', () => {
    expect(cacheMatchesRows(ROMAN_7, NATIVE_7)).toBe(false);
    expect(cacheMatchesRows(NATIVE_7, [...NATIVE_7, 'एक और पंक्ति'])).toBe(false);
  });
});

describe('p1-L1-P row ownership at the song change (review round)', () => {
  const nativeOk = () => document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: 'NATIVE_OK' } }));

  it('rows of the next track that mounted before the label changed (bridge already on it, no hash) stay its rows', async () => {
    // A: a track without lyrics (empty cache). The bridge already names B, the widget still says A.
    store.songKey = OLD_KEY;
    store.preferredMode = 'romanized';
    setBridgeTrack(NEW_ID, NEW_TITLE);
    const bRows = ['', '', 'Naya safar shuru hua', 'Raaste mein phool khile', 'Dil ne kaha chalo', 'Saath chalenge hum'];
    replaceRows(bRows);
    await lifecycle.syncSetup(); // snapshots them under A: nothing tells them apart yet
    await settle(700);
    expect(store.cache.original).toEqual(bRows);

    const key = `${NEW_KEY} early rows`;
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    expect(store.trackId).toBe(NEW_ID);
    await settle(2000);
    await lifecycle.trySetup();
    nativeOk();
    await settle(100);

    expect(warnings('rows belong to the previous track')).toBe(0);
    expect(store.cache.original).toEqual(bRows);
    expect(store.mode).toBe('romanized');
    expect(getLyricsLines()[2].querySelector('.sly-main-line')?.textContent).toBe('Naya safar shuru hua');
  });

  it('the outgoing track\'s rows stay retired when the bridge moved on before the label and they were re-applied meanwhile', async () => {
    store.preferredMode = 'romanized';
    setBridgeTrack(OLD_ID, OLD_TITLE);
    await lifecycle.trySetup();
    await settle();
    expect(store.mode).toBe('romanized');

    setBridgeTrack(NEW_ID, NEW_TITLE); // the bridge leads the label
    await mc.reapplyMode(); // a re-apply in that window binds the rows again
    const key = `${NEW_KEY} lead window`;
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    await settle();

    expect(store.cache.original).toEqual([]);
    expect(snapshotOriginals(store.cache)).toBe('refused');
    expect(store.mode).toBe('original');
  });

  it('Original mode with a stored cache (rows never bound) still retires them at the song change', async () => {
    store.preferredMode = 'original';
    setBridgeTrack(OLD_ID, OLD_TITLE);
    store.cache.original = rowTexts(); // loaded from storage: verifyAndHealCache neither snapshots nor binds
    await lifecycle.trySetup();
    await settle();

    const key = `${NEW_KEY} original mode`;
    setWidget(NEW_TITLE, key);
    setBridgeTrack(NEW_ID, NEW_TITLE);
    lifecycle.onSongChange(key); // the next track has no lyrics and no hash; the old rows linger
    await settle(2000); // past the transition window
    await lifecycle.trySetup();
    expect(store.cache.original).toEqual([]);
    expect(snapshotOriginals(store.cache)).toBe('refused');

    await mc.switchMode('romanized'); // a click
    expect(store.mode).toBe('original');
    expect(store.cache.original).toEqual([]);
    expect(hasOurMarkup()).toBe(false);
  });

  it('fresh rows of a second version (same text) are accepted once its own hash arrives after the song change', async () => {
    store.preferredMode = 'romanized';
    setBridgeTrack(OLD_ID, OLD_TITLE);
    await lifecycle.trySetup();
    await settle();
    const oldRows = rowTexts();
    const h = hashString(oldRows.join('|'));
    store.canonicalHashes.set(OLD_ID, h); // captured while the first version played

    const key = `${NEW_KEY} second version`;
    setWidget(NEW_TITLE, key);
    setBridgeTrack(NEW_ID, NEW_TITLE);
    lifecycle.onSongChange(key);
    replaceRows(oldRows); // Spotify mounts new rows for the second version
    // SLY_CANONICAL_HASH for it: the handler fills canonicalHashes only.
    store.canonicalHashes.set(NEW_ID, h);
    await settle(2000);
    await lifecycle.syncSetup();
    await settle(600);
    nativeOk();
    await settle(100);

    expect(store.canonicalHash).toBeNull(); // handler semantics unchanged
    expect(warnings('rows belong to another track')).toBe(0);
    expect(store.cache.original).toEqual(oldRows);
    expect(store.mode).toBe('romanized');
    expect(getLyricsLines()[0].querySelector('.sly-main-line')).not.toBeNull();
  });

  it('the same nodes kept for a second version are accepted once its own hash arrives after the song change', async () => {
    const oldRows = await skipWithOldRowsMounted();
    const h = hashString(oldRows.join('|'));
    store.canonicalHashes.set(OLD_ID, h);
    expect(snapshotOriginals(store.cache)).toBe('refused');

    store.canonicalHashes.set(NEW_ID, h); // its own hash arrives
    await mc.switchMode('romanized');
    expect(store.cache.original).toEqual(oldRows);
    expect(store.mode).toBe('romanized');
  });
});

describe('p1-L1-P late native override after a reload', () => {
  // Lines unique to each test: this session's override record lives in a module-level registry.
  const nativeLines = (tag: string) => NATIVE_7.map(l => (l === '♪' ? l : `${l} ${tag}`));
  const romanLines = (tag: string) => ROMAN_7.map(l => (l === '♪' ? l : `${l} ${tag}`));
  const storedEntry = (original: string[], romanized: string[]) => ({
    original,
    originalHash: hashString(original.join('|')),
    processed: { en: processedFor(original, romanized, romanized.map(l => `EN ${l}`)) },
    lastAccessed: Date.now(),
    persistedAt: Date.now(),
  });
  const localGet = (window as any).browser.storage.local.get;
  afterEach(() => { (window as any).browser.storage.local.get = localGet; });

  it('a reload paints the stored native cache on Spotify\'s romanized rows at once (session copy)', async () => {
    // Saved after a late upgrade: the native lines laid out like the rows (alignNativeToRows).
    const native = nativeLines('session');
    sessionStorage.setItem(`sly_proc:${OLD_KEY}`, JSON.stringify(storedEntry(native, romanLines('session'))));
    store.songKey = ''; // fresh content script: no record of the override
    store.preferredMode = 'romanized';
    setBridgeTrack(OLD_ID, OLD_TITLE);

    lifecycle.onSongChange(OLD_KEY); // hot cache from the session copy; its poll runs trySetup
    await flush();
    await lifecycle.trySetup();
    lifecycle.quickApply();

    expect(store.cache.original).toEqual(native);
    expect(getLyricsLines()[0].querySelector('.sly-main-line')?.textContent).toBe('Nadi kinare session');
    expect(getLyricsLines()[0].querySelector('.sly-dual-line')?.textContent).toBe(native[0]);
    expect(store.mode).toBe('romanized');
  });

  it('a reload paints the stored native cache on Spotify\'s romanized rows (storage read)', async () => {
    const native = nativeLines('storage');
    const entry = storedEntry(native, romanLines('storage'));
    (window as any).browser.storage.local.get = vi.fn(async (key: string) => (key === `lc:${OLD_KEY}` ? { [key]: entry } : {}));
    store.songKey = '';
    store.preferredMode = 'romanized';
    setBridgeTrack(OLD_ID, OLD_TITLE);

    lifecycle.onSongChange(OLD_KEY); // cold: loadSongCache, then the reactive quickApply
    await settle();

    expect(store.cache.original).toEqual(native);
    expect(getLyricsLines()[3].querySelector('.sly-main-line')?.textContent).toBe('Raat suhani storage');
    expect(store.mode).toBe('romanized');
  });

  it('a stored native cache laid out otherwise (e.g. a takeover\'s lines) is not painted on the romanized rows', async () => {
    const native = nativeLines('other layout');
    const takeoverLike = ['♪', ...native.filter(l => l !== '♪')];
    const roman = romanLines('other layout');
    sessionStorage.setItem(`sly_proc:${OLD_KEY}`, JSON.stringify(storedEntry(takeoverLike, ['♪', ...roman.filter(l => l !== '♪')])));
    store.songKey = '';
    store.preferredMode = 'romanized';
    setBridgeTrack(OLD_ID, OLD_TITLE);

    lifecycle.onSongChange(OLD_KEY);
    await flush();
    await lifecycle.trySetup();
    lifecycle.quickApply();
    document.dispatchEvent(new CustomEvent('sly:state', { detail: { state: 'NATIVE_OK' } }));
    await settle();

    expect(hasOurMarkup()).toBe(false);
    expect(store.mode).toBe('original');
  });
});

describe('p1-L1-P cacheMatchesRows: late-override layout', () => {
  it('matches native lines laid out like Spotify\'s Latin rows, and nothing looser', () => {
    const rows = ['', 'Mera dil tera hai', '♪', 'Main har pal yahin hoon'];
    expect(cacheMatchesRows(['', 'मेरा दिल तेरा है', '♪', 'मैं हर पल यहीं हूँ'], rows)).toBe(true);
    expect(cacheMatchesRows(['मेरा दिल तेरा है', '', '♪', 'मैं हर पल यहीं हूँ'], rows)).toBe(false); // spacer moved
    expect(cacheMatchesRows(['', 'मेरा दिल तेरा है', '', 'मैं हर पल यहीं हूँ'], rows)).toBe(false); // other spacer text
    expect(cacheMatchesRows(['', 'मेरा दिल तेरा है', '♪', 'मैं हर पल यहीं हूँ', 'और एक'], rows)).toBe(false); // other length
    expect(cacheMatchesRows(['', 'Kuch aur hai', '♪', 'Sab kuch naya'], rows)).toBe(false); // Latin: another song
    expect(cacheMatchesRows(['', '별빛 아래', '♪', '노래 한 곡'], ['', '하늘 위에', '♪', '바람 소리'])).toBe(false); // rows not Latin
  });
});

describe('p1-L1-P review round 2 (cross-group verification)', () => {
  const pillButtonsDisabled = () => Array.from(document.querySelectorAll<HTMLButtonElement>('#sly-lyrics-controls .sly-lyrics-btn')).some(b => b.disabled);

  /** Pipeline A's takeover cache on the current song, with the pill injected (as live). */
  function takeoverOnCurrentSong(): void {
    const takeover = ['♪', ...NATIVE_7.filter(l => l !== '♪')];
    store.songKey = OLD_KEY;
    store.trackId = OLD_ID;
    setBridgeTrack(OLD_ID, OLD_TITLE);
    store.preferredMode = 'romanized';
    store.mode = 'romanized';
    store.godState = 'PIPELINE_A';
    store.cache.original = takeover;
    store.cacheFromTakeover = true;
    store.cache.processed.set('en', processedFor(takeover, ['♪', ...ROMAN_7.filter(l => l !== '♪')], ['♪', ...ENGLISH_7.filter(l => l !== '♪')]));
    store.slyActiveContainer = document.createElement('div');
    lifecycle.syncPill(true);
    expect(document.getElementById('sly-lyrics-controls')).not.toBeNull();
  }

  it('a takeover that ends on the same song: the native rows replace its cached lines and are processed', async () => {
    const spotifyRows = screenTexts();
    (window as any).browser.runtime.sendMessage = vi.fn((msg: any) => Promise.resolve(msg?.type === 'PROCESS'
      ? { romanized: msg.lines, translated: msg.lines.map((l: string) => (l ? `EN ${l}` : l)) }
      : undefined));
    takeoverOnCurrentSong();

    document.dispatchEvent(new CustomEvent('sly:release'));
    lifecycle.syncPill(true);
    await lifecycle.trySetup();
    lifecycle.quickApply();
    await lifecycle.syncSetup();
    await settle(200);

    expect(store.cache.original).toEqual(spotifyRows);
    expect(store.cacheFromTakeover).toBe(false);
    expect(pillButtonsDisabled()).toBe(false);
    // Romanized on Latin rows shows them as they are, now owned by this song.
    expect(store.mode).toBe('romanized');
    expect(getLyricsLines()[0].querySelector('.sly-main-line')).not.toBeNull();

    await mc.switchMode('translated');
    await settle(200);
    const sentProcess = ((window as any).browser.runtime.sendMessage as any).mock.calls.filter((c: any[]) => c[0]?.type === 'PROCESS');
    expect(sentProcess.length).toBeGreaterThan(0);
    expect(sentProcess.at(-1)[0].lines).toEqual(spotifyRows);
    expect(store.mode).toBe('translated');
  });

  it('a takeover released by a song change (bridge already names the next track) is not re-read from the outgoing rows', async () => {
    takeoverOnCurrentSong();
    setBridgeTrack(NEW_ID, NEW_TITLE);
    document.dispatchEvent(new CustomEvent('sly:release'));
    lifecycle.syncPill(true);
    await lifecycle.trySetup();
    lifecycle.quickApply();
    await lifecycle.syncSetup();
    await settle(200);

    expect(store.cacheFromTakeover).toBe(true);
    expect(hasOurMarkup()).toBe(false);
    expect(pillButtonsDisabled()).toBe(false); // the skip never leaves the pill disabled
  });

  it('a skipped setup never leaves the pill shimmering with its buttons disabled', async () => {
    store.songKey = OLD_KEY;
    store.preferredMode = 'translated';
    store.cache.original = ['Some other song line one', 'Some other song line two', 'Some other song line three'];
    store.cache.processed.set('en', processedFor(store.cache.original, store.cache.original, store.cache.original));
    lifecycle.syncPill(true);
    document.getElementById('sly-lyrics-controls')!.querySelectorAll<HTMLButtonElement>('.sly-lyrics-btn').forEach(b => { b.disabled = true; });
    await lifecycle.trySetup();
    await settle();
    expect(hasOurMarkup()).toBe(false);
    expect(pillButtonsDisabled()).toBe(false);
  });

  it('a native cache saved after an in-time upgrade (trailing \'\') still belongs to Spotify\'s romanized rows', () => {
    expect(cacheMatchesRows([...NATIVE_7, ''], ROMAN_7)).toBe(true);
    expect(cacheMatchesRows([...NATIVE_7, '', ''], [...ROMAN_7, ''])).toBe(true);
    // A different layout still does not fit.
    expect(cacheMatchesRows(['♪', ...NATIVE_7.filter(l => l !== '♪')], ROMAN_7)).toBe(false);
  });

  it('a skip away from a takeover retires the native rows that sat behind it, though they were never bound (live round 2)', async () => {
    // Live: the fallback takeover came from the session cache at 0 ms, so Spotify's own
    // (romanized) rows were never snapshotted or painted, and "Retired 0 row(s)" let the
    // next track (no lyrics) snapshot and paint them.
    store.songKey = OLD_KEY;
    store.trackId = OLD_ID;
    setBridgeTrack(OLD_ID, OLD_TITLE);
    store.preferredMode = 'romanized';
    store.cache.original = ['♪', ...NATIVE_7.filter(l => l !== '♪')];
    store.cacheFromTakeover = true;
    expect(hasOurMarkup()).toBe(false); // nothing ever bound these rows

    const key = `${NEW_KEY} takeover-skip`;
    setWidget(NEW_TITLE, key);
    setBridgeTrack(NEW_ID, NEW_TITLE);
    lifecycle.onSongChange(key);
    await settle();
    await lifecycle.trySetup();
    await settle(200);

    expect(store.cache.original).toEqual([]);
    expect(hasOurMarkup()).toBe(false);
    expect(snapshotOriginals(store.cache)).toBe('refused');
    expect(rowsOnScreenAreRetired()).toBe(true); // slyCore's detector sees the same verdict
    expect(store.cacheFromTakeover).toBe(false);
  });

  it('corrects a track id taken while the bridge still named the previous track with the same title', async () => {
    store.songKey = OLD_KEY;
    store.trackId = OLD_ID; // taken at the song change from the lagging bridge
    store.canonicalHashes.set(NEW_ID, 12345);
    setBridgeTrack(NEW_ID, OLD_TITLE); // the bridge caught up: same title, the real id
    await lifecycle.trySetup();
    expect(store.trackId).toBe(NEW_ID);
    expect(store.canonicalHash).toBe(12345);
  });
});

describe('cached lyrics of the next song are staged once the bridge names it', () => {
  it('track unknown at the song change: staged on the bridge update that names it', () => {
    const key = `${NEW_KEY} staged`;
    const uri = `spotify:track:${NEW_ID}`;
    slyInternalState.l0Cache.set(uri, { syncedLyrics: '[00:01.00] invented line', _slyUri: uri });
    setBridgeTrack(OLD_ID, OLD_TITLE);
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    expect(slyInternalState.stagedTakeover ?? null).toBeNull();

    // A bridge update still on the previous track changes nothing.
    window.dispatchEvent(new CustomEvent('sly_state_update'));
    expect(slyInternalState.stagedTakeover ?? null).toBeNull();

    setBridgeTrack(NEW_ID, NEW_TITLE);
    window.dispatchEvent(new CustomEvent('sly_state_update'));
    expect(slyInternalState.stagedTakeover?.uri).toBe(uri);
    expect(slyInternalState.stagedTakeover?.data.isInstant).toBe(true);
    expect(document.documentElement.getAttribute('data-sly-takeover-uri')).toBe(uri);

    slyInternalState.l0Cache.delete(uri);
    slyInternalState.stagedTakeover = null;
    document.documentElement.removeAttribute('data-sly-takeover-uri');
  });

  it('not cached: slyCore\'s check is run at once instead', () => {
    const key = `${NEW_KEY} uncached`;
    const kick = vi.fn();
    (window as any).slyKickPoll = kick;
    setBridgeTrack(OLD_ID, OLD_TITLE);
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    kick.mockClear();
    setBridgeTrack(NEW_ID, NEW_TITLE);
    window.dispatchEvent(new CustomEvent('sly_state_update'));
    expect(kick).toHaveBeenCalledTimes(1);
    expect(slyInternalState.stagedTakeover ?? null).toBeNull();
    delete (window as any).slyKickPoll;
  });
});

describe('cached lyrics found by the widget\'s title before the bridge names the track', () => {
  const savedRegistry = (window as any).slyPreFetchRegistry;
  afterEach(() => { (window as any).slyPreFetchRegistry = savedRegistry; });
  it('one cached track with that title and artist: staged at the song change (Spotify\'s panel held)', () => {
    const key = `Now playing: ${NEW_TITLE} by Invented Band`;
    const uri = `spotify:track:${NEW_ID}`;
    slyInternalState.l0Cache.set(uri, { syncedLyrics: '[00:01.00] invented line', _slyUri: uri });
    (window as any).slyPreFetchRegistry = { getState: (u: string) => (u === uri ? { title: NEW_TITLE, artist: 'Invented Band', nativeStatus: 'ROMANIZED' } : undefined) };
    setBridgeTrack(OLD_ID, OLD_TITLE);
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    expect(slyInternalState.stagedTakeover?.uri).toBe(uri);
    expect(document.documentElement.getAttribute('data-sly-takeover-uri')).toBe(uri);

    slyInternalState.l0Cache.delete(uri);
    slyInternalState.stagedTakeover = null;
    document.documentElement.removeAttribute('data-sly-takeover-uri');
  });

  it('the next song\'s panel is there: the cached lyrics go in at once, the bridge still naming the previous track', async () => {
    const key = `Now playing: ${NEW_TITLE} by Invented Band early`;
    const uri = `spotify:track:${NEW_ID}`;
    slyInternalState.l0Cache.set(uri, { syncedLyrics: '[00:01.00] invented line', _slyUri: uri });
    (window as any).slyPreFetchRegistry = { getState: (u: string) => (u === uri ? { title: NEW_TITLE, artist: 'Invented Band', nativeStatus: 'ROMANIZED' } : undefined) };
    const injected: Record<string, unknown>[] = [];
    const onInject = (e: Event) => injected.push((e as CustomEvent).detail.lyricsObj);
    // The takeover itself runs too (setupSlyBridge's listener): its styles are not loaded here.
    if (typeof (window as any).slyGetCoreStyles !== 'function') (window as any).slyGetCoreStyles = () => '';
    document.addEventListener('sly:inject', onInject);
    setBridgeTrack(OLD_ID, OLD_TITLE);
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    expect(injected).toHaveLength(0); // not inside the song change's own resets
    await Promise.resolve();
    expect(injected).toHaveLength(1);
    expect(injected[0]._slyUri).toBe(uri);
    expect(injected[0]._slyEarly).toBe(true);
    expect(injected[0]._slyPrevUri).toBe(`spotify:track:${OLD_ID}`);
    expect(slyInternalState.lastUri).toBe(uri);
    expect(slyInternalState.stagedTakeover ?? null).toBeNull();
    // Spotify's romanized lyrics are not handed back by slyCore's recovery check.
    expect(slyInternalState.forceFallback).toBe(true);
    slyInternalState.forceFallback = false;
    document.removeEventListener('sly:inject', onInject);
    slyInternalState.l0Cache.delete(uri);
    document.documentElement.removeAttribute('data-sly-takeover-uri');
  });

  it('the bridge names a third track by then: nothing is put in early', async () => {
    const key = `Now playing: ${NEW_TITLE} by Invented Band third`;
    const uri = `spotify:track:${NEW_ID}`;
    slyInternalState.l0Cache.set(uri, { syncedLyrics: '[00:01.00] invented line', _slyUri: uri });
    (window as any).slyPreFetchRegistry = { getState: (u: string) => (u === uri ? { title: NEW_TITLE, artist: 'Invented Band', nativeStatus: 'ROMANIZED' } : undefined) };
    const injected: unknown[] = [];
    const onInject = (e: Event) => injected.push(e);
    document.addEventListener('sly:inject', onInject);
    setBridgeTrack(OLD_ID, OLD_TITLE);
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    setBridgeTrack(NEXT_ID, 'Another Invented Song');
    await Promise.resolve();
    expect(injected).toHaveLength(0);
    document.removeEventListener('sly:inject', onInject);
    slyInternalState.l0Cache.delete(uri);
    slyInternalState.stagedTakeover = null;
    document.documentElement.removeAttribute('data-sly-takeover-uri');
  });

  it('the bridge then names another track with that title (not cached): the hold is dropped', () => {
    const key = `Now playing: ${NEW_TITLE} by Invented Band 2`;
    const uri = `spotify:track:${NEW_ID}`;
    slyInternalState.l0Cache.set(uri, { syncedLyrics: '[00:01.00] invented line', _slyUri: uri });
    (window as any).slyPreFetchRegistry = { getState: (u: string) => (u === uri ? { title: NEW_TITLE, artist: 'Invented Band', nativeStatus: 'ROMANIZED' } : undefined) };
    setBridgeTrack(OLD_ID, OLD_TITLE);
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    expect(slyInternalState.stagedTakeover?.uri).toBe(uri);
    setBridgeTrack(NEXT_ID, NEW_TITLE);
    window.dispatchEvent(new CustomEvent('sly_state_update'));
    expect(slyInternalState.stagedTakeover ?? null).toBeNull();
    expect(document.documentElement.hasAttribute('data-sly-takeover-uri')).toBe(false);

    slyInternalState.l0Cache.delete(uri);
  });

  it('two cached tracks with that title: nothing staged', () => {
    const key = `Now playing: ${NEW_TITLE} by Invented Band`;
    const a = `spotify:track:${NEW_ID}`;
    const b = `spotify:track:${NEXT_ID}`;
    slyInternalState.l0Cache.set(a, { syncedLyrics: '[00:01.00] x', _slyUri: a });
    slyInternalState.l0Cache.set(b, { syncedLyrics: '[00:01.00] y', _slyUri: b });
    (window as any).slyPreFetchRegistry = { getState: () => ({ title: NEW_TITLE, artist: 'Invented Band' }) };
    setBridgeTrack(OLD_ID, OLD_TITLE);
    setWidget(NEW_TITLE, key);
    lifecycle.onSongChange(key);
    expect(slyInternalState.stagedTakeover ?? null).toBeNull();
    slyInternalState.l0Cache.delete(a);
    slyInternalState.l0Cache.delete(b);
  });
});
