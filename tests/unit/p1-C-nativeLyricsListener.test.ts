import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../lib/core/lyricsCache', () => ({
  loadSongCache: vi.fn().mockResolvedValue(undefined),
  deleteSongCache: vi.fn(),
}));

import { setupMessageListener } from '../../lib/core/messageListener';
import { StateStore } from '../../lib/core/store';
import { getLyricsLines } from '../../lib/dom/domQueries';
import { hashString } from '../../lib/utils/hashUtils';

// Synthetic Oct-2026 overlay: 7 rows, playing track id from the Now Playing view link.
const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf-8');
const TRACK_ID = '4UMIv5jd9gK98a39BQRD9X';
// Invented Devanagari stand-ins, one per line of Spotify's 8-line response (last one empty).
const NATIVE_8 = ['पंक्ति एक', 'पंक्ति दो', '♪', 'पंक्ति तीन', 'पंक्ति चार', 'पंक्ति पाँच', 'पंक्ति छह', ''];

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

function post(action: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    origin: 'https://open.spotify.com',
    data: { source: 'SLY_ACTION_GATEWAY', action },
  }));
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('p1-C messageListener: late SKL_NATIVE_LYRICS (K5)', () => {
  let store: StateStore;
  let switchMode: ReturnType<typeof vi.fn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loadFixture();
    (window as any).spotifyState = { track: null };
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    store = new StateStore();
    store.songKey = 'Now playing: Test Song by Test Artist';
    store.cache.original = getLyricsLines().map(el => el.textContent ?? '');
    switchMode = vi.fn().mockResolvedValue(undefined);
    setupMessageListener(store, switchMode as any);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleLog.mockRestore();
    document.body.innerHTML = '';
  });

  it('applies the late lines to the rows and adopts the hash of what was applied', async () => {
    post({
      type: 'SKL_NATIVE_LYRICS',
      trackId: TRACK_ID,
      nativeLines: NATIVE_8,
      isRomanizedUpgrade: true,
      canonHash: 1234567, // the interceptor's hash of its own array; must not be trusted blindly
      late: true,
      spotifyLineCount: 8,
    });
    await flush();
    await flush();

    expect(store.cache.original).toEqual(NATIVE_8.slice(0, 7));
    expect(getLyricsLines()[0].textContent).toBe('पंक्ति एक');
    const appliedHash = hashString(store.cache.original.join('|'));
    expect(store.canonicalHash).toBe(appliedHash);
    expect(store.canonicalHashes.get(TRACK_ID)).toBe(appliedHash);
  });

  it('keeps the existing canonical hash when a late upgrade is ignored', async () => {
    store.canonicalHash = 42;
    post({
      type: 'SKL_NATIVE_LYRICS',
      trackId: TRACK_ID,
      nativeLines: NATIVE_8.slice(0, 7), // 7 lines vs Spotify's 8: rejected (slyCore forces Layer 2)
      isRomanizedUpgrade: true,
      canonHash: 1234567,
      late: true,
      spotifyLineCount: 8,
    });
    await flush();
    await flush();

    expect(store.canonicalHash).toBe(42);
    expect(store.cache.original[0]).toBe('Mera dil tera hai, tu kahan hai yaar');
  });
});
