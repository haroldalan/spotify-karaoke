/**
 * Group B2 (phase 1): slyCore detector against the synthetic 2026 lyrics-panel fixture.
 * All lyric text is invented (see the fixture header); no real lyrics.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordColorLyricsSeen } from '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import {
  classifyOnScreenLines,
  getFullPanelLineTexts,
  getNowPlayingViewTrackId,
  resetPanelGraceTrack,
  resolveTrackState,
} from '../../lib/slyCore/detector';

const FIXTURE_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf8');
// 2026-11 UI: overlay open (lyrics panel) and overlay closed (home). No element carries the track id.
const NOV_PANEL_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf8');
const NOV_HOME_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-home.html'), 'utf8');
const FIXTURE_TRACK_ID = '4UMIv5jd9gK98a39BQRD9X';
const FIXTURE_URI = `spotify:track:${FIXTURE_TRACK_ID}`;
const FULL_PANEL_TEXTS = [
  'Mera dil tera hai, tu kahan hai yaar',
  'Main har pal teri yaad mein rehta hoon',
  '♪',
  'Kya hua jo tum saath nahin ho aaj',
  'Phir bhi mujhe tujhse pyaar hai',
  'Zindagi ke har safar mein tera naam',
  'Kabhi toh aaja, kuch toh bol de',
];

const w = window as any;
const sendMessage = () => (globalThis as any).browser.runtime.sendMessage;

function loadFixture(html: string = FIXTURE_HTML): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
}

function setBridgeTrack(uri: string, name = 'Test Song', language: string | null = null): void {
  w.spotifyState.track = { uri, name, artists: [{ name: 'Test Artist' }], metadata: { artist_name: 'Test Artist' } };
  w.spotifyState.language = language;
  w.spotifyState.lyricsProvider = 'MusixMatch';
  w.spotifyState.isTimeSynced = undefined;
}

function resetInternalState(): void {
  const s = w.slyInternalState;
  s.lastUri = FIXTURE_URI;
  s.forceFallback = false;
  s.interceptorActive = false;
  s.failedFetchUris.clear();
  s.l0Cache.clear();
  s.nativeLookupPendingUntil.clear();
  s.colorLyricsSeenAt.clear();
  s.songSettlingUntil = 0;
  s.songChangeTime = Date.now() - 10_000;
  s.panelIntentCooldown = 0;
  // Panel opened 5s ago, so the forensic scan's 1000ms grace has passed.
  s.panelOpenTime = Date.now() - 5_000;
  // ...on the track each test sets (a track change since the previous test's last pass
  // would otherwise restart that grace).
  resetPanelGraceTrack();
}

/** Replace the full-panel line texts (not the preview) with the given strings. */
function setFullPanelTexts(texts: string[]): void {
  const inners = Array.from(document.querySelectorAll('.t3jTARRdoLQZ0LowMbxg [data-testid="lyrics-line"] > div'));
  inners.forEach((el, i) => { el.textContent = texts[i] ?? ''; });
}

beforeAll(() => {
  expect(typeof w.slyDetectNativeState).toBe('function');
});

beforeEach(() => {
  loadFixture();
  w.slyPreFetchRegistry.states.clear();
  resetInternalState();
  setBridgeTrack(FIXTURE_URI);
  sendMessage().mockClear();
});

