/**
 * Live round 1, group A2.2-A2.4 through content.ts: the no-request MISSING verdict makes
 * the STANDBY gate fetch exactly once, FetchEngine does not forward the heuristic MISSING
 * to the background, and a stale stand-down decision no longer keeps the poll at 5 s.
 * Synthetic 2026-11 lyrics-panel fixture; all ids and text are invented.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NOV_PANEL_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf8');
const TRACK_ID = 'L1aContentTrack0000001';
const URI = `spotify:track:${TRACK_ID}`;
const w = window as any;
const sendMessage = () => (globalThis as any).browser.runtime.sendMessage;

let resetNoRequestClock: () => void;

function loadOverlayWithoutRows(): void {
  const doc = new DOMParser().parseFromString(NOV_PANEL_HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  document.querySelectorAll('[data-testid="lyrics-line"]').forEach(el => el.remove());
}

const fetchCalls = () => sendMessage().mock.calls.map((c: any[]) => c[0]).filter((m: any) => m?.type === 'FETCH_LYRICS');

beforeAll(async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  sessionStorage.clear();
  await import('../../lib/slyCore/state');
  await import('../../lib/slyCore/preFetch');
  await import('../../lib/slyCore/styles');
  await import('../../lib/slyCore/scavenger');
  ({ resetNoRequestClock } = await import('../../lib/slyCore/detector'));
  await import('../../lib/slyCore/domEngine');
  await import('../../lib/slyCore/messaging');
  await import('../../lib/slyCore/content');
  await vi.advanceTimersByTimeAsync(0);
  // Stop the 500ms poll: the tests drive slyCheckNowPlaying themselves.
  clearTimeout(w.antigravityInterval);
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  loadOverlayWithoutRows();
  w.slyPreFetchRegistry.states.clear();
  const s = w.slyInternalState;
  Object.assign(s, {
    lastUri: URI, isTransitioning: false, interceptorActive: false, isSpotifyFetching: false,
    interceptorReady: true, interceptorFailed: false, forceFallback: false, currentLyrics: null,
    pendingLyricsData: null, fetchingForTitle: '', panelIntentCooldown: 0, songSettlingUntil: 0,
    isFetchingHUD: false, statusHUDActive: false, lastDecision: '',
  });
  s.songChangeTime = Date.now() - 10_000;
  s.panelOpenTime = Date.now() - 10_000;
  s.fetchingForUri.clear();
  s.failedFetchUris.clear();
  s.l0Cache.clear();
  s.nativeLookupPendingUntil.clear();
  s.colorLyricsSeenAt.clear();
  resetNoRequestClock();
  w.spotifyState.track = { uri: URI, name: 'Test Song', artists: [{ name: 'Test Artist' }], metadata: { artist_name: 'Test Artist' } };
  w.spotifyState.isTimeSynced = undefined;
  w.spotifyState.lyricsProvider = null;
  sendMessage().mockClear();
});

describe('no-lyrics fallback through the content gate (A2.2/A2.3)', () => {
  it('fetches exactly once, without forwarding the heuristic MISSING', async () => {
    // Background never answers within the test: the fetch stays in flight.
    sendMessage().mockImplementation(() => new Promise(() => {}));
    try {
      for (let t = 0; t <= 6000; t += 500) {
        await w.slyCheckNowPlaying();
        await vi.advanceTimersByTimeAsync(500);
      }
      const calls = fetchCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].payload.uri).toBe(URI);
      expect(calls[0].payload.nativeStatus).toBeUndefined();
      expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('MISSING');
      expect(w.slyInternalState.forceFallback).toBe(true);
      expect(sendMessage().mock.calls.filter((c: any[]) => c[0]?.type === 'SLY_REPORT_NATIVE_STATUS')).toHaveLength(0);
    } finally {
      sendMessage().mockReset();
      sendMessage().mockResolvedValue(undefined);
    }
  });

  it('a real (non-heuristic) native status is still forwarded to the background', async () => {
    sendMessage().mockImplementation(() => new Promise(() => {}));
    try {
      w.slyPreFetchRegistry.register(URI, 'MISSING', { source: 'native', reason: 'Network Intercept (404)' });
      await w.slyCheckNowPlaying();
      const calls = fetchCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].payload.nativeStatus).toBe('MISSING');
    } finally {
      sendMessage().mockReset();
      sendMessage().mockResolvedValue(undefined);
    }
  });
});

describe('stand-down decision reset (A2.4)', () => {
  it('clears a "synced_or_ok:" decision once the resolution is no longer NATIVE_ORIGINAL', async () => {
    w.slyInternalState.lastDecision = 'synced_or_ok:Test Song';
    await w.slyCheckNowPlaying(); // no rows, nothing known: STANDBY | LOADING
    expect(w.slyInternalState.lastDecision).toBe('');
  });
});
