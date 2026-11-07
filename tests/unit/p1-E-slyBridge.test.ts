/**
 * Phase 1 / group E — MAIN-world bridge (entrypoints/slyBridge.ts).
 *
 * The module is loaded once (vitest.setup.ts makes defineUnlistedScript run its
 * callback immediately) under fake timers, against the synthetic 2026 lyrics-panel
 * fixture. React fibers are simulated with `__reactFiber$test` properties.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_HTML = readFileSync(
  resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'),
  'utf8',
);
const FIXTURE_BODY = FIXTURE_HTML.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];

const FIBER_KEY = '__reactFiber$test';
const w = window as any;

function setFiber(el: Element | null, fiber: Record<string, unknown>): void {
  if (!el) throw new Error('fixture element missing');
  (el as any)[FIBER_KEY] = fiber;
}

/** Deliver a message the way the bridge sees it (jsdom's postMessage leaves event.source null). */
function deliver(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: window as any }));
}

function gateway(action: Record<string, unknown>): void {
  deliver({ source: 'SLY_ACTION_GATEWAY', action });
}

let setIntervalSpy: ReturnType<typeof vi.spyOn>;
let postSpy: ReturnType<typeof vi.spyOn>;

const shieldIntervalCalls = () =>
  setIntervalSpy.mock.calls.filter((c: any[]) => c[1] === 500).length;

function lastTrackUpdate(): Record<string, any> | undefined {
  const calls = postSpy.mock.calls
    .map((c: any[]) => c[0] as any)
    .filter((m: any) => m?.source === 'SLY_ACTION_GATEWAY' && m.action?.type === 'SLY_TRACK_UPDATE');
  return calls.length ? calls[calls.length - 1].action.payload : undefined;
}

beforeAll(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = FIXTURE_BODY;
  setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
  // Capture outgoing bridge messages without dispatching them.
  postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  await import('../../entrypoints/slyBridge');
});

afterAll(() => {
  w.slyDeactivateShield?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Flush pending one-shot timeouts (flicker guards) so only intervals remain.
  vi.advanceTimersByTime(1000);
  document.body.innerHTML = FIXTURE_BODY;
  postSpy.mockClear();
});