describe('detector DOM helpers on the 2026 fixture', () => {
  it('reads only the full-panel lines and excludes the Now Playing view preview', () => {
    const texts = getFullPanelLineTexts();
    expect(texts).toEqual(FULL_PANEL_TEXTS);
    expect(texts.some(t => t.startsWith('Preview line'))).toBe(false);
  });

  it('the previous song\'s slide, while it leaves, is not read', () => {
    const firstRow = document.querySelector('.t3jTARRdoLQZ0LowMbxg [data-testid="lyrics-line"]')!;
    const leaving = document.createElement('div');
    leaving.setAttribute('data-sly-leaving', 'spotify');
    leaving.innerHTML = '<div data-testid="lyrics-line"><div>Previous song invented line</div></div>';
    firstRow.parentElement!.insertBefore(leaving, firstRow);
    expect(getFullPanelLineTexts()).toEqual(FULL_PANEL_TEXTS);
  });

  it('prefers data-sly-original over the rewritten textContent', () => {
    const firstInner = document.querySelector('.t3jTARRdoLQZ0LowMbxg [data-testid="lyrics-line"] > div')!;
    firstInner.setAttribute('data-sly-original', 'Original line kept by Pipeline B');
    firstInner.textContent = 'rewritten for romanized mode';
    expect(getFullPanelLineTexts()[0]).toBe('Original line kept by Pipeline B');
  });

  it('takes the current track id from the Now Playing view "playing from" link', () => {
    expect(getNowPlayingViewTrackId()).toBe(FIXTURE_TRACK_ID);
  });

  it('returns null when the Now Playing view link is absent (widget only links album/artist)', () => {
    document.querySelector('#Desktop_PanelContainer_Id > a')?.remove();
    expect(getNowPlayingViewTrackId()).toBeNull();
  });
});

describe('slyDetectNativeState on the 2026 fixture', () => {
  it('detects the open panel and full-panel lines without the preview', async () => {
    const state = await w.slyDetectNativeState();
    expect(state.isOnLyricsPage).toBe(true);
    expect(state.hasNativeLines).toBe(true);
    expect(state.lyricsState).not.toBe('LOADING');
  });

  it('treats preview-only lines (panel closed) as no panel and no native lines', async () => {
    document.querySelector('.BKBhMtk7_HSsKiFLJtC_')?.remove();
    const btn = document.querySelector('[data-testid="lyrics-button"]')!;
    btn.setAttribute('data-active', 'false');
    btn.setAttribute('aria-pressed', 'false');
    expect(document.querySelectorAll('[data-testid="lyrics-line"]').length).toBe(3); // preview only
    const state = await w.slyDetectNativeState();
    expect(state.isOnLyricsPage).toBe(false);
    expect(state.hasNativeLines).toBe(false);
    expect(getFullPanelLineTexts()).toEqual([]);
  });

  it('stays LOADING while the bridge track differs from the Now Playing view track id', async () => {
    const otherUri = 'spotify:track:0000000000000000000Zzz';
    setBridgeTrack(otherUri, 'Test Song');
    w.slyInternalState.lastUri = otherUri;
    const state = await w.slyDetectNativeState();
    expect(state.lyricsState).toBe('LOADING');
  });

  it('trusts matching track ids over a differing widget title', async () => {
    setBridgeTrack(FIXTURE_URI, 'Test Song (Remastered)');
    const state = await w.slyDetectNativeState();
    expect(state.lyricsState).not.toBe('LOADING');
  });

  it('flags the fixture lines (romanized Hindi tagged "id") as a romanized fallback', async () => {
    recordColorLyricsSeen(FIXTURE_TRACK_ID); // rows attributable: Spotify requested this track's lyrics
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');
    await w.slyDetectNativeState();

    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');
    const reported = sendMessage().mock.calls.map((c: any[]) => c[0]?.payload?.status);
    expect(reported).toContain('ROMANIZED');
  });

  it('does not run the forensic scan while the interceptor is in flight', async () => {
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');
    w.slyInternalState.interceptorActive = true;
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBeUndefined();
  });

  it('classifies the fixture lines as romanized Hindi even though the tag says "id"', () => {
    const { romanized, verdict } = classifyOnScreenLines(getFullPanelLineTexts(), 'id');
    expect(romanized).toBe(true);
    expect(verdict.lang).toBe('hi');
  });

  it('never flags mixed native/English lines on the language tag alone', async () => {
    setFullPanelTexts([
      'We keep on dancing under the city lights tonight',
      'Every single moment feels like a brand new start',
      '오늘 밤',
      'Hold my hand and never let me go again',
    ]);
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'ko');
    expect(classifyOnScreenLines(getFullPanelLineTexts(), 'ko').romanized).toBe(false);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
  });

  it('does not flag native-script lines', async () => {
    setFullPanelTexts([
      'यह एक परीक्षण पंक्ति है',
      'यह दूसरी परीक्षण पंक्ति है',
      '♪',
      'यहाँ कोई असली गीत नहीं है',
    ]);
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'hi');
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
  });
});

