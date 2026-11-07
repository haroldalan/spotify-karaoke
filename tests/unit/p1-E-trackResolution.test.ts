/**
 * Phase 1 / group E — current-track resolution in the MAIN-world bridge
 * (entrypoints/slyBridge.ts) against the synthetic 2026-11-07 fixtures, where
 * [data-testid="context-item-info-title"] no longer exists and the widget is
 * [data-testid="now-playing-widget-v2"].
 *
 * Simulated fibers follow the verified 2026-11 shapes: `entityUri` one level above
 * the now-playing-bar (~19 above the widget, ~27 above the lyrics button); a full
 * track `item` only on the full-panel lyric-line chain (depth 11) while the overlay
 * is open. All ids and names are invented.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bodyOf = (file: string) =>
  readFileSync(resolve(__dirname, '../fixtures', file), 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
const PANEL_BODY = bodyOf('spotify-2026-11-lyrics-panel.html');
const HOME_BODY = bodyOf('spotify-2026-11-home.html');

const FIBER_KEY = '__reactFiber$test';
const w = window as any;

/** Fiber chain whose memoizedProps at `depth` is `props` (empty props elsewhere). */
function chainWith(entries: Array<[number, Record<string, unknown>]>): Record<string, unknown> {
  const maxDepth = Math.max(...entries.map(([d]) => d));
  let fiber: Record<string, unknown> | null = null;
  for (let d = maxDepth; d >= 0; d--) {
    const hit = entries.find(([depth]) => depth === d);
    fiber = { memoizedProps: hit ? hit[1] : {}, return: fiber };
  }
  return fiber!;
}

function setFiber(selectorOrEl: string | Element | null, fiber: Record<string, unknown>): void {
  const el = typeof selectorOrEl === 'string' ? document.querySelector(selectorOrEl) : selectorOrEl;
  if (!el) throw new Error(`fixture element missing: ${String(selectorOrEl)}`);
  (el as any)[FIBER_KEY] = fiber;
}

const barEntity = (uri: string) =>
  setFiber('[data-testid="now-playing-bar"]', chainWith([[1, { pageId: 'npv', paneMode: 'auxiliary', entityUri: uri }]]));

const panelLine = () =>
  Array.from(document.querySelectorAll('[data-testid="lyrics-line"]')).find(el => !el.closest('aside'))!;

const fullItem = (uri: string, name = 'Test Song') => ({
  type: 'track',
  uri,
  name,
  mediaType: 'audio',
  duration: { milliseconds: 354105 },
  album: { type: 'album', uri: 'spotify:album:2NTJua5Rhkszhg6b99TK78', name: 'Test Album', images: [] },
  artists: [{ name: 'Test Artist' }, { name: 'Second Artist' }],
});

let postSpy: ReturnType<typeof vi.spyOn>;

const sent = (type: string) =>
  postSpy.mock.calls
    .map((c: any[]) => c[0] as any)
    .filter((m: any) => m?.source === 'SLY_ACTION_GATEWAY' && m.action?.type === type)
    .map((m: any) => m.action.payload);

function scan(): Record<string, any> {
  w.slyScanSpotifyState();
  const updates = sent('SLY_TRACK_UPDATE');
  return updates[updates.length - 1];
}

beforeAll(async () => {
  vi.useFakeTimers(); // the 500 ms loop never fires on its own; tests call the scanner directly
  document.body.innerHTML = PANEL_BODY;
  postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  await import('../../entrypoints/slyBridge');
});

afterAll(() => {
  w.slyDeactivateShield?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  document.body.innerHTML = PANEL_BODY;
  postSpy.mockClear();
});

