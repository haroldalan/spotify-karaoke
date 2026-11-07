/**
 * Group B2 (phase 1): K5 Layer-1 (Musixmatch native-script) result tracking.
 * On a hold-budget expiry the interceptor posts SLY_INTERCEPT_END and keeps the lookup
 * running; it ends later with SKL_NATIVE_LYRICS (late) or SLY_FORCE_FALLBACK. Until then
 * the detector must not arm the Layer-2 fallback from a ROMANIZED registry entry or the
 * forensic scan. Runs on the synthetic 2026 lyrics-panel fixture (invented text only).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { clearNativeLookupPending, isNativeLookupPending, markNativeLookupPending, NATIVE_LOOKUP_PENDING_MS } from '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import '../../lib/slyCore/detector';
import '../../lib/slyCore/messaging';

const FIXTURE_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf8');
const TRACK_ID = '4UMIv5jd9gK98a39BQRD9X';
const URI = `spotify:track:${TRACK_ID}`;
const OTHER_ID = '0000000000000000000Oth';
// Seven invented native-script lines, one per full-panel line of the fixture.
const NATIVE_LINES = Array.from({ length: 7 }, (_, i) => `परीक्षण पंक्ति ${i + 1}`);

const w = window as any;

function loadFixture(): void {
  const doc = new DOMParser().parseFromString(FIXTURE_HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
}

function postGateway(action: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: { source: 'SLY_ACTION_GATEWAY', action },
    source: window,
  }));
}

/** What the interceptor posts when the 4000ms budget expires before Musixmatch answers. */
function postBudgetExpiry(trackId = TRACK_ID): void {
  postGateway({ type: 'SLY_FETCH_START', trackId });
  postGateway({ type: 'SLY_PREFETCH_REPORT', trackId, state: 'ROMANIZED', romanizedLang: 'hi' });
  postGateway({ type: 'SLY_INTERCEPT_START', trackId });
  postGateway({ type: 'SLY_INTERCEPT_END', trackId });
  postGateway({ type: 'SLY_FETCH_END', trackId });
}

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  loadFixture();
  w.slyPreFetchRegistry.states.clear();
  const s = w.slyInternalState;
  s.lastUri = URI;
  s.forceFallback = false;
  s.interceptorActive = false;
  s.isSpotifyFetching = false;
  s.isFetchingHUD = false;
  s.statusHUDActive = false;
  s.currentLyrics = null;
  s.pendingLyricsData = null;
  s.fetchingForTitle = '';
  s.fetchingForUri.clear();
  s.failedFetchUris.clear();
  s.l0Cache.clear();
  s.nativeLookupPendingUntil.clear();
  s.songSettlingUntil = 0;
  s.songChangeTime = Date.now() - 10_000;
  s.panelIntentCooldown = 0;
  s.panelOpenTime = Date.now() - 5_000; // past the forensic scan's 1000ms grace
  w.spotifyState.track = { uri: URI, name: 'Test Song', artists: [{ name: 'Test Artist' }], metadata: { artist_name: 'Test Artist' } };
  w.spotifyState.language = 'id';
  w.spotifyState.lyricsProvider = 'MusixMatch';
  w.spotifyState.isTimeSynced = true;
  (globalThis as any).browser.runtime.sendMessage.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Layer-1 pending across a hold-budget expiry (K5)', () => {
  it('INTERCEPT_END alone does not end the pending state or arm the fallback', async () => {
    postBudgetExpiry();
    expect(w.slyInternalState.interceptorActive).toBe(false);
    expect(isNativeLookupPending(TRACK_ID)).toBe(true);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');

    const detection = await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
    // Spotify's lines are not final yet: no SYNCED verdict from them either.
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
    const reported = (globalThis as any).browser.runtime.sendMessage.mock.calls.map((c: any[]) => c[0]?.payload?.status);
    expect(reported).not.toContain('SYNCED');
    expect(detection.lyricsState).not.toContain('ROMANIZED');
  });

  it('a delayed late SKL_NATIVE_LYRICS ends the pending state and the fallback is never armed', async () => {
    postBudgetExpiry();
    await w.slyDetectNativeState();
    vi.setSystemTime(Date.now() + 3000);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);

    postGateway({
      type: 'SKL_NATIVE_LYRICS', trackId: TRACK_ID, nativeLines: NATIVE_LINES,
      isRomanizedUpgrade: true, late: true, spotifyLineCount: NATIVE_LINES.length,
    });
    expect(isNativeLookupPending(TRACK_ID)).toBe(false);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('NATIVE_OK');
    expect(w.slyInternalState.nativeUpgradedLines).toEqual(NATIVE_LINES);

    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
  });

  it('a delayed SLY_FORCE_FALLBACK ends the pending state and arms the fallback', async () => {
    postBudgetExpiry();
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);

    vi.setSystemTime(Date.now() + 3000);
    postGateway({ type: 'SLY_FORCE_FALLBACK', trackId: TRACK_ID });
    expect(isNativeLookupPending(TRACK_ID)).toBe(false);
    expect(w.slyInternalState.forceFallback).toBe(true);

    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
  });

  it('a lookup that never reports back expires, then the registry ROMANIZED arms the fallback', async () => {
    postBudgetExpiry();
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);

    vi.setSystemTime(Date.now() + NATIVE_LOOKUP_PENDING_MS + 1);
    expect(isNativeLookupPending(TRACK_ID)).toBe(false);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
  });

  it('the ROMANIZED report alone marks the result pending (it precedes SLY_INTERCEPT_START)', async () => {
    postGateway({ type: 'SLY_PREFETCH_REPORT', trackId: TRACK_ID, state: 'ROMANIZED', romanizedLang: 'hi' });
    expect(isNativeLookupPending(TRACK_ID)).toBe(true);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
  });

  it('the forensic scan also waits for a pending Layer-1 result', async () => {
    // Registry empty (e.g. the report was missed) but a lookup is known to be running.
    markNativeLookupPending(TRACK_ID);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBeUndefined();
  });

  it('pending is tracked per track: another track\'s lookup does not hold this one back', async () => {
    postBudgetExpiry(OTHER_ID);
    w.slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', nativeStatus: 'ROMANIZED' });
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
  });

  it('ignores a late SLY_FORCE_FALLBACK for a track that is no longer playing', () => {
    markNativeLookupPending(OTHER_ID);
    postGateway({ type: 'SLY_FORCE_FALLBACK', trackId: OTHER_ID });
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(isNativeLookupPending(OTHER_ID)).toBe(false);
  });

  it('late native lines release an already armed fallback: HUD flags, in-flight marker and takeover', () => {
    // The pending window expired and Pipeline A started a fetch with its HUD.
    w.slyInternalState.forceFallback = true;
    w.slyInternalState.isFetchingHUD = true;
    w.slyInternalState.statusHUDActive = true;
    w.slyInternalState.fetchingForTitle = 'Test Song';
    w.slyInternalState.fetchingForUri.add(URI);
    // The real sly:panel_close handler ignores closes while a HUD flag is still set
    // (its track-skip flicker guard), so record the flags it would see.
    const hudFlagsAtClose: boolean[][] = [];
    const panelClose = () => {
      hudFlagsAtClose.push([w.slyInternalState.isFetchingHUD, w.slyInternalState.statusHUDActive]);
    };
    document.addEventListener('sly:panel_close', panelClose);

    postGateway({
      type: 'SKL_NATIVE_LYRICS', trackId: TRACK_ID, nativeLines: NATIVE_LINES,
      isRomanizedUpgrade: true, late: true, spotifyLineCount: NATIVE_LINES.length,
    });
    document.removeEventListener('sly:panel_close', panelClose);

    expect(hudFlagsAtClose).toEqual([[false, false]]);
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyInternalState.fetchingForUri.has(URI)).toBe(false);
    expect(w.slyInternalState.fetchingForTitle).toBe('');
  });
});