describe('ROMANIZED registry handling', () => {
  const registerRomanized = () =>
    w.slyPreFetchRegistry.register(FIXTURE_URI, 'ROMANIZED', { source: 'native', nativeStatus: 'ROMANIZED' });

  it('sets forceFallback at registry-check time and never promotes Latin lines to NATIVE_OK', async () => {
    registerRomanized();
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');
    const reported = sendMessage().mock.calls.map((c: any[]) => c[0]?.payload?.status);
    expect(reported).not.toContain('NATIVE_OK');
  });

  it('heals ROMANIZED to NATIVE_OK only when the on-screen lines are native script', async () => {
    registerRomanized();
    recordColorLyricsSeen(FIXTURE_TRACK_ID); // the rows are this track's: Spotify requested its lyrics
    setFullPanelTexts(['यह एक परीक्षण पंक्ति है', 'यह दूसरी परीक्षण पंक्ति है', 'यहाँ कोई असली गीत नहीं है']);
    await w.slyDetectNativeState();
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('NATIVE_OK');
    expect(w.slyInternalState.forceFallback).toBe(false);
  });

  it('does not arm the fallback while the interceptor is in flight', async () => {
    registerRomanized();
    w.slyInternalState.interceptorActive = true;
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
  });

  it('does not re-arm after a failed fallback this session, and stands down to Spotify', async () => {
    registerRomanized();
    w.slyInternalState.failedFetchUris.add(FIXTURE_URI);
    w.spotifyState.isTimeSynced = true;
    const detection = await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
    // A synced romanized track must not be reported/registered as SYNCED.
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');
    const reported = sendMessage().mock.calls.map((c: any[]) => c[0]?.payload?.status);
    expect(reported).not.toContain('SYNCED');

    const resolution = resolveTrackState(detection, detection.preFetch, undefined);
    expect(resolution.action).toBe('NATIVE_ORIGINAL');
  });

  it('turns a stale MISSING record into ROMANIZED (not NATIVE_OK) when the live lines are romanized', async () => {
    w.slyPreFetchRegistry.register(FIXTURE_URI, 'MISSING', { source: 'native', nativeStatus: 'MISSING' });
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');
    recordColorLyricsSeen(FIXTURE_TRACK_ID); // the rows are this track's: Spotify requested its lyrics
    await w.slyDetectNativeState();
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');
    expect(w.slyInternalState.forceFallback).toBe(true);
  });
});


