/**
 * Live round 1, group A2.1/A2.2: a track Spotify has no lyrics for (no color-lyrics
 * request at all) gets a local, heuristic MISSING verdict once the overlay has been open
 * on it for 4 s, evaluated before every other branch of the decision matrix.
 * Synthetic 2026-11 lyrics-panel fixture; all ids and text are invented.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordColorLyricsSeen, wasColorLyricsSeen } from '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import { resetNoRequestClock, resetUnsyncedReportMemo, NO_REQUEST_MISSING_MS } from '../../lib/slyCore/detector';
import '../../lib/slyCore/messaging';

const NOV_PANEL_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf8');

const TRACK_ID = 'L1aNoLyricsTrack000001';
const URI = `spotify:track:${TRACK_ID}`;
const OTHER_ID = 'L1aOtherTrack000000001';
const OTHER_URI = `spotify:track:${OTHER_ID}`;
const ENGLISH_LINES = [
  'Lanterns drift across the harbour after dark',
  'The ferry hums a tune we used to know',
  'Count the stars until the morning comes',
];

const w = window as any;
let logSpy: ReturnType<typeof vi.spyOn>;

function loadOverlayWithoutRows(): void {
  const doc = new DOMParser().parseFromString(NOV_PANEL_HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  document.querySelectorAll('[data-testid="lyrics-line"]').forEach(el => el.remove());
}

function setTrack(uri: string, isTimeSynced?: boolean): void {
  w.spotifyState.track = { uri, name: 'Test Song', artists: [{ name: 'Test Artist' }], metadata: { artist_name: 'Test Artist' } };
  w.spotifyState.isTimeSynced = isTimeSynced;
  w.spotifyState.lyricsProvider = null;
  w.spotifyState.language = null;
  w.slyInternalState.lastUri = uri;
}

function setLyricsButtonActive(active: boolean): void {
  const btn = document.querySelector('[data-testid="lyrics-button"]')!;
  btn.setAttribute('data-active', String(active));
  btn.setAttribute('aria-pressed', String(active));
}

function gateway(action: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'SLY_ACTION_GATEWAY', action }, source: window }));
}

const detect = () => w.slyDetectNativeState();
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
const nativeReports = () => (globalThis as any).browser.runtime.sendMessage.mock.calls
  .filter((c: any[]) => c[0]?.type === 'SLY_REPORT_NATIVE_STATUS');

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  loadOverlayWithoutRows();
  w.slyPreFetchRegistry.states.clear();
  const s = w.slyInternalState;
  s.forceFallback = false;
  s.interceptorActive = false;
  s.isSpotifyFetching = false;
  s.spotifyFetchingTrackId = undefined;
  s.interceptorReady = true;
  s.interceptorFailed = false;
  s.failedFetchUris.clear();
  s.l0Cache.clear();
  s.nativeLookupPendingUntil.clear();
  s.colorLyricsSeenAt.clear();
  s.songSettlingUntil = 0;
  s.songChangeTime = Date.now() - 10_000;
  s.panelIntentCooldown = 0;
  s.panelOpenTime = Date.now() - 10_000;
  resetNoRequestClock();
  resetUnsyncedReportMemo();
  setTrack(URI);
  (globalThis as any).browser.runtime.sendMessage.mockClear();
});

afterEach(() => {
  logSpy.mockRestore();
  vi.useRealTimers();
});

describe('no color-lyrics request MISSING verdict (A2.2)', () => {
  it('no rows + unseen id: LOADING at 3.9 s, MISSING_NO_REQUEST at 4.1 s, never reported', async () => {
    expect(NO_REQUEST_MISSING_MS).toBe(4000);
    expect((await detect()).lyricsState).toBe('LOADING');
    advance(3900);
    expect((await detect()).lyricsState).toBe('LOADING');
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();

    advance(200);
    const state = await detect();
    expect(state.lyricsState).toBe('MISSING_NO_REQUEST');
    expect(state.preFetch?.nativeStatus).toBe('MISSING');
    const entry = w.slyPreFetchRegistry.getState(URI);
    expect(entry?.nativeStatus).toBe('MISSING');
    expect(entry?.heuristic).toBe(true);
    expect(entry?.nativeReason).toBe('No color-lyrics request (4s)');
    expect(nativeReports()).toHaveLength(0);

    // Next pass: the registry MISSING arms the fallback (PERSISTED_NATIVE_MISSING) and nothing re-registers.
    logSpy.mockClear();
    advance(500);
    const next = await detect();
    expect(next.lyricsState).toBe('PERSISTED_NATIVE_MISSING');
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(logSpy.mock.calls.filter((c: any[]) => String(c[0]).startsWith('[sly-prefetch] Merged'))).toHaveLength(0);
    expect(nativeReports()).toHaveLength(0);
  });

  it('Spotify\'s disabled lyrics option (overlay shows artwork) is enough after 1 s, request seen or not (live round 2)', async () => {
    const option = document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]');
    expect(option).not.toBeNull();
    option!.disabled = true;
    recordColorLyricsSeen(TRACK_ID); // e.g. a 404 request Spotify made anyway
    await detect();
    advance(900);
    expect((await detect()).lyricsState).not.toBe('MISSING_NO_REQUEST');
    advance(200);
    const state = await detect();
    expect(state.lyricsState).toBe('MISSING_NO_REQUEST');
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeReason).toBe("Spotify's lyrics option disabled");
    expect(nativeReports()).toHaveLength(0);
  });

  it('fires even when the bridge still says isTimeSynced true (evaluated before isNativeSynced)', async () => {
    setTrack(URI, true);
    await detect();
    advance(3900);
    const before = await detect();
    expect(before.lyricsState).not.toContain('MISSING');
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();

    advance(200);
    expect((await detect()).lyricsState).toBe('MISSING_NO_REQUEST');
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('MISSING');
  });

  it('the clock starts at the track change, not at an old songChangeTime / panelOpenTime (Pipeline-B-first switch)', async () => {
    setTrack(OTHER_URI);
    recordColorLyricsSeen(OTHER_ID);
    await detect();
    advance(6000);
    await detect();

    setTrack(URI); // songChangeTime and panelOpenTime stay old
    expect((await detect()).lyricsState).toBe('LOADING');
    advance(3000);
    expect((await detect()).lyricsState).toBe('LOADING');
    advance(1100);
    expect((await detect()).lyricsState).toBe('MISSING_NO_REQUEST');
  });

  it('closing the overlay restarts the clock', async () => {
    await detect();
    advance(3000);
    await detect();
    setLyricsButtonActive(false);
    await detect();
    setLyricsButtonActive(true);
    advance(100);
    await detect();
    advance(3000);
    expect((await detect()).lyricsState).toBe('LOADING');
    advance(1100);
    expect((await detect()).lyricsState).toBe('MISSING_NO_REQUEST');
  });

  it('an id seen through a request made while another track was current never fires', async () => {
    setTrack(OTHER_URI);
    // Next-track prefetch: Spotify asks for the NEXT track's lyrics while OTHER plays.
    gateway({ type: 'SLY_COLOR_LYRICS_REQUEST', trackId: TRACK_ID });
    gateway({ type: 'SLY_FETCH_START', trackId: TRACK_ID });
    expect(wasColorLyricsSeen(TRACK_ID)).toBe(true);
    expect(wasColorLyricsSeen(OTHER_ID)).toBe(false);
    expect(w.slyInternalState.isSpotifyFetching).toBe(false);
    gateway({ type: 'SLY_FETCH_END', trackId: TRACK_ID });

    setTrack(URI);
    await detect();
    advance(5000);
    const state = await detect();
    expect(state.lyricsState).not.toBe('MISSING_NO_REQUEST');
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
  });

  /** Heuristic MISSING verdict, then the fallback armed by PERSISTED_NATIVE_MISSING. */
  async function reachArmedHeuristicMissing(): Promise<void> {
    await detect();
    advance(4100);
    expect((await detect()).lyricsState).toBe('MISSING_NO_REQUEST');
    advance(500);
    await detect();
    expect(w.slyInternalState.forceFallback).toBe(true);
  }

  function mountFullPanelRows(): void {
    const doc = new DOMParser().parseFromString(NOV_PANEL_HTML, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    Array.from(document.querySelectorAll('.t3jTARRdoLQZ0LowMbxg [data-testid="lyrics-line"] > div'))
      .forEach((el, i) => { el.textContent = ENGLISH_LINES[i % ENGLISH_LINES.length]; });
  }

  it('the self-heal still fires when rows appear later (Spotify requested them after all), and is not reported', async () => {
    await reachArmedHeuristicMissing();

    // Spotify asks for this track's lyrics late and renders rows after all.
    gateway({ type: 'SLY_COLOR_LYRICS_REQUEST', trackId: TRACK_ID });
    mountFullPanelRows();
    advance(500);
    await detect();
    const entry = w.slyPreFetchRegistry.getState(URI);
    expect(entry?.nativeStatus).toBe('NATIVE_OK');
    expect(entry?.heuristic).toBeUndefined();
    expect(w.slyInternalState.forceFallback).toBe(false);
    // The background never got the guessed MISSING: nothing to undo there.
    expect(nativeReports()).toHaveLength(0);
  });

  it('rows of another track (no request seen for this id) never heal the heuristic MISSING or report anything', async () => {
    await reachArmedHeuristicMissing();

    // The NEXT track's rows mount (its lyrics were requested) while the bridge still
    // holds this track; the bridge already reads the new rows' flags.
    recordColorLyricsSeen(OTHER_ID);
    mountFullPanelRows();
    w.spotifyState.isTimeSynced = true;
    w.spotifyState.lyricsProvider = 'MusixMatch';
    for (let i = 0; i < 5; i++) {
      advance(500);
      await detect();
    }
    const entry = w.slyPreFetchRegistry.getState(URI);
    expect(entry?.nativeStatus).toBe('MISSING');
    expect(entry?.heuristic).toBe(true);
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(nativeReports()).toHaveLength(0);
  });

  it('a non-heuristic (persisted) MISSING heals and reports from rows that belong to the track', async () => {
    w.slyPreFetchRegistry.register(URI, 'MISSING', { source: 'native', nativeStatus: 'MISSING', reason: 'WarmingEngine Hydration' });
    recordColorLyricsSeen(TRACK_ID); // Spotify requested this track's lyrics: the rows are its own
    mountFullPanelRows();
    await detect();
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('NATIVE_OK');
    expect(nativeReports().map((c: any[]) => c[0].payload.status)).toEqual(['NATIVE_OK']);
  });

  it('a persisted MISSING is not healed from rows of another track (no request seen for this one: live round 2)', async () => {
    w.slyPreFetchRegistry.register(URI, 'MISSING', { source: 'native', nativeStatus: 'MISSING', reason: 'WarmingEngine Hydration' });
    recordColorLyricsSeen(OTHER_ID);
    mountFullPanelRows();
    for (let i = 0; i < 3; i++) await detect();
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('MISSING');
    expect(nativeReports()).toHaveLength(0);
  });
});

