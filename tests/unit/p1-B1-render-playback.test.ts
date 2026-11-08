/**
 * Phase-1 group B1: slyCore render + playback against Spotify's 2026 lyrics overlay.
 * Uses the synthetic fixture tests/fixtures/spotify-2026-lyrics-panel.html (real Oct-2026
 * DOM structure, invented text). No real lyrics, no personal data.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import '../../lib/slyCore/scavenger';
import '../../lib/slyCore/styles';
import '../../lib/slyCore/playback';
import {
  slyGetLayoutHost,
  slyGetEncorePrefix,
  slyUntagLayoutHost,
} from '../../lib/slyCore/domEngine';
import { StatusEngine } from '../../lib/slyCore/statusEngine';
import { TakeoverEngine } from '../../lib/slyCore/takeoverEngine';
import '../../lib/slyCore/ui';

/** Spotify's panel in a state with no lyrics on screen (its loading or error state): the
 *  only kind of panel a status screen may be drawn in (statusEngine spotifyLyricsOnScreen). */
const noSpotifyWords = () => document.querySelectorAll('div.bm5I7yGVN8NXt6vH9eiC [data-testid="lyrics-line"]').forEach((l) => { l.textContent = ''; });


const FIXTURE_HTML = readFileSync(
  resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'),
  'utf8',
);

const w = window as any;

/** Default class dictionary snapshot so one test's scavenge does not leak into the next. */
const DEFAULT_CLASSES = { ...w.SPOTIFY_CLASSES };

function loadFixture(): void {
  const doc = new DOMParser().parseFromString(FIXTURE_HTML, 'text/html');
  document.body.className = doc.body.className;
  document.body.innerHTML = doc.body.innerHTML;
  document.getElementById('sly-core-styles')?.remove();
}

const themedPanel = () =>
  document.querySelector('div.bm5I7yGVN8NXt6vH9eiC') as HTMLElement;
const npvPreview = () =>
  document.querySelector('div.FOuUnTRQ4vzmdpbFOSWp') as HTMLElement;
const playlistMain = () => document.querySelector('main') as HTMLElement;
const lyricsButton = () =>
  document.querySelector('[data-testid="lyrics-button"]') as HTMLElement;
const progressInput = () =>
  document.querySelector('[data-testid="playback-progressbar"] input[type="range"]') as HTMLInputElement;
const progressBar = () =>
  document.querySelector('[data-testid="progress-bar"]') as HTMLElement;
const playPause = () =>
  document.querySelector('[data-testid="control-button-playpause"]') as HTMLElement;

function closeLyricsButton(): void {
  lyricsButton().setAttribute('data-active', 'false');
  lyricsButton().setAttribute('aria-pressed', 'false');
}

/**
 * jsdom clamps range values but does not round them to `step` like Chrome/Firefox do
 * (HTML spec: step mismatch → nearest step-aligned value). Emulate the browser so the
 * test can tell a snapped write from an exact one.
 */
function emulateBrowserStepSnapping(input: HTMLInputElement): void {
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() {
      return native.get!.call(this);
    },
    set(v: string) {
      let n = Number(v);
      const step = this.getAttribute('step');
      if (step && step !== 'any' && Number.isFinite(Number(step)) && Number(step) > 0) {
        const s = Number(step);
        const min = Number(this.getAttribute('min') || 0);
        n = Math.round((n - min) / s) * s + min;
      }
      native.set!.call(this, String(n));
    },
  });
}

let nowMs = 1000;

beforeEach(() => {
  loadFixture();
  for (const key of Object.keys(w.SPOTIFY_CLASSES)) {
    if (!(key in DEFAULT_CLASSES)) delete w.SPOTIFY_CLASSES[key];
  }
  Object.assign(w.SPOTIFY_CLASSES, DEFAULT_CLASSES);
  w.spotifyState.track = null;
  // Reset module-level state left by earlier tests.
  StatusEngine.clear();
  slyUntagLayoutHost();
  w.slyInternalState.customRoot = null;
  w.slyInternalState.currentLyrics = null;
  w.slyInternalState.slySyncedRendererActive = false;
  w.slyInternalState.lastActiveIndex = -1;
  w.slyInternalState.syncAnimFrame = null;
  w.antigravitySyncAnimFrame = undefined;
  w.slyResetPlaybackExtrapolator();
  nowMs = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** vitest's jsdom globals make `view: window` fail jsdom's Window type check; drop `view` in tests only. */
function stubPointerEventsWithoutView(): void {
  const RealPointerEvent = window.PointerEvent;
  const RealMouseEvent = window.MouseEvent;
  vi.stubGlobal('PointerEvent', class extends RealPointerEvent {
    constructor(type: string, init: PointerEventInit = {}) {
      const { view: _view, ...rest } = init;
      super(type, rest);
    }
  });
  vi.stubGlobal('MouseEvent', class extends RealMouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
      const { view: _view, ...rest } = init;
      super(type, rest);
    }
  });
}

