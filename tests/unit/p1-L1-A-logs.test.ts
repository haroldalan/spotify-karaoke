/**
 * Live round 1, group A4: log lines that described something the code did not do.
 * - StatusEngine.clear(): "restoring native visibility" only when it really un-hides the panel.
 * - TakeoverEngine: the swap log names the track instead of "Unknown".
 * - events.ts: the OPEN bypass message says what the code does.
 * Synthetic 2026 lyrics-panel fixture (invented text only).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import '../../lib/slyCore/scavenger';
import '../../lib/slyCore/styles';
import { slyUntagLayoutHost } from '../../lib/slyCore/domEngine';
import { StatusEngine } from '../../lib/slyCore/statusEngine';
import { TakeoverEngine } from '../../lib/slyCore/takeoverEngine';
import '../../lib/slyCore/events';

/** Spotify's panel in a state with no lyrics on screen (its loading or error state): the
 *  only kind of panel a status screen may be drawn in (statusEngine spotifyLyricsOnScreen). */
const noSpotifyWords = () => document.querySelectorAll('div.bm5I7yGVN8NXt6vH9eiC [data-testid="lyrics-line"]').forEach((l) => { l.textContent = ''; });


const FIXTURE_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf8');
const w = window as any;
let logSpy: ReturnType<typeof vi.spyOn>;

const themedPanel = () => document.querySelector('div.bm5I7yGVN8NXt6vH9eiC') as HTMLElement;
const logged = (text: string) => logSpy.mock.calls.some((c: any[]) => String(c[0]).includes(text));

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const doc = new DOMParser().parseFromString(FIXTURE_HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  noSpotifyWords();
  StatusEngine.clear();
  slyUntagLayoutHost();
  w.slyInternalState.customRoot = null;
  w.spotifyState.track = null;
  logSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // events.ts watches the body for the lyrics button. With the extension context gone,
  // its observer disconnects on the next mutation instead of firing after jsdom teardown.
  const runtime = (globalThis as any).browser.runtime;
  const id = runtime.id;
  runtime.id = undefined;
  document.body.appendChild(document.createElement('div'));
  await new Promise(r => setTimeout(r, 0));
  runtime.id = id;
});

describe('StatusEngine.clear() log (A4)', () => {
  it('with takeover rows on screen: no "restoring native visibility", the panel stays hidden', () => {
    const themed = themedPanel();
    StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Test Song', artist: 'Test Artist' });
    StatusEngine.clear({ restoreNative: false });
    const root = document.getElementById('lyrics-root-sync')!;
    const row = document.createElement('div');
    row.setAttribute('data-testid', 'lyrics-line');
    row.textContent = 'Invented takeover row';
    root.appendChild(row);
    logSpy.mockClear();

    StatusEngine.clear();

    expect(themed.style.display).toBe('none');
    expect(logged('restoring native visibility')).toBe(false);
  });

  it('with no takeover rows: logs "restoring native visibility" and un-hides the panel', () => {
    const themed = themedPanel();
    StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Test Song', artist: 'Test Artist' });
    expect(themed.style.display).toBe('none');
    logSpy.mockClear();

    StatusEngine.clear();

    expect(themed.style.display).toBe('');
    expect(logged('restoring native visibility')).toBe(true);
  });
});

describe('TakeoverEngine swap log title (A4)', () => {
  it('falls back to the bridge track name, then the uri, before "Unknown"', async () => {
    // Mismatched uri: the swap aborts right after the log line.
    w.spotifyState.track = { uri: 'spotify:track:0000000000000000000Cur', name: 'Bridge Title' };
    await TakeoverEngine.executeTakeover({ _slyUri: 'spotify:track:0000000000000000000Old' }, {}, () => {});
    expect(logged('INITIATING 0ms SWAP for: "Bridge Title"')).toBe(true);

    w.spotifyState.track = { uri: 'spotify:track:0000000000000000000Cur' };
    logSpy.mockClear();
    await TakeoverEngine.executeTakeover({ _slyUri: 'spotify:track:0000000000000000000Old' }, {}, () => {});
    expect(logged('INITIATING 0ms SWAP for: "spotify:track:0000000000000000000Old"')).toBe(true);
  });
});

describe('lyrics button OPEN bypass log (A4)', () => {
  it('describes the real rule (only CLOSE is hijacked) and does not preventDefault', () => {
    const btn = document.querySelector('[data-testid="lyrics-button"]')!;
    btn.setAttribute('data-active', 'false');
    btn.setAttribute('aria-pressed', 'false');
    const ev = new Event('pointerdown', { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(logged('Not hijacking OPEN')).toBe(true);
    expect(logged('provider is not null')).toBe(false);
  });
});