describe('forensic scan with a synced bridge (realistic first tick)', () => {
  const NATIVE_TEXTS = ['यह एक परीक्षण पंक्ति है', 'यह दूसरी परीक्षण पंक्ति है', '♪', 'यहाँ कोई असली गीत नहीं है'];
  const reportedStatuses = () => sendMessage().mock.calls.map((c: any[]) => c[0]?.payload?.status);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // The panel has just opened: the first tick starts the 1000ms grace.
    w.slyInternalState.panelOpenTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not record SYNCED on the first tick, so the scan still flags romanized lines after the grace', async () => {
    recordColorLyricsSeen(FIXTURE_TRACK_ID);
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');
    w.spotifyState.isTimeSynced = true;

    const first = await w.slyDetectNativeState();
    expect(first.lyricsState).toBe('SYNCED');
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBeUndefined();
    expect(reportedStatuses()).not.toContain('SYNCED');
    expect(w.slyInternalState.forceFallback).toBe(false);

    vi.setSystemTime(Date.now() + 1500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');
    expect(reportedStatuses()).toContain('ROMANIZED');

    // Stable on later ticks: nothing resets the fallback or records SYNCED.
    vi.setSystemTime(Date.now() + 500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(reportedStatuses()).not.toContain('SYNCED');
  });

  it('a NATIVE_OK record contradicted by romanized lines on screen is demoted to ROMANIZED (and reported)', async () => {
    // Recorded from the previous song's native-script rows still on screen (live 2026-11-08).
    w.slyPreFetchRegistry.register(FIXTURE_URI, 'NATIVE_OK', { source: 'native', nativeStatus: 'NATIVE_OK', reason: 'Self-Heal (DOM Evidence)' });
    recordColorLyricsSeen(FIXTURE_TRACK_ID);
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');
    w.spotifyState.isTimeSynced = true;
    await w.slyDetectNativeState();
    vi.setSystemTime(Date.now() + 1500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');
    expect(reportedStatuses()).toContain('ROMANIZED');
  });

  it('our lyrics on screen for the track: Spotify\'s rows under them (with our lines) do not heal ROMANIZED', async () => {
    w.slyPreFetchRegistry.register(FIXTURE_URI, 'ROMANIZED', { source: 'native', nativeStatus: 'ROMANIZED' });
    recordColorLyricsSeen(FIXTURE_TRACK_ID);
    setFullPanelTexts(NATIVE_TEXTS); // Pipeline B wrote the cached takeover lines into them
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'hi');
    const root = document.createElement('div');
    root.id = 'lyrics-root-sync';
    document.body.appendChild(root);
    w.slyInternalState.currentLyrics = { _slyUri: FIXTURE_URI, lines: [] };
    await w.slyDetectNativeState();
    vi.setSystemTime(Date.now() + 1500);
    await w.slyDetectNativeState();
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');
    expect(reportedStatuses()).not.toContain('NATIVE_OK');
    root.remove();
    w.slyInternalState.currentLyrics = null;
  });

  it('a NATIVE_OK record with native-script lines on screen is trusted (no scan)', async () => {
    w.slyPreFetchRegistry.register(FIXTURE_URI, 'NATIVE_OK', { source: 'native', nativeStatus: 'NATIVE_OK', reason: 'De-Romanization Success' });
    recordColorLyricsSeen(FIXTURE_TRACK_ID);
    setFullPanelTexts(NATIVE_TEXTS);
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'hi');
    await w.slyDetectNativeState();
    vi.setSystemTime(Date.now() + 1500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('NATIVE_OK');
  });

  it('records SYNCED once the grace has passed for native-script synced lines', async () => {
    recordColorLyricsSeen(FIXTURE_TRACK_ID);
    setFullPanelTexts(NATIVE_TEXTS);
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'hi');
    w.spotifyState.isTimeSynced = true;

    await w.slyDetectNativeState();
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBeUndefined();

    vi.setSystemTime(Date.now() + 1500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('SYNCED');
    expect(reportedStatuses()).toContain('SYNCED');
  });

  it('never records SYNCED while the panel is closed (no full-panel lines to verify)', async () => {
    document.querySelector('.BKBhMtk7_HSsKiFLJtC_')?.remove();
    const btn = document.querySelector('[data-testid="lyrics-button"]')!;
    btn.setAttribute('data-active', 'false');
    btn.setAttribute('aria-pressed', 'false');
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');
    w.spotifyState.isTimeSynced = true;

    await w.slyDetectNativeState();
    vi.setSystemTime(Date.now() + 5000);
    await w.slyDetectNativeState();
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBeUndefined();
    expect(reportedStatuses()).not.toContain('SYNCED');
  });

  it('a persisted SYNCED record does not block the scan; it is demoted to ROMANIZED', async () => {
    recordColorLyricsSeen(FIXTURE_TRACK_ID);
    // Shape of a warming hydration of a record saved by an older build.
    w.slyPreFetchRegistry.register(FIXTURE_URI, 'NATIVE_OK', { nativeStatus: 'SYNCED', reason: 'WarmingEngine Hydration' });
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');
    w.spotifyState.isTimeSynced = true;

    await w.slyDetectNativeState();
    vi.setSystemTime(Date.now() + 1500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('ROMANIZED');

    // The NATIVE_OK/SYNCED branch must not undo it on the next tick.
    vi.setSystemTime(Date.now() + 500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(true);
  });

  it('a NATIVE_OK record (de-romanization success) still blocks the scan', async () => {
    w.slyPreFetchRegistry.register(FIXTURE_URI, 'NATIVE_OK', { source: 'native', reason: 'De-Romanization Success' });
    setBridgeTrack(FIXTURE_URI, 'Test Song', 'id');

    await w.slyDetectNativeState();
    vi.setSystemTime(Date.now() + 1500);
    await w.slyDetectNativeState();
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyPreFetchRegistry.getState(FIXTURE_URI)?.nativeStatus).toBe('NATIVE_OK');
  });
});

describe('2026-11 UI: widget-title desync guard (no track id in the DOM)', () => {
  const NOV_URI = 'spotify:track:NovTrackId000000000001';
  const reportCalls = () =>
    sendMessage().mock.calls.filter((c: any[]) => c[0]?.type === 'SLY_REPORT_NATIVE_STATUS');

  /** Set the now-playing widget's title link text (the album link's text is the track title). */
  const setWidgetTitle = (text: string) => {
    document.querySelector('[data-testid="now-playing-widget-v2"] a[href^="/album/"] span')!.textContent = text;
  };

  beforeEach(() => {
    loadFixture(NOV_PANEL_HTML);
    w.slyInternalState.lastUri = NOV_URI;
  });

  it('the fixture has no Now Playing view track link, so the title path is the guard', () => {
    expect(getNowPlayingViewTrackId()).toBeNull();
  });

  it('S3: stays LOADING while the bridge still holds the previous track', async () => {
    // The bridge lags the widget by up to one tick: lastUri and the bridge uri still
    // agree on the previous track, and only the widget title shows the new one.
    setBridgeTrack(NOV_URI, 'Previous Song', 'id');
    const state = await w.slyDetectNativeState();

    expect(state.lyricsState).toBe('LOADING');
    expect(w.slyInternalState.forceFallback).toBe(false);
    expect(w.slyPreFetchRegistry.getState(NOV_URI)).toBeUndefined();
    expect(reportCalls()).toHaveLength(0);
  });

  it('S3 control: with the widget title matching, the forensic scan runs on the same lines', async () => {
    recordColorLyricsSeen(NOV_URI.split(':').pop());
    setBridgeTrack(NOV_URI, 'Test Song', 'id');
    await w.slyDetectNativeState();

    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(w.slyPreFetchRegistry.getState(NOV_URI)?.nativeStatus).toBe('ROMANIZED');
    expect(reportCalls().map((c: any[]) => c[0].payload.status)).toContain('ROMANIZED');
  });

  it('C10: a title with U+3000, NBSP and double spaces matches the raw bridge name', async () => {
    const raw = 'Test　Song Two  Words ';
    setWidgetTitle(raw);
    setBridgeTrack(NOV_URI, raw);
    const state = await w.slyDetectNativeState();

    expect(state.lyricsState).not.toBe('LOADING');
    expect(state.hasNativeLines).toBe(true);
  });

  it('C10: comparison ignores case and whitespace only, not a different title', async () => {
    setWidgetTitle('Test　Song');
    setBridgeTrack(NOV_URI, 'test  song');
    expect((await w.slyDetectNativeState()).lyricsState).not.toBe('LOADING');

    setBridgeTrack(NOV_URI, 'Test Song Two');
    expect((await w.slyDetectNativeState()).lyricsState).toBe('LOADING');
  });
});

describe('2026-11 UI: structural "lyrics not available" scan', () => {
  const NOV_URI = 'spotify:track:NovTrackId000000000002';
  const missingReports = () =>
    sendMessage().mock.calls.filter((c: any[]) =>
      c[0]?.type === 'SLY_REPORT_NATIVE_STATUS' && c[0]?.payload?.status === 'MISSING');
  const offsetParentDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

  const setWidgetTitle = (text: string) => {
    document.querySelector('[data-testid="now-playing-widget-v2"] a[href^="/album/"] span')!.textContent = text;
  };

  /** Replace the full-panel themed container's content with a message and no lyric lines. */
  const showPanelMessage = (text: string) => {
    const themed = document.querySelector('.bm5I7yGVN8NXt6vH9eiC')!;
    themed.innerHTML = '';
    const msg = document.createElement('div');
    msg.textContent = text;
    themed.appendChild(msg);
  };

  beforeEach(() => {
    // jsdom has no layout (offsetParent is always null); make every attached element
    // "visible" so the scan's visibility check does not hide a false positive.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) { return this.isConnected ? this.parentElement : null; },
    });
    w.slyInternalState.lastUri = NOV_URI;
  });

  afterEach(() => {
    if (offsetParentDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor);
    else delete (HTMLElement.prototype as any).offsetParent;
  });

  it('C12: a widget and playlist row titled "UNAVAILABLE" with the overlay closed is not MISSING', async () => {
    loadFixture(NOV_HOME_HTML);
    setWidgetTitle('UNAVAILABLE');
    document.querySelector('[data-testid="tracklist-row"] a')!.textContent = 'Unavailable (Remix)';
    setBridgeTrack(NOV_URI, 'UNAVAILABLE');

    const state = await w.slyDetectNativeState();
    expect(state.isOnLyricsPage).toBe(false);
    expect(state.hasUnavailableMessage).toBe(false);
    expect(state.lyricsState).not.toBe('MISSING_DOM');
    expect(missingReports()).toHaveLength(0);
    expect(w.slyPreFetchRegistry.getState(NOV_URI)?.nativeStatus).not.toBe('MISSING');
  });

  it('C12: ignores the phrase when the full panel already shows lyric lines', async () => {
    loadFixture(NOV_PANEL_HTML);
    document.querySelector('.aRgHH3jy_GwGaSqqfqWw')!.textContent = 'Lyrics not available in your region';
    setBridgeTrack(NOV_URI, 'Test Song');

    const state = await w.slyDetectNativeState();
    expect(state.hasUnavailableMessage).toBe(false);
    expect(missingReports()).toHaveLength(0);
  });

  it('C12: a bare "unavailable" in an empty open panel is not a lyrics error', async () => {
    loadFixture(NOV_PANEL_HTML);
    showPanelMessage('Unavailable');
    setBridgeTrack(NOV_URI, 'Test Song');

    const state = await w.slyDetectNativeState();
    expect(state.hasUnavailableMessage).toBe(false);
    expect(missingReports()).toHaveLength(0);
  });

  it('C12 control: Spotify’s message in the open, empty full panel is still MISSING_DOM', async () => {
    loadFixture(NOV_PANEL_HTML);
    showPanelMessage('Lyrics aren’t available for this song');
    setBridgeTrack(NOV_URI, 'Test Song');

    const state = await w.slyDetectNativeState();
    expect(state.hasUnavailableMessage).toBe(true);
    expect(state.lyricsState).toBe('MISSING_DOM');
    expect(missingReports()).toHaveLength(1);
  });

  it('C12: the same message is ignored once the lyrics button is inactive', async () => {
    loadFixture(NOV_PANEL_HTML);
    showPanelMessage('Lyrics aren\'t available for this song');
    const btn = document.querySelector('[data-testid="lyrics-button"]')!;
    btn.setAttribute('data-active', 'false');
    btn.setAttribute('aria-pressed', 'false');
    setBridgeTrack(NOV_URI, 'Test Song');

    const state = await w.slyDetectNativeState();
    expect(state.hasUnavailableMessage).toBe(false);
    expect(missingReports()).toHaveLength(0);
  });
});