describe('shield interval (MUST-DO 1)', () => {
  it('starts exactly one 500 ms loop at load', () => {
    expect(shieldIntervalCalls()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('slyActivateShield() is idempotent', () => {
    for (let i = 0; i < 5; i++) w.slyActivateShield();
    expect(shieldIntervalCalls()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('SLY_TRIGGER_NATIVE_OPEN twice does not stack intervals', () => {
    gateway({ type: 'SLY_TRIGGER_NATIVE_OPEN' });
    gateway({ type: 'SLY_TRIGGER_NATIVE_OPEN' });
    // Let the 600 ms flicker-guard timeouts run.
    vi.advanceTimersByTime(700);
    expect(shieldIntervalCalls()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('SLY_TRIGGER_NATIVE_CLOSE keeps the scanner loop alive', () => {
    gateway({ type: 'SLY_TRIGGER_NATIVE_CLOSE' });
    vi.advanceTimersByTime(1500);
    expect(vi.getTimerCount()).toBe(1);
    expect(lastTrackUpdate()).toBeDefined();
  });

  it('slyDeactivateShield() stops the loop and slyActivateShield() restarts exactly one', () => {
    w.slyDeactivateShield();
    expect(vi.getTimerCount()).toBe(0);
    w.slyActivateShield();
    w.slyActivateShield();
    expect(vi.getTimerCount()).toBe(1);
    expect(shieldIntervalCalls()).toBe(2);
  });
});

describe('dead deep-scan removed (MUST-DO 2)', () => {
  it('has no slyConfigPool and no 10 s interval', () => {
    expect(w.slyConfigPool).toBeUndefined();
    expect(setIntervalSpy.mock.calls.some((c: any[]) => c[1] === 10000)).toBe(false);
    vi.advanceTimersByTime(10500);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('lyrics button label (MUST-DO 3)', () => {
  it('does not overwrite a localized aria-label', async () => {
    const btn = document.querySelector('[data-testid="lyrics-button"]')!;
    btn.setAttribute('aria-label', 'Letras');
    btn.setAttribute('disabled', '');
    vi.advanceTimersByTime(600); // tick: observer attaches, enforceDOMState runs
    await Promise.resolve();
    expect(btn.getAttribute('aria-label')).toBe('Letras');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });
});

describe('SLY_UPDATE_CLASSES envelopes (MUST-DO 4 / K9)', () => {
  it('accepts action.classes', () => {
    gateway({ type: 'SLY_UPDATE_CLASSES', classes: { errorContainer: 'aaaa1111' } });
    expect(w.SPOTIFY_CLASSES.errorContainer).toBe('aaaa1111');
  });

  it('accepts action.payload', () => {
    gateway({ type: 'SLY_UPDATE_CLASSES', payload: { errorContainer: 'bbbb2222' } });
    expect(w.SPOTIFY_CLASSES.errorContainer).toBe('bbbb2222');
  });

  it('accepts action.payload.classes', () => {
    gateway({ type: 'SLY_UPDATE_CLASSES', payload: { classes: { errorContainer: 'cccc3333', lineBase: 'dddd4444' } } });
    expect(w.SPOTIFY_CLASSES.errorContainer).toBe('cccc3333');
    expect(w.SPOTIFY_CLASSES.lineBase).toBe('dddd4444');
    expect(w.SPOTIFY_CLASSES.classes).toBeUndefined();
  });

  it("accepts the scavenger's bare { type, classes } message", () => {
    deliver({ type: 'SLY_UPDATE_CLASSES', classes: { errorContainer: 'eeee5555' } });
    expect(w.SPOTIFY_CLASSES.errorContainer).toBe('eeee5555');
  });

  it('ignores non-object payloads and non-string values', () => {
    gateway({ type: 'SLY_UPDATE_CLASSES', payload: 'nope' });
    gateway({ type: 'SLY_UPDATE_CLASSES', classes: { errorContainer: 42, lineBase: '' } });
    expect(w.SPOTIFY_CLASSES.errorContainer).toBe('eeee5555');
    expect(w.SPOTIFY_CLASSES.lineBase).toBe('dddd4444');
  });

  it('an unusable learned class does not break the scanner tick', () => {
    gateway({ type: 'SLY_UPDATE_CLASSES', classes: { errorContainer: 'bad class!' } });
    expect(() => w.slyScanSpotifyState()).not.toThrow();
  });
});

describe('SLY_TRACK_UPDATE payload (MUST-DO 5/6/7, K2)', () => {
  const panelLine = () =>
    Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
      .find(el => !el.closest('aside'))!;
  const previewLine = () =>
    document.querySelector('[data-testid="lyrics-npv-section"] [data-testid="lyrics-line"]')!;

  beforeEach(() => {
    setFiber(document.querySelector('[data-testid="context-item-info-title"]'), {
      memoizedProps: {
        item: { uri: 'spotify:track:0000000000000000000Ttt', name: 'Test Song', artists: [{ name: 'Test Artist' }] },
      },
      return: null,
    });
  });

  it('reads lyric props from a full-panel line, not the Now Playing preview', () => {
    setFiber(previewLine(), { memoizedProps: {}, return: { memoizedProps: { language: 'xx', provider: 'Preview' }, return: null } });
    setFiber(panelLine(), { memoizedProps: {}, return: { memoizedProps: { language: 'hi', provider: 'MusixMatch' }, return: null } });

    w.slyScanSpotifyState();
    const payload = lastTrackUpdate()!;
    expect(payload.language).toBe('hi');
    expect(payload.lyricsProvider).toBe('MusixMatch');
    expect(payload.track.uri).toBe('spotify:track:0000000000000000000Ttt');
  });

  it('falls back to a preview line when the full panel has no lines', () => {
    document.querySelectorAll('[data-testid="lyrics-line"]').forEach(el => {
      if (!el.closest('aside')) el.remove();
    });
    setFiber(previewLine(), { memoizedProps: {}, return: { memoizedProps: { language: 'ja' }, return: null } });

    w.slyScanSpotifyState();
    expect(lastTrackUpdate()!.language).toBe('ja');
  });

  it('also finds language under props.lyrics (color-lyrics shape)', () => {
    setFiber(panelLine(), { memoizedProps: { lyrics: { language: 'ru' } }, return: null });
    w.slyScanSpotifyState();
    expect(lastTrackUpdate()!.language).toBe('ru');
  });

  it('logs queue discovery from bridge-local state, not window.spotifyState', () => {
    const logSpy = vi.spyOn(console, 'log');
    setFiber(document.querySelector('#main-view'), {
      memoizedProps: {
        nextItems: [
          { uri: 'spotify:track:0000000000000000000Q01', name: 'Queued A', artists: [{ name: 'X' }] },
          { uri: 'spotify:track:0000000000000000000Q02', name: 'Queued B', artists: [{ name: 'Y' }] },
        ],
      },
      return: null,
    });
    expect(w.spotifyState).toBeUndefined();

    for (let i = 0; i < 4; i++) w.slyScanSpotifyState();
    const discovered = logSpy.mock.calls.filter(c => String(c[0]).includes('items in local queue'));
    expect(discovered.length).toBe(1);
    expect(lastTrackUpdate()!.queue).toHaveLength(2);
    logSpy.mockRestore();
  });
});
