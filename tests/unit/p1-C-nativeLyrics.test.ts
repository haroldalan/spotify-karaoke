import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../lib/core/lyricsCache', () => ({
  loadSongCache: vi.fn().mockResolvedValue(undefined),
}));

import { alignNativeToRows, applyNativeOverride, handleNativeLyrics, type NativeLyricsState } from '../../lib/core/nativeLyricsHandler';
import { getLyricsLines } from '../../lib/dom/domQueries';

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf-8');
const TRACK_ID = '4UMIv5jd9gK98a39BQRD9X'; // from the fixture's Now Playing view link

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

// Invented Devanagari stand-ins, one per on-screen row (7).
const NATIVE_7 = ['पंक्ति एक', 'पंक्ति दो', '♪', 'पंक्ति तीन', 'पंक्ति चार', 'पंक्ति पाँच', 'पंक्ति छह'];
// The shape a late upgrade really has: one line per line of Spotify's response
// (color-lyrics-romanized-hindi.json has 8, the last one words:''), against 7 rows.
const NATIVE_8_TRAILING_EMPTY = [...NATIVE_7, ''];
// A source that writes empty lines as '♪' (Musixmatch did, until it was removed in 3.1.6).
const NATIVE_8_TRAILING_NOTE = [...NATIVE_7, '♪'];

function setPlayingTrack(trackId: string): void {
  document.querySelector('#Desktop_PanelContainer_Id a')!.setAttribute('href', `/playlist/x?uri=spotify:track:${trackId}`);
}

function overlayList(): Element {
  return getLyricsLines()[0].parentElement!.parentElement!;
}

function prependEmptyRow(): void {
  const row = document.createElement('div');
  row.setAttribute('data-testid', 'lyrics-line');
  row.appendChild(document.createElement('div'));
  overlayList().insertBefore(row, overlayList().firstChild);
}

function makeState(overrides: Partial<NativeLyricsState> = {}): NativeLyricsState {
  return {
    cache: { original: [], processed: new Map() },
    pendingNativeLines: new Map(),
    songKey: 'Now playing: Test Song by Test Artist',
    mode: 'original',
    currentActiveLang: 'en',
    runtimeCache: new Map(),
    ...overrides,
  };
}

