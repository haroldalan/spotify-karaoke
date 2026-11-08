/**
 * Live round 1, group A1.1: the MAIN-world bridge reads the sync flags (isTimeSynced,
 * syncType) only from a full-panel lyric line, never from the Now Playing view preview
 * card or a failNode, keeps an explicit `false`, and posts the rows' trackUri as the
 * diagnostic `lyricsTrackUri`. State copy in lib/slyCore/state.ts.
 * Synthetic 2026 lyrics-panel fixture; ids and text are invented.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf8');
const FIXTURE_BODY = FIXTURE_HTML.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];

const FIBER_KEY = '__reactFiber$l1a';
const TRACK_URI = 'spotify:track:0000000000000000000L1a';
const ROWS_URI = 'spotify:track:0000000000000000000R0w';
const w = window as any;

let postSpy: ReturnType<typeof vi.spyOn>;

function setFiber(el: Element | null, fiber: Record<string, unknown>): void {
  if (!el) throw new Error('fixture element missing');
  (el as any)[FIBER_KEY] = fiber;
}

/** Fiber chain: the line itself, then a lyrics component carrying {trackUri, data}. */
function lyricsChain(props: Record<string, unknown>): Record<string, unknown> {
  return { memoizedProps: {}, return: { memoizedProps: props, return: null } };
}

function lastTrackUpdate(): Record<string, any> | undefined {
  const calls = postSpy.mock.calls
    .map((c: any[]) => c[0] as any)
    .filter((m: any) => m?.source === 'SLY_ACTION_GATEWAY' && m.action?.type === 'SLY_TRACK_UPDATE');
  return calls.length ? calls[calls.length - 1].action.payload : undefined;
}

const panelLine = () =>
  Array.from(document.querySelectorAll('[data-testid="lyrics-line"]')).find(el => !el.closest('aside'))!;
const previewLine = () =>
  document.querySelector('[data-testid="lyrics-npv-section"] [data-testid="lyrics-line"]')!;
const removeFullPanelLines = () =>
  document.querySelectorAll('[data-testid="lyrics-line"]').forEach(el => { if (!el.closest('aside')) el.remove(); });

beforeAll(async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  document.body.innerHTML = FIXTURE_BODY;
  postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  await import('../../entrypoints/slyBridge');
});

afterAll(() => {
  w.slyDeactivateShield?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.advanceTimersByTime(1000);
  document.body.innerHTML = FIXTURE_BODY;
  setFiber(document.querySelector('[data-testid="context-item-info-title"]'), {
    memoizedProps: { item: { uri: TRACK_URI, name: 'Test Song', artists: [{ name: 'Test Artist' }] } },
    return: null,
  });
  postSpy.mockClear();
});

describe('bridge sync flags (A1.1)', () => {
  it('preview-only data with isTimeSynced:false posts isTimeSynced undefined; provider and language are kept', () => {
    removeFullPanelLines();
    setFiber(previewLine(), lyricsChain({
      trackUri: ROWS_URI,
      data: { isTimeSynced: false, syncType: 'LINE_SYNCED', provider: 'MusixMatch', language: 'hi' },
    }));

    w.slyScanSpotifyState();
    const payload = lastTrackUpdate()!;
    expect(payload.isTimeSynced).toBeUndefined();
    expect(payload.syncType).toBeNull();
    expect(payload.lyricsProvider).toBe('MusixMatch');
    expect(payload.language).toBe('hi');
    expect(payload.lyricsTrackUri).toBeNull();
  });

  it('a full-panel row reports isTimeSynced false and lyricsTrackUri', () => {
    setFiber(panelLine(), lyricsChain({
      trackUri: ROWS_URI,
      data: { isTimeSynced: false, syncType: 'UNSYNCED', provider: 'MusixMatch', language: 'en' },
    }));

    w.slyScanSpotifyState();
    const payload = lastTrackUpdate()!;
    expect(payload.isTimeSynced).toBe(false);
    expect(payload.syncType).toBe('UNSYNCED');
    expect(payload.lyricsProvider).toBe('MusixMatch');
    expect(payload.lyricsTrackUri).toBe(ROWS_URI);
    expect(payload.track.uri).toBe(TRACK_URI);
  });

  it('keeps an explicit props.isTimeSynced === false (no || fall-through)', () => {
    setFiber(panelLine(), lyricsChain({ isTimeSynced: false, provider: 'MusixMatch' }));

    w.slyScanSpotifyState();
    expect(lastTrackUpdate()!.isTimeSynced).toBe(false);
  });

  it('reports true from a full-panel row and the first string trackUri on the chain', () => {
    setFiber(panelLine(), {
      memoizedProps: { trackUri: 42 },
      return: { memoizedProps: { trackUri: ROWS_URI, data: { isTimeSynced: true } }, return: { memoizedProps: { trackUri: TRACK_URI }, return: null } },
    });

    w.slyScanSpotifyState();
    const payload = lastTrackUpdate()!;
    expect(payload.isTimeSynced).toBe(true);
    expect(payload.lyricsTrackUri).toBe(ROWS_URI);
  });

  it('an NPV-located failNode contributes no sync flag (provider still read)', () => {
    document.querySelectorAll('[data-testid="lyrics-line"]').forEach(el => el.remove());
    const npv = document.querySelector('[data-testid="lyrics-npv-section"]') ?? document.querySelector('aside');
    const failNode = document.createElement('div');
    failNode.className = 'hfTlyhd7WCIk9xmP';
    failNode.textContent = 'Invented error text';
    npv!.appendChild(failNode);
    setFiber(failNode, lyricsChain({
      trackUri: ROWS_URI,
      data: { isTimeSynced: false, syncType: 'UNSYNCED', provider: 'MusixMatch' },
    }));

    w.slyScanSpotifyState();
    const payload = lastTrackUpdate()!;
    expect(payload.isTimeSynced).toBeUndefined();
    expect(payload.syncType).toBeNull();
    expect(payload.lyricsTrackUri).toBeNull();
    expect(payload.lyricsProvider).toBe('MusixMatch');
  });
});

describe('state copy of lyricsTrackUri (A1.1)', () => {
  it('stores a string lyricsTrackUri and null otherwise', async () => {
    postSpy.mockRestore();
    const { initSlyState, spotifyState } = await import('../../lib/slyCore/state');
    initSlyState();
    const deliver = (payload: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', {
      data: { source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_TRACK_UPDATE', payload } },
      source: window as any,
    }));

    deliver({ track: { uri: TRACK_URI, name: 'Test Song' }, lyricsTrackUri: ROWS_URI });
    expect((spotifyState as any).lyricsTrackUri).toBe(ROWS_URI);

    deliver({ track: { uri: TRACK_URI, name: 'Test Song' }, lyricsTrackUri: 7 });
    expect((spotifyState as any).lyricsTrackUri).toBeNull();

    deliver({ track: { uri: TRACK_URI, name: 'Test Song' } });
    expect((spotifyState as any).lyricsTrackUri).toBeNull();
    postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });
});
