/**
 * Live round 1, group A1.2/A1.3: UNSYNCED / SYNCED / forensic evidence is recorded only
 * from live full-panel rows of the current track (overlay open, native panel not hidden,
 * no takeover rows, a color-lyrics request seen for the id, no Layer-1 lookup pending).
 * Synthetic 2026-11 fixtures (overlay open / closed); all ids and lyric text are invented.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordColorLyricsSeen, markNativeLookupPending } from '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import { resetNoRequestClock, resetUnsyncedReportMemo, resetPanelGraceTrack } from '../../lib/slyCore/detector';

const NOV_PANEL_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf8');
const NOV_HOME_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-home.html'), 'utf8');

const TRACK_ID = 'L1aEvidenceTrack000001';
const URI = `spotify:track:${TRACK_ID}`;
const PREV_ID = 'L1aPreviousTrack000001';
// Invented English lines (not romanized, so the forensic scan never fires on them).
const ENGLISH_LINES = [
  'We walk along the quiet river in the morning',
  'Every window in the town is shining gold',
  '♪',
  'Nobody knows the song the old bell sings',
  'Tomorrow we will paint the fences blue again',
  'Carry the lantern home before the rain begins',
  'And keep the little garden growing slow',
];

const w = window as any;
let logSpy: ReturnType<typeof vi.spyOn>;

function loadFixture(html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
}

function setFullPanelTexts(texts: string[]): void {
  const inners = Array.from(document.querySelectorAll('.t3jTARRdoLQZ0LowMbxg [data-testid="lyrics-line"] > div'));
  inners.forEach((el, i) => { el.textContent = texts[i] ?? ''; });
}

function setBridge(opts: { isTimeSynced?: boolean; language?: string | null; provider?: string | null } = {}): void {
  // The fixtures' now-playing widget shows "Test Song" (title desync guard).
  w.spotifyState.track = { uri: URI, name: 'Test Song', artists: [{ name: 'Test Artist' }], metadata: { artist_name: 'Test Artist' } };
  w.spotifyState.language = opts.language ?? null;
  w.spotifyState.lyricsProvider = opts.provider === undefined ? 'MusixMatch' : opts.provider;
  w.spotifyState.isTimeSynced = opts.isTimeSynced;
}

const themed = () => document.querySelector('.bm5I7yGVN8NXt6vH9eiC') as HTMLElement;
const reports = (status?: string) => (globalThis as any).browser.runtime.sendMessage.mock.calls
  .map((c: any[]) => c[0])
  .filter((m: any) => m?.type === 'SLY_REPORT_NATIVE_STATUS' && (!status || m.payload?.status === status));
const merges = () => logSpy.mock.calls.filter((c: any[]) => String(c[0]).startsWith('[sly-prefetch] Merged'));

async function passes(n: number): Promise<any> {
  let last;
  for (let i = 0; i < n; i++) last = await w.slyDetectNativeState();
  return last;
}

/** What a takeover leaves on screen: our root with rows, Spotify's themed panel display:none. */
function mountTakeover(): void {
  const panel = themed();
  const root = document.createElement('div');
  root.id = 'lyrics-root-sync';
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.setAttribute('data-testid', 'lyrics-line');
    row.textContent = `Invented takeover row ${i + 1}`;
    root.appendChild(row);
  }
  panel.parentElement!.insertBefore(root, panel);
  panel.style.display = 'none';
}