describe('2026-11 DOM: track resolution', () => {
  it('fixture sanity: legacy title anchor is gone, widget-v2 is present', () => {
    expect(document.querySelector('[data-testid="context-item-info-title"]')).toBeNull();
    expect(document.querySelector('[data-testid="now-playing-widget-v2"]')).not.toBeNull();
  });

  it('reports no track when no fiber carries a spotify:track: uri', () => {
    expect(scan().track).toBeNull();
  });

  it('overlay closed: builds the track from the bar entityUri + widget DOM', () => {
    document.body.innerHTML = HOME_BODY;
    barEntity('spotify:track:0000000000000000000E01');
    const payload = scan();
    expect(payload.track).toMatchObject({
      uri: 'spotify:track:0000000000000000000E01',
      name: 'Test Song',
      artists: [{ name: 'Test Artist' }, { name: 'Second Artist' }],
      duration: { milliseconds: 354105 },
    });
  });

  it('overlay closed: picks up cover art from the widget when present', () => {
    document.body.innerHTML = HOME_BODY;
    const widget = document.querySelector('[data-testid="now-playing-widget-v2"]')!;
    widget.insertAdjacentHTML('afterbegin', '<img data-testid="cover-art-image" src="https://example.test/art.jpg">');
    barEntity('spotify:track:0000000000000000000E02');
    const track = scan().track;
    expect(track.images).toEqual([{ url: 'https://example.test/art.jpg' }]);
    expect(track.album).toEqual({ images: [{ url: 'https://example.test/art.jpg' }] });
  });

  it('overlay open: uses the full item from the panel line chain when it matches entityUri', () => {
    const uri = 'spotify:track:0000000000000000000E03';
    barEntity(uri);
    const item = fullItem(uri);
    setFiber(panelLine(), chainWith([[6, { trackUri: uri, data: { lyrics: { language: 'hi' } } }], [11, { item }]]));
    const payload = scan();
    expect(payload.track).toEqual(item);
    expect(payload.track.album.name).toBe('Test Album');
  });

  it('overlay open: a stale panel item for another track is rejected in favour of entityUri', () => {
    const uri = 'spotify:track:0000000000000000000E04';
    barEntity(uri);
    setFiber(panelLine(), chainWith([[11, { item: fullItem('spotify:track:0000000000000000000OLD', 'Old Song') }]]));
    const track = scan().track;
    expect(track.uri).toBe(uri);
    expect(track.name).toBe('Test Song');
  });

  it('reads nowPlayingState.item as well', () => {
    const uri = 'spotify:track:0000000000000000000E05';
    barEntity(uri);
    const item = fullItem(uri);
    setFiber(panelLine(), chainWith([[42, { nowPlayingState: { context: {}, item, index: 0 } }]]));
    expect(scan().track).toEqual(item);
  });

  it('accepts an item fiber on now-playing-widget-v2 (spotify:track: uri only)', () => {
    const item = fullItem('spotify:track:0000000000000000000E06');
    setFiber('[data-testid="now-playing-widget-v2"]', chainWith([[3, { item }]]));
    expect(scan().track).toEqual(item);

    setFiber('[data-testid="now-playing-widget-v2"]', chainWith([[3, { item: { uri: 'spotify:episode:0000000000000000000X01', name: 'Ep' } }]]));
    expect(scan().track).toBeNull();
  });

  it('finds entityUri above the widget (~19) or the lyrics button (~27) when the bar has none', () => {
    setFiber('[data-testid="now-playing-widget-v2"]', chainWith([[19, { entityUri: 'spotify:track:0000000000000000000E07' }]]));
    expect(scan().track.uri).toBe('spotify:track:0000000000000000000E07');

    document.body.innerHTML = PANEL_BODY;
    setFiber('[data-testid="lyrics-button"]', chainWith([[27, { entityUri: 'spotify:track:0000000000000000000E08' }]]));
    expect(scan().track.uri).toBe('spotify:track:0000000000000000000E08');
  });

  it('ignores a non-track entityUri (episodes, ads)', () => {
    barEntity('spotify:episode:0000000000000000000X02');
    expect(scan().track).toBeNull();
  });

  it('keeps emitting language (K2) alongside the uri', () => {
    const uri = 'spotify:track:0000000000000000000E09';
    barEntity(uri);
    setFiber(panelLine(), chainWith([[6, { trackUri: uri, data: { language: 'hi' } }], [11, { item: fullItem(uri) }]]));
    const payload = scan();
    expect(payload.track.uri).toBe(uri);
    expect(payload.language).toBe('hi');
  });

  it('posts a structured-clone-safe copy, not the live fiber object', () => {
    const uri = 'spotify:track:0000000000000000000E10';
    barEntity(uri);
    const item: Record<string, unknown> = { ...fullItem(uri), onPlay: () => {} };
    setFiber(panelLine(), chainWith([[11, { item }]]));
    const track = scan().track;
    expect(track).not.toBe(item);
    expect(track.onPlay).toBeUndefined();
    expect(() => structuredClone(track)).not.toThrow();

    item.self = item; // cycle: JSON copy fails, a minimal plain track is posted instead
    const fallback = scan().track;
    expect(fallback).toEqual({ type: 'track', uri, name: 'Test Song', artists: [{ name: 'Test Artist' }, { name: 'Second Artist' }] });
    expect(() => structuredClone(fallback)).not.toThrow();
  });
});

describe('2026-11 DOM: track change bookkeeping', () => {
  it('a new entityUri resets native-lyrics detection and the change timestamp', () => {
    barEntity('spotify:track:0000000000000000000C01');
    scan();
    w.__sly_native_has_lyrics = true;
    const before = w.__sly_track_change_time;
    vi.advanceTimersByTime(50); // Date.now() moves under fake timers; the 500 ms loop does not fire
    scan();
    expect(w.__sly_native_has_lyrics).toBe(true); // same track: untouched

    barEntity('spotify:track:0000000000000000000C02');
    scan();
    expect(w.__sly_native_has_lyrics).toBeUndefined();
    expect(w.__sly_track_change_time).toBeGreaterThan(before);
  });

  it('notifies MXM metadata once per track, immediately for a fiber item', () => {
    const uri = 'spotify:track:0000000000000000000N01';
    barEntity(uri);
    setFiber(panelLine(), chainWith([[11, { item: fullItem(uri, 'Fiber Song') }]]));
    scan();
    scan();
    scan();
    expect(sent('SLY_MXM_NOTIFY_METADATA')).toEqual([
      { trackId: '0000000000000000000N01', name: 'Fiber Song', artist: 'Test Artist' },
    ]);
  });

  it('a widget-built track is notified only after uri + title are stable for two ticks', () => {
    document.body.innerHTML = HOME_BODY;
    barEntity('spotify:track:0000000000000000000N02');
    scan();
    expect(sent('SLY_MXM_NOTIFY_METADATA')).toEqual([]);
    scan();
    scan();
    expect(sent('SLY_MXM_NOTIFY_METADATA')).toEqual([
      { trackId: '0000000000000000000N02', name: 'Test Song', artist: 'Test Artist' },
    ]);
  });

  it('never pairs a new id with the previous title when the widget re-renders late', () => {
    document.body.innerHTML = HOME_BODY;
    barEntity('spotify:track:0000000000000000000N03'); // widget still shows "Test Song"
    scan();
    const titleLink = document.querySelector('[data-testid="now-playing-widget-v2"] a[href^="/album/"]')!;
    titleLink.textContent = 'Next Song';
    scan(); // title changed since the last tick: not yet trusted
    expect(sent('SLY_MXM_NOTIFY_METADATA')).toEqual([]);
    scan();
    expect(sent('SLY_MXM_NOTIFY_METADATA')).toEqual([
      { trackId: '0000000000000000000N03', name: 'Next Song', artist: 'Test Artist' },
    ]);
  });
});
