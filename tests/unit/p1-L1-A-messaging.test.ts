/**
 * Live round 1, group A2.1 / A2.5 / A3 (lib/slyCore/messaging.ts):
 * - the color-lyrics "seen" map is keyed by each message's own track id;
 * - SLY_FETCH_START/END pause and re-poll only for the playing track;
 * - a late Musixmatch success for a prefetched NEXT track keeps it ROMANIZED, so the
 *   Layer-2 fallback arms when that track plays.
 * Synthetic 2026-11 lyrics-panel fixture; all ids and text are invented.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COLOR_LYRICS_SEEN_CAP, isNativeLookupPending, recordColorLyricsSeen, wasColorLyricsSeen,
} from '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import { resetNoRequestClock, resetUnsyncedReportMemo } from '../../lib/slyCore/detector';
import '../../lib/slyCore/messaging';

const NOV_PANEL_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf8');
const CURRENT_ID = 'L1aCurrentTrack0000001';
const NEXT_ID = 'L1aNextTrack0000000001';
const uri = (id: string) => `spotify:track:${id}`;
// Six invented native-script lines: one per word line of the fixture (7 rows, one '♪').
const NATIVE_LINES = Array.from({ length: 6 }, (_, i) => `परीक्षण पंक्ति ${i + 1}`);

const w = window as any;
let logSpy: ReturnType<typeof vi.spyOn>;

function gateway(action: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'SLY_ACTION_GATEWAY', action }, source: window }));
}

function setPlaying(id: string | null): void {
  w.spotifyState.track = id
    ? { uri: uri(id), name: 'Test Song', artists: [{ name: 'Test Artist' }], metadata: { artist_name: 'Test Artist' } }
    : null;
  if (id) w.slyInternalState.lastUri = uri(id);
}

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const doc = new DOMParser().parseFromString(NOV_PANEL_HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  w.slyPreFetchRegistry.states.clear();
  const s = w.slyInternalState;
  Object.assign(s, {
    forceFallback: false, interceptorActive: false, isSpotifyFetching: false, spotifyFetchingTrackId: undefined,
    interceptorReady: true, interceptorFailed: false, currentLyrics: null, pendingLyricsData: null,
    fetchingForTitle: '', isFetchingHUD: false, statusHUDActive: false, songSettlingUntil: 0, panelIntentCooldown: 0,
  });
  s.songChangeTime = Date.now() - 10_000;
  s.panelOpenTime = Date.now() - 5_000;
  s.fetchingForUri.clear();
  s.failedFetchUris.clear();
  s.l0Cache.clear();
  s.nativeLookupPendingUntil.clear();
  s.colorLyricsSeenAt.clear();
  resetNoRequestClock();
  resetUnsyncedReportMemo();
  w.spotifyState.language = 'id';
  w.spotifyState.lyricsProvider = 'MusixMatch';
  w.spotifyState.isTimeSynced = true;
  setPlaying(CURRENT_ID);
  w.slyStartThrottledPoll = vi.fn();
  (globalThis as any).browser.runtime.sendMessage.mockClear();
});

afterEach(() => {
  logSpy.mockRestore();
  delete w.slyStartThrottledPoll;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('color-lyrics seen map (A2.1)', () => {
  it.each([
    'SLY_COLOR_LYRICS_REQUEST', 'SLY_FETCH_START', 'SLY_PREFETCH_REPORT', 'SLY_CANONICAL_HASH', 'SKL_NATIVE_LYRICS',
  ])('%s records its own track id, never the current one', (type) => {
    gateway({ type, trackId: NEXT_ID, state: 'MISSING', canonHash: 'x', nativeLines: [] });
    expect(wasColorLyricsSeen(NEXT_ID)).toBe(true);
    expect(wasColorLyricsSeen(CURRENT_ID)).toBe(false);
  });

  it('other gateway messages (track updates, intercept start) do not mark an id seen', () => {
    gateway({ type: 'SLY_TRACK_UPDATE', payload: { track: { uri: uri(NEXT_ID) } } });
    gateway({ type: 'SLY_FORCE_FALLBACK', trackId: NEXT_ID });
    expect(wasColorLyricsSeen(NEXT_ID)).toBe(false);
  });

  it(`is LRU-capped at ${COLOR_LYRICS_SEEN_CAP} entries`, () => {
    for (let i = 0; i <= COLOR_LYRICS_SEEN_CAP; i++) recordColorLyricsSeen(`id${i}`);
    expect(w.slyInternalState.colorLyricsSeenAt.size).toBe(COLOR_LYRICS_SEEN_CAP);
    expect(wasColorLyricsSeen('id0')).toBe(false);
    expect(wasColorLyricsSeen(`id${COLOR_LYRICS_SEEN_CAP}`)).toBe(true);

    // Re-recording moves an id to the young end.
    recordColorLyricsSeen('id1');
    recordColorLyricsSeen('fresh');
    expect(wasColorLyricsSeen('id1')).toBe(true);
    expect(wasColorLyricsSeen('id2')).toBe(false);
  });

  it('ignores missing or non-string ids', () => {
    recordColorLyricsSeen(undefined);
    recordColorLyricsSeen(42);
    recordColorLyricsSeen('');
    expect(w.slyInternalState.colorLyricsSeenAt.size).toBe(0);
    expect(wasColorLyricsSeen(undefined)).toBe(false);
  });
});

describe('SLY_FETCH_START/END only for the playing track (A2.5)', () => {
  it('the playing track pauses the engine and re-polls on END', () => {
    gateway({ type: 'SLY_FETCH_START', trackId: CURRENT_ID });
    expect(w.slyInternalState.isSpotifyFetching).toBe(true);
    gateway({ type: 'SLY_FETCH_END', trackId: CURRENT_ID });
    expect(w.slyInternalState.isSpotifyFetching).toBe(false);
    expect(w.slyStartThrottledPoll).toHaveBeenCalledTimes(1);
  });

  it('a next-track prefetch neither pauses the engine nor re-polls', () => {
    gateway({ type: 'SLY_FETCH_START', trackId: NEXT_ID });
    expect(w.slyInternalState.isSpotifyFetching).toBe(false);
    gateway({ type: 'SLY_FETCH_END', trackId: NEXT_ID });
    expect(w.slyStartThrottledPoll).not.toHaveBeenCalled();
  });

  it("another track's END does not clear the playing track's flag", () => {
    gateway({ type: 'SLY_FETCH_START', trackId: CURRENT_ID });
    gateway({ type: 'SLY_FETCH_END', trackId: NEXT_ID });
    expect(w.slyInternalState.isSpotifyFetching).toBe(true);
    expect(w.slyStartThrottledPoll).not.toHaveBeenCalled();
  });

  it('an unknown playing id counts as the current track', () => {
    setPlaying(null);
    gateway({ type: 'SLY_FETCH_START', trackId: NEXT_ID });
    expect(w.slyInternalState.isSpotifyFetching).toBe(true);
    gateway({ type: 'SLY_FETCH_END', trackId: NEXT_ID });
    expect(w.slyInternalState.isSpotifyFetching).toBe(false);
  });

  it('the END of the request that set the flag clears it even after a skip', () => {
    gateway({ type: 'SLY_FETCH_START', trackId: CURRENT_ID });
    setPlaying(NEXT_ID);
    gateway({ type: 'SLY_FETCH_END', trackId: CURRENT_ID });
    expect(w.slyInternalState.isSpotifyFetching).toBe(false);
    expect(w.slyStartThrottledPoll).toHaveBeenCalledTimes(1);
  });
});

describe('late Musixmatch success for a prefetched NEXT track (A3)', () => {
  /** Next-track prefetch whose 4000ms hold expired before Musixmatch answered. */
  function prefetchNextWithBudgetExpiry(): void {
    gateway({ type: 'SLY_COLOR_LYRICS_REQUEST', trackId: NEXT_ID });
    gateway({ type: 'SLY_FETCH_START', trackId: NEXT_ID });
    gateway({ type: 'SLY_PREFETCH_REPORT', trackId: NEXT_ID, state: 'ROMANIZED', romanizedLang: 'hi' });
    gateway({ type: 'SLY_INTERCEPT_START', trackId: NEXT_ID });
    gateway({ type: 'SLY_INTERCEPT_END', trackId: NEXT_ID });
    gateway({ type: 'SLY_FETCH_END', trackId: NEXT_ID });
  }
  const lateSuccess = (trackId: string) => gateway({
    type: 'SKL_NATIVE_LYRICS', trackId, nativeLines: NATIVE_LINES, isRomanizedUpgrade: true,
    late: true, spotifyLineCount: 7, spotifyWordLineCount: NATIVE_LINES.length,
  });

  it('keeps the registry ROMANIZED, and forceFallback arms when the track plays', async () => {
    prefetchNextWithBudgetExpiry();
    expect(isNativeLookupPending(NEXT_ID)).toBe(true);

    lateSuccess(NEXT_ID);
    expect(isNativeLookupPending(NEXT_ID)).toBe(false);
    expect(w.slyPreFetchRegistry.getState(uri(NEXT_ID))?.nativeStatus).toBe('ROMANIZED');
    expect(w.slyInternalState.nativeUpgradedLines).not.toEqual(NATIVE_LINES);
    expect(logSpy.mock.calls.some((c: any[]) => String(c[0]).includes('Late native lyrics for non-current track'))).toBe(true);

    // The NEXT track starts playing from Spotify's cached romanized response.
    setPlaying(NEXT_ID);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(uri(NEXT_ID))?.nativeStatus).toBe('ROMANIZED');
  });

  it('control: a late success for the playing track still registers NATIVE_OK', () => {
    setPlaying(NEXT_ID);
    prefetchNextWithBudgetExpiry();
    lateSuccess(NEXT_ID);
    expect(w.slyPreFetchRegistry.getState(uri(NEXT_ID))?.nativeStatus).toBe('NATIVE_OK');
  });

  it('control: with no known playing track the late success is treated as current', () => {
    setPlaying(null);
    prefetchNextWithBudgetExpiry();
    lateSuccess(NEXT_ID);
    expect(w.slyPreFetchRegistry.getState(uri(NEXT_ID))?.nativeStatus).toBe('NATIVE_OK');
  });
});