// Live 2026-11-08: after an ad, Spotify's expanded view kept the ad's title link
// (a[data-testid="ad-link"]) mounted. A page-wide check kept the Ad Break screen up
// over the next song; only the now-playing bar says whether an ad is playing.
describe('ad detection after an ad', () => {
  beforeEach(() => {
    loadFixture(NOV_PANEL_HTML);
    resetInternalState();
    setBridgeTrack(FIXTURE_URI);
  });

  it('a stale ad title link outside the now-playing bar is not an ad', async () => {
    const root = document.querySelector('[data-testid="root"]') ?? document.body;
    root.insertAdjacentHTML('beforeend', '<div data-testid="context-item-info-title"><a data-testid="ad-link" href="/premium">Spotify</a></div>');
    document.querySelector('[data-testid="now-playing-bar"]')!.setAttribute('data-testadtype', 'ad-type-none');
    expect((await w.slyDetectNativeState()).isAd).toBe(false);
  });

  it('the ad title link in the now-playing bar is an ad', async () => {
    const bar = document.querySelector('[data-testid="now-playing-bar"]')!;
    bar.removeAttribute('data-testadtype');
    bar.insertAdjacentHTML('afterbegin', '<div data-testid="context-item-info-title"><a data-testid="ad-link" href="/premium">Spotify</a></div>');
    expect((await w.slyDetectNativeState()).isAd).toBe(true);
  });
});