beforeAll(() => {
  expect(typeof w.slyDetectNativeState).toBe('function');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  w.slyPreFetchRegistry.states.clear();
  const s = w.slyInternalState;
  s.lastUri = URI;
  s.forceFallback = false;
  s.interceptorActive = false;
  s.isSpotifyFetching = false;
  s.interceptorReady = true;
  s.interceptorFailed = false;
  s.failedFetchUris.clear();
  s.l0Cache.clear();
  s.nativeLookupPendingUntil.clear();
  s.colorLyricsSeenAt.clear();
  s.songSettlingUntil = 0;
  s.songChangeTime = Date.now() - 10_000;
  s.panelIntentCooldown = 0;
  s.panelOpenTime = Date.now() - 5_000; // past the 1000ms evidence grace
  resetNoRequestClock();
  resetUnsyncedReportMemo();
  resetPanelGraceTrack();
  (globalThis as any).browser.runtime.sendMessage.mockClear();
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('UNSYNCED evidence with the overlay closed (A1.2)', () => {
  it('home fixture + isTimeSynced false + network ROMANIZED: stays ROMANIZED, no UNSYNCED report', async () => {
    loadFixture(NOV_HOME_HTML);
    setBridge({ isTimeSynced: false });
    recordColorLyricsSeen(TRACK_ID);
    w.slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', reason: 'Network Intercept' });
    logSpy.mockClear();

    const state = await passes(3);
    expect(state.isOnLyricsPage).toBe(false);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
    expect(w.slyPreFetchRegistry.getState(URI)?.state).toBe('ROMANIZED');
    expect(reports('UNSYNCED')).toHaveLength(0);
    expect(merges()).toHaveLength(0);
  });

  it('home fixture with an empty registry: nothing is recorded or reported as UNSYNCED', async () => {
    loadFixture(NOV_HOME_HTML);
    setBridge({ isTimeSynced: false });
    recordColorLyricsSeen(TRACK_ID);

    const state = await passes(3);
    expect(state.lyricsState).not.toContain('UNSYNCED');
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });
});

describe('UNSYNCED evidence during a takeover (A1.2)', () => {
  it('hidden native panel + takeover rows + registry UNSYNCED: 5 passes give 0 merges and at most 1 report', async () => {
    loadFixture(NOV_PANEL_HTML);
    setFullPanelTexts(ENGLISH_LINES);
    mountTakeover();
    setBridge({ isTimeSynced: false });
    recordColorLyricsSeen(TRACK_ID);
    w.slyPreFetchRegistry.register(URI, 'UNSYNCED', { source: 'native', reason: 'Network Intercept' });
    w.slyInternalState.forceFallback = true;
    logSpy.mockClear();

    const state = await passes(5);
    expect(state.lyricsState).toContain('UNSYNCED');
    expect(merges()).toHaveLength(0);
    expect(reports('UNSYNCED').length).toBeLessThanOrEqual(1);
  });

  it('hidden native panel + takeover rows + empty registry: the bridge flag records nothing', async () => {
    loadFixture(NOV_PANEL_HTML);
    setFullPanelTexts(ENGLISH_LINES);
    mountTakeover();
    setBridge({ isTimeSynced: false });
    recordColorLyricsSeen(TRACK_ID);

    await passes(3);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });
});

describe('UNSYNCED evidence on live rows (A1.2)', () => {
  beforeEach(() => {
    loadFixture(NOV_PANEL_HTML);
    setFullPanelTexts(ENGLISH_LINES);
    setBridge({ isTimeSynced: false, language: 'en' });
  });

  it('visible rows + isTimeSynced false + seen id: UNSYNCED registered and reported exactly once', async () => {
    recordColorLyricsSeen(TRACK_ID);
    logSpy.mockClear();

    const state = await passes(3);
    expect(state.lyricsState).toContain('UNSYNCED');
    const entry = w.slyPreFetchRegistry.getState(URI);
    expect(entry?.nativeStatus).toBe('UNSYNCED');
    expect(entry?.nativeReason).toBe('Bridge isTimeSynced=false (full panel)');
    expect(merges()).toHaveLength(1);
    expect(reports('UNSYNCED')).toHaveLength(1);
  });

  it('an unseen id (rows not attributable): nothing registered or reported', async () => {
    await passes(3);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });

  it('a pending Layer-1 lookup (K5): nothing registered until it settles', async () => {
    recordColorLyricsSeen(TRACK_ID);
    markNativeLookupPending(TRACK_ID);
    await passes(2);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });

  it('no provider: nothing registered', async () => {
    recordColorLyricsSeen(TRACK_ID);
    setBridge({ isTimeSynced: false, provider: null });
    await passes(2);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
  });

  it('a hidden tab: nothing registered', async () => {
    recordColorLyricsSeen(TRACK_ID);
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      await passes(2);
    } finally {
      delete (document as any).hidden;
      if (hidden) Object.defineProperty(Document.prototype, 'hidden', hidden);
    }
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
  });

  it('a network ROMANIZED is never overridden by live UNSYNCED evidence', async () => {
    recordColorLyricsSeen(TRACK_ID);
    w.slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', reason: 'Network Intercept' });
    await passes(3);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
    expect(reports('UNSYNCED')).toHaveLength(0);
  });

  it('a FetchEngine custom UNSYNCED state alone is never reported as native UNSYNCED', async () => {
    recordColorLyricsSeen(TRACK_ID);
    setBridge({ isTimeSynced: undefined, language: 'en' });
    w.slyPreFetchRegistry.register(URI, 'UNSYNCED', { customStatus: 'UNSYNCED', reason: 'FetchEngine Success' });
    await passes(3);
    expect(reports('UNSYNCED')).toHaveLength(0);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBeUndefined();
  });
});

describe('previous-track rows after a skip to a seen track (A1.2 settle grace)', () => {
  const PREV_URI = `spotify:track:${PREV_ID}`;

  beforeEach(() => {
    loadFixture(NOV_PANEL_HTML);
    // The previous track's rows (Spotify had unsynced lyrics for it) are still mounted;
    // the bridge reads their isTimeSynced=false while its track is already the new one.
    setFullPanelTexts(ENGLISH_LINES);
    setBridge({ isTimeSynced: false, language: 'en' });
    // Spotify requested the new track's lyrics at the switch: the id is seen at once.
    recordColorLyricsSeen(TRACK_ID);
  });

  it('panel grace restarted by the skip (panelOpenTime zeroed): nothing registered or reported', async () => {
    w.slyInternalState.panelOpenTime = 0;
    await passes(3);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });

  it('panelOpenTime just set: nothing registered or reported', async () => {
    w.slyInternalState.panelOpenTime = Date.now();
    await passes(3);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });

  it('Pipeline-B-first switch (panelOpenTime never zeroed): the grace restarts on the track change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // A pass on the previous track (overlay open long ago).
      w.slyInternalState.lastUri = PREV_URI;
      w.spotifyState.track = { ...w.spotifyState.track, uri: PREV_URI };
      await passes(1);
      w.slyPreFetchRegistry.states.clear();
      (globalThis as any).browser.runtime.sendMessage.mockClear();

      // Pipeline B moves lastUri itself, so content.ts never zeroes panelOpenTime.
      w.slyInternalState.lastUri = URI;
      w.spotifyState.track = { ...w.spotifyState.track, uri: URI };
      await passes(3);
      vi.setSystemTime(Date.now() + 900);
      await passes(1);
      expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
      expect(reports()).toHaveLength(0);

      // Control: past the grace on the new track, live rows are evidence again.
      vi.setSystemTime(Date.now() + 200);
      await passes(1);
      expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('UNSYNCED');
      expect(reports('UNSYNCED')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('previous-track rows after a skip (A1.3)', () => {
  beforeEach(() => {
    loadFixture(NOV_PANEL_HTML);
    // Spotify requested the previous track's lyrics, not the new one's.
    recordColorLyricsSeen(PREV_ID);
  });

  it('isTimeSynced true past the grace, unseen id: no SYNCED registered or reported for the new id', async () => {
    setFullPanelTexts(ENGLISH_LINES);
    setBridge({ isTimeSynced: true, language: 'en' });

    const state = await passes(3);
    expect(state.hasNativeLines).toBe(true);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });

  it('romanized rows past the grace, unseen id: the forensic scan neither arms nor records anything', async () => {
    setBridge({ isTimeSynced: true, language: 'id' }); // fixture rows are invented romanized Hindi

    await passes(3);
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports()).toHaveLength(0);
  });

  it('control: once the new id is seen, the same romanized rows are flagged ROMANIZED', async () => {
    recordColorLyricsSeen(TRACK_ID);
    setBridge({ isTimeSynced: true, language: 'id' });

    await passes(1);
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
  });

  it('control: once the new id is seen, synced English rows are recorded SYNCED once', async () => {
    recordColorLyricsSeen(TRACK_ID);
    setFullPanelTexts(ENGLISH_LINES);
    setBridge({ isTimeSynced: true, language: 'en' });
    logSpy.mockClear();

    await passes(3);
    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('SYNCED');
    expect(reports('SYNCED').length).toBeGreaterThanOrEqual(1);
    expect(merges()).toHaveLength(1);
  });

  it('SYNCED is not recorded from rows hidden behind a takeover', async () => {
    recordColorLyricsSeen(TRACK_ID);
    setFullPanelTexts(ENGLISH_LINES);
    mountTakeover();
    setBridge({ isTimeSynced: true, language: 'en' });

    await passes(3);
    expect(w.slyPreFetchRegistry.getState(URI)).toBeUndefined();
    expect(reports('SYNCED')).toHaveLength(0);
  });
});