// ─── Playback clock ───────────────────────────────────────────────────────────

describe('slyGetPlaybackSeconds on the 2026 player bar', () => {
  it('reads the slider value ATTRIBUTE (exact ms), never the step-snapped .value property', () => {
    const input = progressInput();
    emulateBrowserStepSnapping(input);
    input.value = input.getAttribute('value')!; // browser-side property is snapped to 20000
    expect(input.value).toBe('20000');

    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('uses the exact ms duration for the transform (no whole-second floor)', () => {
    // Force the transform path: no value attribute.
    progressInput().removeAttribute('value');
    // 5.554933532649646% of 330.463 s = 18.357 s (floored 330 s would give 18.331 s).
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);

    // Same result from spotifyState's duration_ms when the slider max is unavailable.
    progressInput().removeAttribute('max');
    w.spotifyState.track = { uri: 'spotify:track:test', duration_ms: 330463 };
    w.slyResetPlaybackExtrapolator();
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('extrapolates with the wall clock while control-button-playpause says "Pause"', () => {
    expect(playPause().getAttribute('aria-label')).toBe('Pause');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
    nowMs += 500;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.857, 3);

    // Spotify's next tick rewrites the bar: re-baseline on the new exact value.
    nowMs += 500;
    progressInput().setAttribute('value', '19357');
    progressBar().style.setProperty('--progress-bar-transform', `${(19357 / 330463) * 100}%`);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(19.357, 3);
    nowMs += 250;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(19.607, 3);
  });

  it('does not extrapolate when paused (aria-label "Play")', () => {
    playPause().setAttribute('aria-label', 'Play');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
    nowMs += 800;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('still honours the legacy control-button-pause testid', () => {
    playPause().remove();
    const legacy = document.createElement('button');
    legacy.setAttribute('data-testid', 'control-button-pause');
    document.querySelector('[data-testid="player-controls"]')!.appendChild(legacy);
    w.slyGetPlaybackSeconds();
    nowMs += 400;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.757, 3);
  });

  it('removes the animation lead (--progress-bar-duration) only while playing', () => {
    progressBar().style.setProperty('--progress-bar-duration', '1000ms');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(17.357, 3);
    playPause().setAttribute('aria-label', 'Play');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('re-baselines after a track-change reset even when the new position is 0:00', () => {
    progressInput().setAttribute('value', '0');
    progressBar().style.setProperty('--progress-bar-transform', '0%');
    nowMs = 600_000; // performance.now() is large in a long session
    w.slyResetPlaybackExtrapolator();
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(0, 3);
    nowMs += 500;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(0.5, 3);
  });
});

// ─── data-test-position + language-independent play state (C5 / C11) ─────────

describe('slyGetPlaybackSeconds: data-test-position and play state without the English label', () => {
  const durationEl = () =>
    document.querySelector('[data-testid="playback-duration"]') as HTMLElement;

  /**
   * One Spotify tick on the loaded fixture copy, shaped like the real 2026-10/11 bar:
   * data-test-position = exact position; slider value attribute and transform = position + lead.
   */
  function tick(positionMs: number, { leadMs = 1000, testPosition = true } = {}): void {
    const target = positionMs + leadMs;
    const input = progressInput();
    input.setAttribute('value', String(target));
    progressBar().style.setProperty('--progress-bar-transform', `${(target / Number(input.getAttribute('max'))) * 100}%`);
    progressBar().style.setProperty('--progress-bar-duration', `${leadMs}ms`);
    if (testPosition) durationEl().setAttribute('data-test-position', String(positionMs));
  }

  it('reads data-test-position (no transition lead) on the 2026-11 bar, playing or paused', () => {
    const doc = new DOMParser().parseFromString(
      readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf8'),
      'text/html',
    );
    document.body.innerHTML = doc.body.innerHTML;
    // The real bar: value attribute = data-test-position + 1000 ms, --progress-bar-duration 1000ms.
    expect(progressInput().getAttribute('value')).toBe('67331');
    progressBar().style.setProperty('--progress-bar-duration', '1000ms');
    durationEl().setAttribute('data-test-position', '66331');
    w.slyResetPlaybackExtrapolator();

    expect(playPause().getAttribute('aria-label')).toBe('Pause');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(66.331, 3);

    playPause().setAttribute('aria-label', 'Play');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(66.331, 3); // no lead to remove while paused either
  });

  it('prefers data-test-position over the slider value attribute', () => {
    durationEl().setAttribute('data-test-position', '18000');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.0, 3);
  });

  it('ignores a data-test-position that disagrees with the slider (stale attribute)', () => {
    durationEl().setAttribute('data-test-position', '5000');
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('extrapolates with a localized pause label ("Pausieren") once the position moves', () => {
    playPause().setAttribute('aria-label', 'Pausieren');
    tick(17357);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(17.357, 3);
    nowMs += 500;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(17.357, 3); // no motion seen yet

    nowMs += 500;
    tick(18357);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
    nowMs += 500;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.857, 3);

    nowMs += 500;
    tick(19357);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(19.357, 3);
    nowMs += 250;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(19.607, 3);
  });

  it('stops extrapolating 1.5 s after the position stalls (localized label)', () => {
    playPause().setAttribute('aria-label', 'Pausieren');
    tick(17357);
    w.slyGetPlaybackSeconds();
    nowMs += 1000;
    tick(18357);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);

    nowMs += 1000;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(19.357, 3); // still within the motion window
    nowMs += 600; // 1.6 s without a tick
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
    nowMs += 5000;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('removes the slider lead when motion (not the label) says playing', () => {
    playPause().setAttribute('aria-label', 'Pausar');
    tick(17357, { testPosition: false });
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3); // not known to be playing yet: raw target
    nowMs += 1000;
    tick(18357, { testPosition: false });
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3); // 19.357 target minus the 1000 ms lead
    nowMs += 500;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.857, 3);
  });

  it('does not treat a forward seek as playback (localized label)', () => {
    playPause().setAttribute('aria-label', 'Pausar');
    tick(17357);
    w.slyGetPlaybackSeconds();
    nowMs += 100;
    tick(47357);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(47.357, 3);
    nowMs += 800;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(47.357, 3);
  });

  it('the English "Play" label means paused even while the position moves', () => {
    playPause().setAttribute('aria-label', 'Play');
    tick(17357);
    w.slyGetPlaybackSeconds();
    nowMs += 1000;
    tick(18357);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
    nowMs += 500;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(18.357, 3);
  });

  it('a track-change reset forgets the previous track\'s motion', () => {
    playPause().setAttribute('aria-label', 'Pausar');
    tick(17357);
    w.slyGetPlaybackSeconds();
    nowMs += 1000;
    tick(18357);
    w.slyGetPlaybackSeconds();

    w.slyResetPlaybackExtrapolator();
    tick(0);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(0, 3);
    nowMs += 500;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(0, 3);
    nowMs += 500;
    tick(1000);
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(1.0, 3);
    nowMs += 250;
    expect(w.slyGetPlaybackSeconds()).toBeCloseTo(1.25, 3);
  });
});

// ─── Seeking ──────────────────────────────────────────────────────────────────

describe('slySeekTo Layer 1 (hidden range input)', () => {
  it('delivers the exact millisecond value despite step=5000, then restores the step', () => {
    const input = progressInput();
    emulateBrowserStepSnapping(input);
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(`input:${input.value}`));
    input.addEventListener('change', () => seen.push(`change:${input.value}`));
    const barClick = vi.fn();
    progressBar().addEventListener('click', barClick);

    w.slySeekTo(47.82);

    expect(seen).toEqual(['input:47820', 'change:47820']);
    expect(input.getAttribute('step')).toBe('5000');
    expect(barClick).not.toHaveBeenCalled(); // Layer 1 succeeded, no pointer fallback
  });

  it('sanity: the emulated browser snaps a plain write to the 5 s grid', () => {
    const input = progressInput();
    emulateBrowserStepSnapping(input);
    input.value = '47820';
    expect(input.value).toBe('50000');
  });

  it('falls through to the pointer layer when the value cannot be applied', () => {
    stubPointerEventsWithoutView();
    const input = progressInput();
    // A slider that refuses writes (value stays where React left it).
    Object.defineProperty(input, 'value', { configurable: true, get: () => '18357', set: () => {} });
    const inputEvents = vi.fn();
    input.addEventListener('input', inputEvents);
    const pointerDown = vi.fn();
    progressBar().addEventListener('pointerdown', pointerDown);

    w.slySeekTo(47.82);

    expect(inputEvents).not.toHaveBeenCalled();
    expect(pointerDown).toHaveBeenCalledTimes(1);
    expect(input.getAttribute('step')).toBe('5000');
  });
});

// ─── HUD show / clear ─────────────────────────────────────────────────────────

describe('StatusEngine show → clear on the 2026 overlay', () => {
  beforeEach(() => noSpotifyWords());
  it('hides the full themed panel (not the NPV preview) and restores it on clear()', () => {
    const themed = themedPanel();
    StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Test Song', artist: 'Test Artist' });

    expect(document.getElementById('sly-status-hud')).not.toBeNull();
    expect(themed.style.display).toBe('none');
    expect(npvPreview().style.display).toBe('');
    const root = document.getElementById('lyrics-root-sync')!;
    expect(root.parentElement).toBe(themed.parentElement);

    // Stand-down after a failed fetch: only StatusEngine.clear() runs.
    StatusEngine.clear();

    expect(themed.style.display).toBe('');
    expect(document.getElementById('sly-status-hud')).toBeNull();
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(w.slyInternalState.statusHUDActive).toBe(false);
    expect(w.slyInternalState.customRoot).toBeNull();
  });

  it('restores the panel even if a rebuild already wiped the HUD out of the root', () => {
    const themed = themedPanel();
    StatusEngine.show('Fetching [Title]', 'Searching...', false, {});
    document.getElementById('lyrics-root-sync')!.innerHTML = '';
    StatusEngine.clear();
    expect(themed.style.display).toBe('');
    expect(themed.parentElement!.classList.contains('sly-hud-active')).toBe(false);
  });

  it('keeps the native panel hidden when a takeover already rendered lines', () => {
    const themed = themedPanel();
    StatusEngine.show('Fetching [Title]', 'Searching...', false, {});
    const root = document.getElementById('lyrics-root-sync')!;
    const line = document.createElement('div');
    line.setAttribute('data-testid', 'lyrics-line');
    root.appendChild(line);

    StatusEngine.clear();

    expect(themed.style.display).toBe('none');
    expect(document.getElementById('lyrics-root-sync')).toBe(root);
    expect(themed.parentElement!.classList.contains('sly-active')).toBe(true);
    expect(themed.parentElement!.classList.contains('sly-hud-active')).toBe(false);
  });

  it('builds the error CTA with the live Encore prefix, never e-10451', () => {
    StatusEngine.show('No lyrics', 'Help out', true, { title: 'Test Song', artist: 'Test Artist' });
    const hud = document.getElementById('sly-status-hud')!;
    expect(hud.innerHTML).not.toContain('e-10451');
    expect(hud.querySelector('#sly-hud-lrc-btn span')!.className).toContain('e-10860-legacy-button--medium');
    expect(hud.querySelector('#sly-hud-retry-btn span')!.className).toContain('e-10860-overflow-wrap-anywhere');
  });

  it('derives the Encore prefix from a live [data-encore-id] element', () => {
    document.querySelectorAll('[data-encore-id]').forEach(el => {
      el.setAttribute('class', (el.getAttribute('class') || '').replace(/e-10860-/g, 'e-11111-'));
    });
    expect(slyGetEncorePrefix()).toBe('e-11111-');
    StatusEngine.show('No lyrics', 'Help out', true, {});
    const span = document.querySelector('#sly-hud-retry-btn span')!;
    expect(span.className).toContain('e-11111-legacy-button--medium');

    // No live Encore element at all → scavenged classes, then e-101040-.
    document.querySelectorAll('[data-encore-id]').forEach(el => el.removeAttribute('data-encore-id'));
    expect(slyGetEncorePrefix()).toBe('e-101040-');
  });
});

// ─── K11: sly-active / layout lock placement ─────────────────────────────────

describe('K11 layout host', () => {
  beforeEach(() => noSpotifyWords());
  it('puts sly-active and the HUD lock on the themed panel parent, not on the playlist <main>', () => {
    const host = themedPanel().parentElement!;
    expect(slyGetLayoutHost()).toBe(host);

    StatusEngine.show('Fetching [Title]', 'Searching...', false, {});
    expect(host.classList.contains('sly-active')).toBe(true);
    expect(host.classList.contains('sly-hud-active')).toBe(true);
    expect(playlistMain().classList.contains('sly-active')).toBe(false);
    expect(playlistMain().classList.contains('sly-hud-active')).toBe(false);
    expect(document.querySelector('aside')!.classList.contains('sly-active')).toBe(false);

    StatusEngine.clear();
    expect(host.classList.contains('sly-active')).toBe(false);
    expect(host.classList.contains('sly-hud-active')).toBe(false);
  });

  it('layout-lock CSS is keyed on the class, so it applies to the K11 host', () => {
    StatusEngine.show('Fetching [Title]', 'Searching...', false, {});
    const css = document.getElementById('sly-core-styles')!.textContent!;
    expect(css).toMatch(/(^|\s)\.sly-hud-active[^{]*\{/);
    // ...but never on Spotify's Now Playing overlay (it keeps its own layout).
    expect(css).toContain('.sly-hud-active:not([data-testid="root"] > div > div)');
  });

  it('TakeoverEngine.purge restores the themed panel and removes sly-active from the same host', () => {
    const host = themedPanel().parentElement!;
    const root = w.slyPrepareContainer();
    expect(root).not.toBeNull();
    expect(w.slyInternalState.customRoot).toBe(root);
    themedPanel().style.display = 'none';
    root.appendChild(document.createElement('div'));

    TakeoverEngine.purge();

    expect(host.classList.contains('sly-active')).toBe(false);
    expect(themedPanel().style.display).toBe('');
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(w.slyInternalState.customRoot).toBeNull();
  });

  it('track reset (slyResetPlayerState) clears sly-active from the K11 host and restores the panel', () => {
    const host = themedPanel().parentElement!;
    StatusEngine.show('Fetching [Title]', 'Searching...', false, {});
    // Simulate older code that also tagged the playlist <main>.
    w.SPOTIFY_CLASSES.mainContainer = 'TKq2Yidc5rgHzpJFRFYW';
    playlistMain().classList.add('sly-active');

    w.slyResetPlayerState('Next Song', 'spotify:track:0000000000000000000Ccc');

    expect(host.classList.contains('sly-active')).toBe(false);
    expect(host.classList.contains('sly-hud-active')).toBe(false);
    expect(playlistMain().classList.contains('sly-active')).toBe(false);
    expect(themedPanel().style.display).toBe('');
  });

  it('without a themed panel (track without Spotify lyrics) the root goes inside the Now Playing overlay, never over the whole page', () => {
    themedPanel().remove();
    npvPreview().remove();
    w.SPOTIFY_CLASSES.mainContainer = 'TKq2Yidc5rgHzpJFRFYW';
    const overlay = document.querySelector('button[role="radio"][value="lyrics"]')!.closest('[data-testid="root"] > div > div')!;
    expect(slyGetLayoutHost()).toBe(overlay);

    // Live round 2: the root went under [data-testid="root"] and sly-active onto the
    // playlist <main>, so the HUD covered the whole page, player bar included.
    const root = w.slyPrepareContainer();
    expect(root.parentElement).toBe(overlay);
    expect(root.classList.contains('sly-root-overlay')).toBe(true);
    expect(overlay.classList.contains('sly-active')).toBe(true);
    expect(playlistMain().classList.contains('sly-active')).toBe(false);
    expect(document.querySelector('[data-testid="now-playing-bar"]')!.contains(root)).toBe(false);

    slyUntagLayoutHost('sly-active');
    expect(overlay.classList.contains('sly-active')).toBe(false);
  });

  it('without a themed panel the status goes on our Lyrics button, never over Spotify\'s artwork and cards', () => {
    themedPanel().remove();
    npvPreview().remove();
    const option = document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]')!;
    option.disabled = true; // Spotify has no lyrics for the song
    const overlay = option.closest('[data-testid="root"] > div > div')!;
    const retry = vi.fn();
    w.slyTriggerLyricsFetch = retry;

    StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Invented Song', artist: 'Invented Artist' });
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(document.getElementById('sly-status-hud')).toBeNull();
    expect(overlay.classList.contains('sly-hud-active')).toBe(false);
    const chip = document.getElementById('sly-lyrics-chip')!;
    expect(chip.previousElementSibling).toBe(option);
    expect(chip.classList.contains('sly-chip-searching')).toBe(true);
    const label = document.getElementById('sly-lyrics-status')!;
    expect(label.nextElementSibling).toBe(option.parentElement); // beside the media switch
    expect(label.textContent).toBe('Finding lyrics…');
    expect(label.getAttribute('role')).toBe('status');
    expect(StatusEngine.isShowing()).toBe(true);

    StatusEngine.show('Even Spotify Karaoke couldn\'t find the lyrics for this song.', 'Add them to LRCLIB.', true,
      { title: 'Invented Song', artist: 'Invented Artist', uri: 'spotify:track:0000000000000000000Inv' });
    expect(chip.classList.contains('sly-chip-notfound')).toBe(true);
    expect(chip.classList.contains('sly-chip-searching')).toBe(false);
    expect(label.textContent).toBe('No lyrics found');
    chip.click();
    const pop = document.getElementById('sly-lyrics-popover')!;
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    const add = pop.querySelector('a')!;
    expect(add.textContent).toBe('Add lyrics');
    expect(add.getAttribute('href')).toContain('title=Invented+Song');
    expect(add.target).toBe('_blank');
    pop.querySelector('button')!.click(); // Retry
    expect(retry).toHaveBeenCalledWith('Invented Song', 'Invented Artist', expect.any(String),
      'spotify:track:0000000000000000000Inv', true, undefined, undefined);
    expect(document.getElementById('sly-lyrics-popover')).toBeNull();

    StatusEngine.clear();
    expect(document.getElementById('sly-lyrics-chip')).toBeNull();
    expect(document.getElementById('sly-lyrics-status')).toBeNull();
    expect(StatusEngine.isShowing()).toBe(false);
    delete w.slyTriggerLyricsFetch;
  });

  it('without Spotify\'s media switch the status is a toast, gone when cleared', () => {
    themedPanel().remove();
    npvPreview().remove();
    const option = document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]')!;
    const overlay = option.closest('[data-testid="root"] > div > div')!;
    // The switch is gone, but the overlay is still Spotify's Now Playing view.
    option.parentElement!.querySelectorAll('button[role="radio"]').forEach(b => { if (b !== option) b.remove(); });
    option.style.display = 'none';
    option.disabled = false; // not our case: Spotify's option is usable, so our button stays out
    StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Invented Song' });
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(document.getElementById('sly-lyrics-chip')).toBeNull();
    const toast = document.getElementById('sly-toast')!;
    expect(toast.textContent).toBe('Finding lyrics…');
    expect(toast.classList.contains('visible')).toBe(true);
    StatusEngine.clear();
    expect(toast.classList.contains('visible')).toBe(false);
    expect(overlay.contains(document.getElementById('sly-status-hud'))).toBe(false);
  });

  it('Spotify\'s lyrics on screen: no status over them; shown once they are gone (previous track\'s panel)', () => {
    vi.useFakeTimers();
    try {
      document.querySelector('div.bm5I7yGVN8NXt6vH9eiC [data-testid="lyrics-line"]')!.textContent = 'Invented line';
      StatusEngine.show('Fetching [Title]', 'Searching...', true, {});
      expect(document.getElementById('sly-status-hud')).toBeNull();
      expect(themedPanel().style.display).toBe('');
      noSpotifyWords(); // Spotify swapped the previous track's panel away
      vi.advanceTimersByTime(300);
      expect(document.getElementById('sly-status-hud')).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a themed panel without lyrics on screen (its error state): the status is the full HUD inside it', () => {
    StatusEngine.show('Fetching [Title]', 'Searching...', false, {});
    const root = document.getElementById('lyrics-root-sync')!;
    expect(root.classList.contains('sly-root-notice')).toBe(false);
    expect(root.classList.contains('sly-root-overlay')).toBe(false);
    expect(themedPanel().parentElement!.classList.contains('sly-hud-active')).toBe(true);
  });

  it('the legacy UI (no [data-testid="root"]) still falls back to main.<mainContainer>', () => {
    themedPanel().remove();
    npvPreview().remove();
    w.SPOTIFY_CLASSES.mainContainer = 'TKq2Yidc5rgHzpJFRFYW';
    document.querySelector('[data-testid="root"]')!.removeAttribute('data-testid');
    expect(slyGetLayoutHost()).toBe(playlistMain());
  });

  it('a root moved from the overlay back to a themed panel loses its overlay positioning', () => {
    const panel = themedPanel();
    const parent = panel.parentElement!;
    panel.remove();
    npvPreview().remove();
    const root = w.slyPrepareContainer();
    expect(root.classList.contains('sly-root-overlay')).toBe(true);
    parent.appendChild(panel); // Spotify's lyrics panel appears (e.g. lyrics loaded late)
    const again = w.slyPrepareContainer();
    expect(again).toBe(root);
    expect(root.parentElement).toBe(parent);
    expect(root.classList.contains('sly-root-overlay')).toBe(false);
  });
});

// ─── Panel-open checks ────────────────────────────────────────────────────────

describe('panel-open checks ignore NPV preview lines', () => {
  it('executeTakeover cancels when the lyrics button is inactive, even with preview lines in the aside', async () => {
    closeLyricsButton();
    expect(document.querySelectorAll('aside [data-testid="lyrics-line"]').length).toBeGreaterThan(0);
    const onTakeover = vi.fn();
    document.addEventListener('sly:takeover', onTakeover);

    await TakeoverEngine.executeTakeover(
      { isSynced: false, plainLyrics: 'Line A\nLine B' },
      { preferredMode: 'original' },
      () => {},
      true,
    );

    document.removeEventListener('sly:takeover', onTakeover);
    expect(onTakeover).not.toHaveBeenCalled();
    expect(document.querySelector('#lyrics-root-sync [data-testid="lyrics-line"]')).toBeNull();
  });
});

// ─── slyUpdateSync loop ───────────────────────────────────────────────────────

describe('slyUpdateSync RAF loop', () => {
  const LRC = '[00:01.00]Line one\n[00:05.00]Line two\n[00:10.00]Line three';
  let pending: Map<number, FrameRequestCallback>;
  const realGetPlaybackSeconds = w.slyGetPlaybackSeconds;

  afterEach(() => {
    w.slyGetPlaybackSeconds = realGetPlaybackSeconds;
  });

  beforeEach(() => {
    pending = new Map();
    let nextId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      pending.delete(id);
    });
    (Element.prototype as any).scrollIntoView = vi.fn();
  });

  function runFrame(): void {
    const callbacks = Array.from(pending.values());
    pending.clear();
    callbacks.forEach(cb => cb(performance.now()));
  }

  function buildSynced(): Record<string, any> {
    const lyricsObj: Record<string, any> = { isSynced: true, syncedLyrics: LRC };
    w.slyInternalState.currentLyrics = lyricsObj; // same object as the sly:inject detail
    const root = w.slyPrepareContainer();
    w.slyBuildLyricsList(root, lyricsObj);
    return lyricsObj;
  }

  it('keeps exactly one chain alive across repeated synced builds', () => {
    buildSynced();
    buildSynced();
    buildSynced();
    expect(pending.size).toBe(1);
    runFrame();
    expect(pending.size).toBe(1);
  });

  it('highlights the active line now that the custom root is tracked', () => {
    const lyricsObj = buildSynced();
    w.slyGetPlaybackSeconds = () => 6;

    runFrame();

    const els = lyricsObj.domElements as HTMLElement[];
    expect(els).toHaveLength(3);
    expect(els[1].classList.contains(w.SPOTIFY_CLASSES.activeLine)).toBe(true);
    expect(els[0].classList.contains(w.SPOTIFY_CLASSES.passedLine)).toBe(true);
    expect(els[2].classList.contains(w.SPOTIFY_CLASSES.futureLine)).toBe(true);
    expect(w.slyInternalState.lastActiveIndex).toBe(1);
  });

  it('idles (but stays alive) while the lyrics button is inactive', () => {
    const lyricsObj = buildSynced();
    w.slyGetPlaybackSeconds = () => 6;
    closeLyricsButton();

    runFrame();

    const els = lyricsObj.domElements as HTMLElement[];
    expect(els[1].classList.contains(w.SPOTIFY_CLASSES.activeLine)).toBe(false);
    expect(pending.size).toBe(1);
  });

  it('time back at the start of a track (the next song began): lines held, then followed', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const lyricsObj = buildSynced();
    const els = lyricsObj.domElements as HTMLElement[];
    w.slyGetPlaybackSeconds = () => 11;
    runFrame();
    expect(els[2].classList.contains(w.SPOTIFY_CLASSES.activeLine)).toBe(true);

    w.slyGetPlaybackSeconds = () => 0.2;
    now += 16;
    runFrame();
    now += 300;
    runFrame();
    expect(els[2].classList.contains(w.SPOTIFY_CLASSES.activeLine)).toBe(true);
    expect(pending.size).toBe(1);

    // No song change came: a restart of the same song. Followed after the hold.
    now += 300;
    runFrame();
    expect(els[0].classList.contains(w.SPOTIFY_CLASSES.activeLine)).toBe(true);
  });

  it('a seek back within the song is followed at once', () => {
    let now = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const lyricsObj = buildSynced();
    const els = lyricsObj.domElements as HTMLElement[];
    w.slyGetPlaybackSeconds = () => 11;
    runFrame();
    w.slyGetPlaybackSeconds = () => 6;
    now += 16;
    runFrame();
    expect(els[1].classList.contains(w.SPOTIFY_CLASSES.activeLine)).toBe(true);
  });
});