describe('no color-lyrics request: never fires when (A2.2)', () => {
  async function runPast4s(): Promise<any> {
    await detect();
    advance(2500);
    await detect();
    advance(2500);
    return detect();
  }

  const expectNoVerdict = (state: any) => {
    expect(state.lyricsState).not.toBe('MISSING_NO_REQUEST');
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).not.toBe('MISSING');
  };

  it('the overlay is closed', async () => {
    setLyricsButtonActive(false);
    expectNoVerdict(await runPast4s());
  });

  it('Now Playing view preview rows are present', async () => {
    const aside = document.querySelector('#Desktop_PanelContainer_Id')!;
    aside.innerHTML = '<div data-testid="lyrics-npv-section"><div data-testid="lyrics-line"><div>Invented preview row</div></div></div>';
    expectNoVerdict(await runPast4s());
  });

  it('the current item is an episode', async () => {
    const episode = 'spotify:episode:L1aEpisode000000000001';
    setTrack(episode);
    const state = await runPast4s();
    expect(state.lyricsState).not.toBe('MISSING_NO_REQUEST');
    expect(w.slyPreFetchRegistry.getState(episode)).toBeUndefined();
  });

  it('the interceptor failed or never answered', async () => {
    w.slyInternalState.interceptorFailed = true;
    expectNoVerdict(await runPast4s());
    resetNoRequestClock();
    w.slyInternalState.interceptorFailed = false;
    w.slyInternalState.interceptorReady = false;
    expectNoVerdict(await runPast4s());
  });

  it('an intercept or a Spotify fetch is in flight', async () => {
    w.slyInternalState.interceptorActive = true;
    expectNoVerdict(await runPast4s());
    w.slyInternalState.interceptorActive = false;
    w.slyInternalState.isSpotifyFetching = true;
    expectNoVerdict(await runPast4s());
  });

  it('the id was seen, the fallback is armed, or a fetch already failed', async () => {
    recordColorLyricsSeen(TRACK_ID);
    expectNoVerdict(await runPast4s());
    w.slyInternalState.colorLyricsSeenAt.clear();
    w.slyInternalState.forceFallback = true;
    expectNoVerdict(await runPast4s());
    w.slyInternalState.forceFallback = false;
    w.slyInternalState.failedFetchUris.add(URI);
    expectNoVerdict(await runPast4s());
  });

  it('the registry already knows a native status', async () => {
    for (const status of ['NATIVE_OK', 'SYNCED', 'ROMANIZED', 'UNSYNCED']) {
      w.slyPreFetchRegistry.states.clear();
      w.slyInternalState.forceFallback = false;
      w.slyPreFetchRegistry.register(URI, status, { source: 'native', nativeStatus: status, reason: 'Network Intercept' });
      w.slyInternalState.nativeLookupPendingUntil.clear();
      const state = await runPast4s();
      expect(state.lyricsState).not.toBe('MISSING_NO_REQUEST');
      expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe(status);
    }
  });
});