describe('clearNativeLookupPending result', () => {
  it('returns true only while the lookup is still pending', () => {
    markNativeLookupPending(TRACK_ID);
    expect(clearNativeLookupPending(TRACK_ID)).toBe(true);
    expect(clearNativeLookupPending(TRACK_ID)).toBe(false); // already cleared

    markNativeLookupPending(TRACK_ID);
    vi.setSystemTime(Date.now() + NATIVE_LOOKUP_PENDING_MS + 1);
    expect(clearNativeLookupPending(TRACK_ID)).toBe(false); // expired
    expect(w.slyInternalState.nativeLookupPendingUntil.has(TRACK_ID)).toBe(false);

    expect(clearNativeLookupPending(undefined)).toBe(false);
  });
});

describe('late native result after the pending window, with a Layer-2 takeover on screen (review C6)', () => {
  /** Pipeline A takeover with lines: root in the DOM, currentLyrics.lines filled by slyBuildLyricsList. */
  function showTakeoverWithLines(): HTMLElement {
    const root = document.createElement('div');
    root.id = 'lyrics-root-sync';
    const line = document.createElement('div');
    line.setAttribute('data-testid', 'lyrics-line');
    line.textContent = 'Invented fallback line';
    root.appendChild(line);
    document.body.appendChild(root);
    w.slyInternalState.currentLyrics = { lines: [{ time: 0, text: 'Invented fallback line' }], _slyUri: URI };
    return root;
  }

  const lateNative = () => postGateway({
    type: 'SKL_NATIVE_LYRICS', trackId: TRACK_ID, nativeLines: NATIVE_LINES, isRomanizedUpgrade: true,
    late: true, spotifyLineCount: NATIVE_LINES.length, spotifyWordLineCount: NATIVE_LINES.length,
  });

  const keepLogs = () => (console.log as any).mock.calls
    .filter((c: unknown[]) => String(c[0]).includes('keeping the Layer-2 takeover')).length;

  it('keeps the takeover: no NATIVE_OK, forceFallback stays armed, no sly:panel_close, one log', () => {
    postBudgetExpiry();
    vi.setSystemTime(Date.now() + NATIVE_LOOKUP_PENDING_MS + 1);
    w.slyInternalState.forceFallback = true; // the registry ROMANIZED branch armed it
    const root = showTakeoverWithLines();
    const takeover = w.slyInternalState.currentLyrics;
    const panelClose = vi.fn();
    document.addEventListener('sly:panel_close', panelClose);
    const logsBefore = keepLogs();

    lateNative();
    document.removeEventListener('sly:panel_close', panelClose);

    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(panelClose).not.toHaveBeenCalled();
    expect(root.isConnected).toBe(true);
    expect(w.slyInternalState.currentLyrics).toBe(takeover);
    expect(keepLogs() - logsBefore).toBe(1);
  });

  it('keeps the takeover when its lines are rendered but currentLyrics has no .lines (re-inject clone)', () => {
    // content.ts step 6 re-dispatches sly:inject with a clone while Pipeline B still awaits
    // storage; Pipeline B drops the clone (setupLock) and fills .lines on the first object only.
    postBudgetExpiry();
    vi.setSystemTime(Date.now() + NATIVE_LOOKUP_PENDING_MS + 1);
    w.slyInternalState.forceFallback = true;
    const root = showTakeoverWithLines();
    w.slyInternalState.currentLyrics = { plainLyrics: 'Invented fallback line', _slyUri: URI };
    const panelClose = vi.fn();
    document.addEventListener('sly:panel_close', panelClose);

    lateNative();
    document.removeEventListener('sly:panel_close', panelClose);

    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(panelClose).not.toHaveBeenCalled();
    expect(root.isConnected).toBe(true);
  });

  it('a stale takeover root left over from another track does not hold back this track\'s late result', () => {
    postBudgetExpiry();
    vi.setSystemTime(Date.now() + NATIVE_LOOKUP_PENDING_MS + 1);
    w.slyInternalState.forceFallback = true;
    showTakeoverWithLines();
    w.slyInternalState.currentLyrics = { lines: [{ time: 0, text: 'Invented fallback line' }], _slyUri: `spotify:track:${OTHER_ID}` };

    lateNative();

    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('NATIVE_OK');
    expect(w.slyInternalState.forceFallback).toBe(false);
  });

  it('a late result inside the pending window still releases the takeover', () => {
    postBudgetExpiry();
    vi.setSystemTime(Date.now() + 3000);
    w.slyInternalState.forceFallback = true;
    showTakeoverWithLines();
    const panelClose = vi.fn();
    document.addEventListener('sly:panel_close', panelClose);

    lateNative();
    document.removeEventListener('sly:panel_close', panelClose);

    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('NATIVE_OK');
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(panelClose).toHaveBeenCalledTimes(1);
  });
});