// ─── 2026-11-07: flicker — the theme mirror runs every poll tick ─────────────

describe('slyMirrorNativeTheme writes only what changed', () => {
  it('a second call with the same colours changes nothing, and the root keeps its own layout styles', async () => {
    const panel = themedPanel();
    panel.style.setProperty('--lyrics-color-active', 'rgb(1, 2, 3)');
    panel.style.setProperty('--lyrics-color-background', 'rgb(40, 50, 60)');
    const root = document.createElement('div');
    root.id = 'lyrics-root-sync';
    root.style.minHeight = '100%';
    panel.parentElement!.appendChild(root);
    w.slyMirrorNativeTheme(root, {}, panel);
    expect(root.style.getPropertyValue('--lyrics-color-active').trim()).toBe('rgb(1, 2, 3)');
    expect(root.style.minHeight).toBe('100%'); // not wiped by a cssText rewrite
    const changes: MutationRecord[] = [];
    const obs = new MutationObserver((list) => changes.push(...list));
    obs.observe(root, { attributes: true });
    obs.observe(panel, { attributes: true });
    w.slyMirrorNativeTheme(root, {}, panel);
    await Promise.resolve();
    obs.disconnect();
    expect(changes).toHaveLength(0);
    root.remove();
  });
});

describe('status popover keys', () => {
  it('Escape closes only the popover: Spotify never sees it, and focus goes back to the Lyrics button', () => {
    themedPanel().remove();
    npvPreview().remove();
    const option = document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]')!;
    option.disabled = true;
    StatusEngine.show('Even Spotify Karaoke couldn\'t find the lyrics for this song.', 'Add them.', true, { title: 'Invented Song', artist: 'Invented Artist' });
    const chip = document.getElementById('sly-lyrics-chip')!;
    chip.click();
    expect(document.getElementById('sly-lyrics-popover')).not.toBeNull();
    const spotifyHandler = vi.fn();
    document.addEventListener('keydown', spotifyHandler);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', spotifyHandler);
    expect(document.getElementById('sly-lyrics-popover')).toBeNull();
    expect(spotifyHandler).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chip);
    // Without a popover open, Escape is Spotify's again.
    const again = vi.fn();
    document.addEventListener('keydown', again);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', again);
    expect(again).toHaveBeenCalled();
    StatusEngine.clear();
  });
});
