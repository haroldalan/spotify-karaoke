/**
 * Live round 3: for a track whose Spotify lyrics are a romanized fallback, a fetched
 * fallback that is romanized too (Malang Sajna from YouTube Music) must not replace
 * Spotify's synced lines. Invented data only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { slyInternalState, spotifyState } from '../../lib/slyCore/state';
import { slyPreFetchRegistry } from '../../lib/slyCore/preFetch';
import '../../lib/slyCore/styles';
import '../../lib/slyCore/domEngine';
import { TakeoverEngine } from '../../lib/slyCore/takeoverEngine';

const URI = 'spotify:track:0000000000000000000Rom';
const store = { preferredMode: 'original', currentActiveLang: 'en', songKey: 'Now playing: Invented by Someone' } as any;

beforeEach(() => {
  document.body.innerHTML = '';
  slyPreFetchRegistry.states.clear();
  slyInternalState.failedFetchUris.clear();
  slyInternalState.l0Cache.clear();
  (spotifyState as any).track = { uri: URI, name: 'Invented' };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('romanized fallback for a romanized track', () => {
  it('is refused: Spotify keeps its own lyrics, no takeover, no retry this session', async () => {
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { nativeStatus: 'ROMANIZED', reason: 'Network Intercept' });
    slyInternalState.l0Cache.set(URI, { _slyUri: URI });
    await TakeoverEngine.executeTakeover({ _slyUri: URI, isSynced: true, syncedLyrics: '[00:01.00]mera dil tera hai\n[00:05.00]tu kahan hai yaar' }, store, () => {});
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(slyInternalState.failedFetchUris.has(URI)).toBe(true);
    expect(slyInternalState.l0Cache.has(URI)).toBe(false);
  });

  it('native-script lyrics for the same track are not refused', async () => {
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { nativeStatus: 'ROMANIZED', reason: 'Network Intercept' });
    await TakeoverEngine.executeTakeover({ _slyUri: URI, isSynced: true, syncedLyrics: '[00:01.00]यह एक परीक्षण पंक्ति है\n[00:05.00]यह दूसरी पंक्ति है' }, store, () => {});
    expect(slyInternalState.failedFetchUris.has(URI)).toBe(false);
  });

  it('a track with no Spotify lyrics (MISSING) still gets a Latin fallback', async () => {
    slyPreFetchRegistry.register(URI, 'MISSING', { nativeStatus: 'MISSING', reason: 'Network Intercept (404)' });
    await TakeoverEngine.executeTakeover({ _slyUri: URI, isSynced: true, syncedLyrics: '[00:01.00]an invented english line' }, store, () => {});
    expect(slyInternalState.failedFetchUris.has(URI)).toBe(false);
  });
});
