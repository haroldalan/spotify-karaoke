// Integration-level checks for the 2026-11 web player and the corrected K5/K6 line counting.
// All text is invented; fixtures are synthetic copies of the real page structure.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../lib/core/lyricsCache', () => ({
  loadSongCache: vi.fn().mockResolvedValue(undefined),
  deleteSongCache: vi.fn(),
}));

import { hasLyricWords, countWordLines } from '../../lib/lyrics/lineUtils';
import { setupMessageListener } from '../../lib/core/messageListener';
import { StateStore } from '../../lib/core/store';
import { getLyricsLines, getNowPlayingKey, getNowPlayingTitle } from '../../lib/dom/domQueries';
import '../../lib/slyCore/state';
import '../../lib/slyCore/playback';
import { realignEncorePrefix } from '../../lib/slyCore/scavenger';

const OCT = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf-8');
const NOV = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf-8');
const w = window as any;

function load(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

describe('lineUtils', () => {
  it('only counts lines that carry letters or digits', () => {
    expect(hasLyricWords('♪')).toBe(false);
    expect(hasLyricWords('')).toBe(false);
    expect(hasLyricWords('   ')).toBe(false);
    expect(hasLyricWords(null)).toBe(false);
    expect(hasLyricWords('पंक्ति')).toBe(true);
    expect(hasLyricWords('42')).toBe(true);
    expect(countWordLines(['a', '♪', '', 'b', ' ', 'c'])).toBe(3);
  });
});

describe('2026-11 now-playing widget (now-playing-widget-v2)', () => {
  beforeEach(() => load(NOV));
  afterEach(() => { document.body.innerHTML = ''; });

  it('reads the song key and the title from the v2 widget', () => {
    expect(getNowPlayingKey()).toBe('Now playing: Test Song by Test Artist, Second Artist');
    expect(getNowPlayingTitle()).toBe('Test Song');
  });

  it('realigns stale Encore button classes to the live prefix (e-101040-)', () => {
    w.SPOTIFY_CLASSES.btnPrimary = 'e-10860-legacy-button e-10860-legacy-button-primary';
    w.SPOTIFY_CLASSES.btnSecondaryInner = 'e-10451-button-secondary__inner';
    realignEncorePrefix();
    expect(w.SPOTIFY_CLASSES.btnPrimary).toBe('e-101040-legacy-button e-101040-legacy-button-primary');
    expect(w.SPOTIFY_CLASSES.btnSecondaryInner).toBe('e-101040-button-secondary__inner');
  });
});

describe('late SKL_NATIVE_LYRICS counted by lines with words (K5)', () => {
  const TRACK_ID = '4UMIv5jd9gK98a39BQRD9X';
  // Musixmatch unsynced lyrics drop blank lines: 6 word lines, no '♪', no trailing ''.
  const MXM_WORD_LINES = ['पंक्ति एक', 'पंक्ति दो', 'पंक्ति तीन', 'पंक्ति चार', 'पंक्ति पाँच', 'पंक्ति छह'];
  let store: StateStore;
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  const post = (action: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', {
    source: window, origin: 'https://open.spotify.com', data: { source: 'SLY_ACTION_GATEWAY', action },
  }));
  const flush = () => new Promise(r => setTimeout(r, 0));

  beforeEach(() => {
    load(OCT);
    w.spotifyState = { track: null };
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    store = new StateStore();
    store.songKey = 'Now playing: Test Song by Test Artist';
    store.cache.original = getLyricsLines().map(el => el.textContent ?? '');
    setupMessageListener(store, vi.fn().mockResolvedValue(undefined) as any);
  });
  afterEach(() => { warn.mockRestore(); log.mockRestore(); document.body.innerHTML = ''; });

  it('applies Musixmatch lines whose word-line count matches Spotify\'s, even though raw counts differ', async () => {
    post({
      type: 'SKL_NATIVE_LYRICS', trackId: TRACK_ID, nativeLines: MXM_WORD_LINES, isRomanizedUpgrade: true,
      canonHash: 1, late: true, spotifyLineCount: 8, spotifyWordLineCount: 6,
    });
    await flush(); await flush();

    const rows = getLyricsLines().map(el => el.textContent);
    expect(rows[0]).toBe('पंक्ति एक');
    expect(rows[2]).toBe('♪'); // spacer row keeps Spotify's marker
    expect(rows[6]).toBe('पंक्ति छह');
  });

  it('still rejects a real mismatch in lines with words', async () => {
    post({
      type: 'SKL_NATIVE_LYRICS', trackId: TRACK_ID, nativeLines: MXM_WORD_LINES.slice(0, 4), isRomanizedUpgrade: true,
      canonHash: 1, late: true, spotifyLineCount: 8, spotifyWordLineCount: 6,
    });
    await flush(); await flush();

    expect(getLyricsLines()[0].textContent).toBe('Mera dil tera hai, tu kahan hai yaar');
  });
});

describe('playback clock with 2026-11 bridge tracks', () => {
  let nowMs = 1_000_000;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    load(OCT);
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    w.slyResetPlaybackExtrapolator();
  });
  afterEach(() => { nowSpy.mockRestore(); w.spotifyState.track = null; document.body.innerHTML = ''; });

  it('reads duration.milliseconds (Spotify item shape) when the slider max is unavailable', () => {
    const input = document.querySelector('[data-testid="playback-progressbar"] input') as HTMLInputElement;
    input.removeAttribute('max');
    input.removeAttribute('value');
    w.spotifyState.track = { uri: 'spotify:track:test', duration: { milliseconds: 330463 } };
    // 5.554933532649646% of 330.463 s
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('never extrapolates more than 1.5 s past the last progress-bar update', () => {
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
    nowMs += 1000;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(19.357, 3);
    nowMs += 10_000; // stream stalled: the bar stopped moving but the button still says Pause
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(19.857, 3);
  });
});
