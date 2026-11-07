/**
 * Review fixes, group F1:
 * - C1: the BUG-10 500 ms retry in syncSetup must not force a second switch while
 *   the first one is still waiting for PROCESS (a cold song change sends PROCESS once).
 * - S1/S4: a Romanized/Translated request refused while the interceptor is in flight
 *   (BUG-4 guard, or the empty-cache rollback) is remembered and replayed on
 *   'sly:interceptor_settled'; the preferredMode fallback still runs otherwise.
 *
 * Uses the synthetic 2026-11 lyrics panel fixture (invented romanized-Hindi text).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModeController } from '../../lib/core/modeController';
import { createLifecycleController, setupSlyBridge } from '../../lib/core/lifecycleController';
import { StateStore } from '../../lib/core/store';
import { getLyricsLines } from '../../lib/dom/domQueries';
import { slyInternalState, spotifyState } from '../../lib/slyCore/state';

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf-8');
const SONG_KEY = 'Now playing: Test Song by Test Artist, Second Artist';

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const screenLines = () => getLyricsLines().map(el => el.getAttribute('data-sly-original') ?? el.textContent ?? '');
const translatedResponse = () => ({ translated: screenLines().map(l => `EN ${l}`), romanized: screenLines() });

// One store, controller and bridge for the whole file: setupSlyBridge adds
// document listeners that cannot be removed, so it must be wired exactly once.
const store = new StateStore();
let mc: ReturnType<typeof createModeController>;
let lifecycle: ReturnType<typeof createLifecycleController>;
let sendMessage: ReturnType<typeof vi.fn>;
let pendingProcess: Array<(v: unknown) => void> = [];
const processCalls = () => sendMessage.mock.calls.filter(c => (c[0] as any)?.type === 'PROCESS').length;

beforeAll(() => {
  mc = createModeController({ store });
  lifecycle = createLifecycleController({
    store,
    switchMode: mc.switchMode,
    reapplyMode: mc.reapplyMode,
    autoSwitchIfNeeded: mc.autoSwitchIfNeeded,
  });
  setupSlyBridge(store, mc.switchMode, mc.autoSwitchIfNeeded, () => {});
});

beforeEach(() => {
  // Fake timers everywhere: the BUG-10 retry and the 400 ms settle re-check must
  // not leak into the next test.
  vi.useFakeTimers();
  loadFixture();
  for (const m of ['log', 'warn', 'table', 'groupCollapsed', 'groupEnd', 'error', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  sessionStorage.clear(); // saveSongCache's session copy would turn the next song change hot
  Object.assign(store, new StateStore());
  store.songKey = SONG_KEY;
  store.currentActiveLang = 'en';
  mc.resetFailureMemory();
  (window as any).browser.runtime.id = 'test-id';
  pendingProcess = [];
  // PROCESS stays in flight until the test resolves it.
  sendMessage = vi.fn((msg: any) => msg?.type === 'PROCESS'
    ? new Promise(r => { pendingProcess.push(r); })
    : Promise.resolve(undefined));
  (window as any).browser.runtime.sendMessage = sendMessage;
  // Romanized Hindi tagged "id" (see tests/fixtures/color-lyrics-romanized-hindi.json).
  spotifyState.language = 'id';
  spotifyState.track = null;
  slyInternalState.interceptorActive = false;
  slyInternalState.isTransitioning = false;
  slyInternalState.currentLyrics = null;
  slyInternalState.pendingLyricsData = null;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  spotifyState.language = null;
  slyInternalState.interceptorActive = false;
});

describe('p1-R-F1 C1: BUG-10 retry during a cold song change', () => {
  it('sends PROCESS exactly once when the 500 ms retry fires while the first switch is in flight', async () => {
    store.songKey = 'Now playing: Previous Song by Someone Else';
    store.preferredMode = 'translated';

    await lifecycle.syncSetup(); // detects the new key → onSongChange (cold, 1.5 s transition window)
    await flush();
    expect(store.songKey).toBe(SONG_KEY);
    expect(processCalls()).toBe(1);
    expect(store.isSwitchingMode).toBe(true);

    await vi.advanceTimersByTimeAsync(600); // past the BUG-10 retry
    expect(processCalls()).toBe(1);

    pendingProcess[0](translatedResponse());
    await vi.advanceTimersByTimeAsync(100);
    expect(store.mode).toBe('translated');
    expect(store.isSwitchingMode).toBe(false);
    expect(processCalls()).toBe(1);
  });

  it('still re-evaluates the preferred mode at the retry when no switch is running', async () => {
    store.songKey = 'Now playing: Previous Song by Someone Else';
    store.preferredMode = 'translated';
    sendMessage.mockImplementation((msg: any) => Promise.resolve(msg?.type === 'PROCESS' ? null : undefined));

    await lifecycle.syncSetup();
    await flush();
    expect(processCalls()).toBe(1); // failed → rolled back to Original
    expect(store.mode).toBe('original');
    expect(store.isSwitchingMode).toBe(false);

    sendMessage.mockImplementation((msg: any) => Promise.resolve(msg?.type === 'PROCESS' ? translatedResponse() : undefined));
    await vi.advanceTimersByTimeAsync(600);
    // The unforced re-evaluation respects the failure backoff: no request loop.
    expect(processCalls()).toBe(1);
  });

  it('a song change drops a request deferred for the previous song', () => {
    slyInternalState.interceptorActive = true;
    store.pendingUserSwitch = { mode: 'translated', lang: 'en', songKey: SONG_KEY };
    lifecycle.onSongChange('Now playing: Another Song by Someone Else');
    expect(store.pendingUserSwitch).toBeNull();
  });
});

describe('p1-R-F1 S1/S4: deferral while the interceptor is in flight', () => {
  const fillLatinOriginals = () => { store.cache.original = getLyricsLines().map(el => el.textContent ?? ''); };

  it('defers Translated on Latin rows of a non-Latin song: no PROCESS, mode stays Original, request remembered', async () => {
    fillLatinOriginals(); // hot-cache replay: the guard in switchMode (not the snapshot guard) decides
    slyInternalState.interceptorActive = true;

    await mc.switchMode('translated', 'en');

    expect(store.mode).toBe('original');
    expect(store.isSwitchingMode).toBe(false);
    expect(processCalls()).toBe(0);
    expect(store.pendingUserSwitch).toEqual({ mode: 'translated', lang: 'en', songKey: SONG_KEY });
  });

  it('remembers a request refused by the empty-cache rollback while the interceptor is in flight', async () => {
    slyInternalState.interceptorActive = true; // snapshotOriginals refuses the Latin rows

    await mc.switchMode('romanized');

    expect(store.cache.original).toEqual([]);
    expect(store.mode).toBe('original');
    expect(processCalls()).toBe(0);
    expect(store.pendingUserSwitch).toEqual({ mode: 'romanized', lang: undefined, songKey: SONG_KEY });
  });

  it('replays the deferred request on sly:interceptor_settled even when preferredMode is Original', async () => {
    fillLatinOriginals();
    slyInternalState.interceptorActive = true;
    await mc.switchMode('translated', 'en');
    expect(processCalls()).toBe(0);

    slyInternalState.interceptorActive = false;
    document.dispatchEvent(new CustomEvent('sly:interceptor_settled'));
    await flush();

    expect(processCalls()).toBe(1);
    expect(store.pendingUserSwitch).toBeNull();
    await vi.advanceTimersByTimeAsync(500); // the 400 ms re-check must not send it again
    expect(processCalls()).toBe(1);
    pendingProcess[0](translatedResponse());
    await flush();
    expect(store.mode).toBe('translated');
    expect(store.preferredMode).toBe('translated');
  });

  it('replays the clicked mode, not preferredMode, even after an automatic switch was deferred too', async () => {
    store.preferredMode = 'romanized';
    fillLatinOriginals();
    slyInternalState.interceptorActive = true;
    await mc.switchMode('translated', 'en'); // user click
    mc.autoSwitchIfNeeded(); // a NATIVE_OK tick / syncSetup during the hold
    await flush();
    expect(processCalls()).toBe(0);
    expect(store.pendingUserSwitch?.mode).toBe('translated');

    slyInternalState.interceptorActive = false;
    document.dispatchEvent(new CustomEvent('sly:interceptor_settled'));
    await flush();

    expect(processCalls()).toBe(1);
    expect(store.mode).toBe('translated');
  });

  it('a later click on the painted mode cancels the deferred request', async () => {
    fillLatinOriginals();
    slyInternalState.interceptorActive = true;
    await mc.switchMode('translated', 'en');
    await mc.switchMode('original'); // already painted: no-op, but it is the newest request
    expect(store.pendingUserSwitch).toBeNull();

    slyInternalState.interceptorActive = false;
    document.dispatchEvent(new CustomEvent('sly:interceptor_settled'));
    await flush();
    expect(processCalls()).toBe(0);
    expect(store.mode).toBe('original');
  });

  it('does not replay a request deferred for another song', async () => {
    fillLatinOriginals();
    slyInternalState.interceptorActive = true;
    await mc.switchMode('translated', 'en');
    store.songKey = 'Now playing: Another Song by Someone Else';

    slyInternalState.interceptorActive = false;
    document.dispatchEvent(new CustomEvent('sly:interceptor_settled'));
    await flush();
    expect(processCalls()).toBe(0);
    expect(store.pendingUserSwitch).toBeNull();
  });

  it('falls back to resuming preferredMode on sly:interceptor_settled when nothing was clicked', async () => {
    store.preferredMode = 'translated';
    fillLatinOriginals();
    slyInternalState.interceptorActive = true;
    mc.autoSwitchIfNeeded();
    await flush();
    expect(processCalls()).toBe(0);
    expect(store.pendingUserSwitch).toBeNull(); // automatic switches are covered by the fallback

    slyInternalState.interceptorActive = false;
    document.dispatchEvent(new CustomEvent('sly:interceptor_settled'));
    await flush();

    expect(processCalls()).toBe(1);
    pendingProcess[0](translatedResponse());
    await flush();
    expect(store.mode).toBe('translated');
  });

  it('does nothing on sly:interceptor_settled while a new intercept is already running', async () => {
    fillLatinOriginals();
    slyInternalState.interceptorActive = true;
    await mc.switchMode('translated', 'en');

    document.dispatchEvent(new CustomEvent('sly:interceptor_settled')); // still active
    await flush();
    expect(processCalls()).toBe(0);
    expect(store.pendingUserSwitch?.mode).toBe('translated');
  });
});
