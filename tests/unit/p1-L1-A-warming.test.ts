/**
 * Live round 1, cross-group verification: a fallback fetched while the detector's
 * no-request MISSING was only a guess is stored by the background without a
 * nativeStatus (FetchEngine does not forward a heuristic status). On the next play
 * WarmingEngine must keep the defaulted MISSING marked as a guess, so the gated
 * self-heal applies and nothing guessed is reported as fact. Invented data only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { slyInternalState, spotifyState } from '../../lib/slyCore/state';
import { slyPreFetchRegistry } from '../../lib/slyCore/preFetch';
import '../../lib/slyCore/styles';
import '../../lib/slyCore/domEngine';
import '../../lib/slyCore/messaging';
import { WarmingEngine } from '../../lib/slyCore/warmingEngine';

const URI = 'spotify:track:0000000000000000000Wrm';
const entry = (nativeStatus?: string) => ({
  ok: true,
  found: true,
  data: { syncedLyrics: '[00:01.00]Invented line', isSynced: true },
  prefetchState: 'SYNCED',
  ...(nativeStatus ? { nativeStatus } : {}),
});

beforeEach(() => {
  document.body.innerHTML = '';
  slyInternalState.l0Cache.clear();
  slyPreFetchRegistry.states.clear();
  (spotifyState as any).track = { uri: URI, name: 'Song W', artists: [{ name: 'Artist W' }] };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('WarmingEngine hydration of a stored fallback', () => {
  it('a stored entry without a nativeStatus is registered as a guessed MISSING', () => {
    WarmingEngine.handleCacheResult({ uri: URI, title: 'Song W', artist: 'Artist W', result: entry() });
    const state = slyPreFetchRegistry.getState(URI);
    expect(state?.nativeStatus).toBe('MISSING');
    expect(state?.heuristic).toBe(true);
    expect(slyInternalState.l0Cache.get(URI)?._slyUri).toBe(URI);
  });

  it('a stored MISSING that Spotify really reported stays a fact', () => {
    WarmingEngine.handleCacheResult({ uri: URI, title: 'Song W', artist: 'Artist W', result: entry('MISSING') });
    const state = slyPreFetchRegistry.getState(URI);
    expect(state?.nativeStatus).toBe('MISSING');
    expect(state?.heuristic).toBeUndefined();
  });

  it('a stored native status other than MISSING is never marked as a guess', () => {
    WarmingEngine.handleCacheResult({ uri: URI, title: 'Song W', artist: 'Artist W', result: entry('ROMANIZED') });
    expect(slyPreFetchRegistry.getState(URI)?.heuristic).toBeUndefined();
  });
});