describe('p1-C late SKL_NATIVE_LYRICS (K5)', () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loadFixture();
    (window as any).spotifyState = { track: null };
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    document.body.innerHTML = '';
  });

  it('applies 8 late native lines (trailing \'\') to the 7 rows Spotify rendered from its 8-line response', async () => {
    const snapshot = getLyricsLines().map(el => el.textContent ?? '');
    expect(snapshot).toHaveLength(7);
    const state = makeState({ cache: { original: snapshot, processed: new Map([['en', { translated: snapshot, romanized: snapshot }]]) } });

    const applied = await handleNativeLyrics(TRACK_ID, NATIVE_8_TRAILING_EMPTY, state, vi.fn(), vi.fn(), { late: true, spotifyLineCount: 8 });

    expect(applied).toBe(true);
    // Index-aligned with the on-screen rows, not with the response.
    expect(state.cache.original).toEqual(NATIVE_7);
    expect(state.cache.processed.size).toBe(0);
    expect(getLyricsLines().map(el => el.textContent)).toEqual(NATIVE_7);
    expect(consoleWarn.mock.calls.some((c: unknown[]) => String(c[0]).includes('Ignoring late native lyrics'))).toBe(false);
  });

  it('applies late Musixmatch lines whose empty lines became \'♪\'', async () => {
    const trackId = 'NoteTrailTrack00000001';
    setPlayingTrack(trackId);
    const snapshot = getLyricsLines().map(el => el.textContent ?? '');
    const state = makeState({ cache: { original: snapshot, processed: new Map() } });

    expect(await handleNativeLyrics(trackId, NATIVE_8_TRAILING_NOTE, state, vi.fn(), vi.fn(), { late: true, spotifyLineCount: 8 })).toBe(true);
    expect(state.cache.original).toEqual(NATIVE_7);
    expect(getLyricsLines()[2].textContent).toBe('♪');
    expect(getLyricsLines()[6].textContent).toBe('पंक्ति छह');
  });

  it('keeps empty spacer rows in place and writes the native lines onto the rows with words', async () => {
    const trackId = 'SpacerRowsTrack0000001';
    setPlayingTrack(trackId);
    // Real overlays render empty spacer rows (e.g. at the top of the list).
    prependEmptyRow();
    prependEmptyRow();
    const snapshot = getLyricsLines().map(el => el.textContent ?? '');
    expect(snapshot).toHaveLength(9);
    const state = makeState({ cache: { original: snapshot, processed: new Map() } });

    expect(await handleNativeLyrics(trackId, NATIVE_8_TRAILING_EMPTY, state, vi.fn(), vi.fn(), { late: true, spotifyLineCount: 8 })).toBe(true);
    expect(state.cache.original).toEqual(['', '', ...NATIVE_7]);
    expect(getLyricsLines().map(el => el.textContent)).toEqual(['', '', ...NATIVE_7]);
  });

  it('ignores late native lines whose line count differs from Spotify\'s response (same gate as slyCore)', async () => {
    const trackId = 'CountMismatchTrack0001';
    setPlayingTrack(trackId);
    const snapshot = getLyricsLines().map(el => el.textContent ?? '');
    const state = makeState({ cache: { original: [...snapshot], processed: new Map() } });

    // 7 lines with words would fit the rows, but Spotify sent 8 lines: slyCore forces Layer 2 here.
    expect(await handleNativeLyrics(trackId, NATIVE_7, state, vi.fn(), vi.fn(), { late: true, spotifyLineCount: 8 })).toBe(false);
    expect(state.cache.original).toEqual(snapshot);
    expect(state.pendingNativeLines.size).toBe(0);
  });

  it('ignores late native lines whose lines with words do not match the rows', async () => {
    const trackId = 'WordsMismatchTrack0001';
    setPlayingTrack(trackId);
    const snapshot = getLyricsLines().map(el => el.textContent ?? '');
    const state = makeState({ cache: { original: [...snapshot], processed: new Map() } });

    // 8 lines like Spotify's response, but one row's line is missing: no safe mapping.
    const shifted = [...NATIVE_7.filter(l => l !== 'पंक्ति चार'), '', ''];
    expect(shifted).toHaveLength(8);
    expect(await handleNativeLyrics(trackId, shifted, state, vi.fn(), vi.fn(), { late: true, spotifyLineCount: 8 })).toBe(false);
    expect(state.cache.original).toEqual(snapshot);
    expect(getLyricsLines()[0].textContent).toBe(snapshot[0]);
  });

  it('ignores late native lines with a different line count and logs once', async () => {
    const snapshot = getLyricsLines().map(el => el.textContent ?? '');
    const state = makeState({ cache: { original: [...snapshot], processed: new Map() } });
    const onCancel = vi.fn();
    const trackId = 'MismatchTrack000000001';
    // Make the mismatching track the playing one.
    setPlayingTrack(trackId);

    const five = NATIVE_7.slice(0, 5);
    expect(await handleNativeLyrics(trackId, five, state, onCancel, vi.fn(), { late: true })).toBe(false);
    expect(await handleNativeLyrics(trackId, five, state, onCancel, vi.fn(), { late: true })).toBe(false);

    expect(state.cache.original).toEqual(snapshot);
    expect(onCancel).not.toHaveBeenCalled();
    expect(getLyricsLines()[0].textContent).toBe(snapshot[0]);
    const ignoredLogs = consoleWarn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('Ignoring late native lyrics'));
    expect(ignoredLogs).toHaveLength(1);
  });

  it('ignores late native lines for a track that is no longer playing', async () => {
    const state = makeState({ cache: { original: getLyricsLines().map(el => el.textContent ?? ''), processed: new Map() } });
    expect(await handleNativeLyrics('SomeOtherTrack00000001', NATIVE_7, state, vi.fn(), vi.fn(), { late: true })).toBe(false);
    expect(state.pendingNativeLines.size).toBe(0);
  });

  it('keeps late lines pending until rows are on screen, then applies them on a count match', async () => {
    const state = makeState();
    expect(await handleNativeLyrics(TRACK_ID, NATIVE_8_TRAILING_EMPTY, state, vi.fn(), vi.fn(), { late: true, spotifyLineCount: 8 })).toBe(false);
    expect(state.pendingNativeLines.get(TRACK_ID)).toEqual(NATIVE_8_TRAILING_EMPTY);

    expect(applyNativeOverride(TRACK_ID, state)).toBe(true);
    expect(state.cache.original).toEqual(NATIVE_7);
    expect(getLyricsLines()[3].textContent).toBe('पंक्ति तीन');
    expect(state.pendingNativeLines.size).toBe(0);
  });

  it('drops pending late lines that do not fit the rows once they render, and logs once', async () => {
    const trackId = 'PendingMismatchTrack01';
    setPlayingTrack(trackId);
    const before = getLyricsLines().map(el => el.textContent ?? '');
    const state = makeState();
    const five = NATIVE_7.slice(0, 5);
    expect(await handleNativeLyrics(trackId, five, state, vi.fn(), vi.fn(), { late: true, spotifyLineCount: 5 })).toBe(false);

    expect(applyNativeOverride(trackId, state)).toBe(false);
    expect(state.pendingNativeLines.size).toBe(0);
    expect(state.cache.original).toEqual([]);
    expect(getLyricsLines().map(el => el.textContent ?? '')).toEqual(before);
    const ignoredLogs = consoleWarn.mock.calls.filter((c: unknown[]) => String(c[0]).includes(`Ignoring late native lyrics for ${trackId}`));
    expect(ignoredLogs).toHaveLength(1);
  });

  it('does not rewrite misaligned rows for a non-late upgrade, but still upgrades the cache', async () => {
    const before = getLyricsLines().map(el => el.textContent ?? '');
    const state = makeState({ cache: { original: [...before], processed: new Map() } });
    const native3 = NATIVE_7.slice(0, 3);
    expect(await handleNativeLyrics(TRACK_ID, native3, state, vi.fn(), vi.fn())).toBe(true);
    expect(state.cache.original).toEqual(native3);
    expect(getLyricsLines().map(el => el.textContent ?? '')).toEqual(before);
  });
});

describe('p1-C alignNativeToRows (K5)', () => {
  it('maps lines with words onto rows with words, in order, and keeps spacer rows', () => {
    expect(alignNativeToRows(['A1', '', 'B1', '♪'], ['', 'a', '♪', 'b'])).toEqual(['', 'A1', '♪', 'B1']);
  });

  it('treats whitespace-only and marker-only lines as spacers on both sides', () => {
    expect(alignNativeToRows(['  ', 'A1', '…', 'B1'], ['a', 'b'])).toEqual(['A1', 'B1']);
  });

  it('returns null when the counts of lines with words differ, or there are none', () => {
    expect(alignNativeToRows(['A1', 'B1', 'C1'], ['a', 'b'])).toBeNull();
    expect(alignNativeToRows(['', '♪'], ['', '♪'])).toBeNull();
  });
});
