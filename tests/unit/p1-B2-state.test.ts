/**
 * Group B2 (phase 1): K2 (bridge language copied into spotifyState) and K7 (cache reset).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  initSlyState,
  normalizeLanguageTag,
  spotifyState,
  slyInternalState,
} from '../../lib/slyCore/state';

const w = window as any;

function postTrackUpdate(payload: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: { source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_TRACK_UPDATE', payload } },
    source: window,
  }));
}

const track = (id: string) => ({ uri: `spotify:track:${id}`, name: `Song ${id}` });

let storageListener: ((changes: Record<string, unknown>, area?: string) => void) | undefined;

beforeAll(() => {
  const addListener = (globalThis as any).browser.storage.onChanged.addListener;
  addListener.mockClear();
  initSlyState();
  storageListener = addListener.mock.calls.at(-1)?.[0];
});

describe('normalizeLanguageTag', () => {
  it('reduces tags to a bare lowercase primary subtag', () => {
    expect(normalizeLanguageTag('ja-JP')).toBe('ja');
    expect(normalizeLanguageTag('pt_BR')).toBe('pt');
    expect(normalizeLanguageTag('HI')).toBe('hi');
    expect(normalizeLanguageTag('id')).toBe('id');
  });

  it('returns null for missing or non-string tags', () => {
    expect(normalizeLanguageTag(undefined)).toBeNull();
    expect(normalizeLanguageTag(null)).toBeNull();
    expect(normalizeLanguageTag('')).toBeNull();
    expect(normalizeLanguageTag(42)).toBeNull();
  });
});

describe('initSlyState language copy (K2)', () => {
  it('starts as null and copies the normalised bridge language', () => {
    expect(w.spotifyState).toBe(spotifyState);
    expect(w.spotifyState.language).toBeNull();
    postTrackUpdate({ track: track('0000000000000000000001'), language: 'ja-JP' });
    expect(w.spotifyState.language).toBe('ja');
  });

  it('keeps the last known language for the same track when the bridge reports null', () => {
    postTrackUpdate({ track: track('0000000000000000000002'), language: 'id' });
    expect(w.spotifyState.language).toBe('id');
    postTrackUpdate({ track: track('0000000000000000000002'), language: null });
    expect(w.spotifyState.language).toBe('id');
  });

  it('resets to null when the track changes and no language is known', () => {
    postTrackUpdate({ track: track('0000000000000000000003'), language: 'hi' });
    postTrackUpdate({ track: track('0000000000000000000004'), language: null });
    expect(w.spotifyState.language).toBeNull();
  });

  it('still copies the other bridge fields', () => {
    postTrackUpdate({ track: track('0000000000000000000005'), language: 'ko', isTimeSynced: true, syncType: 'LINE_SYNCED' });
    expect(w.spotifyState.track.uri).toBe('spotify:track:0000000000000000000005');
    expect(w.spotifyState.isTimeSynced).toBe(true);
    expect(w.spotifyState.syncType).toBe('LINE_SYNCED');
    expect(w.spotifyState.language).toBe('ko');
  });
});

describe('cache reset listener (K7)', () => {
  it('registers a storage.onChanged listener', () => {
    expect(typeof storageListener).toBe('function');
  });

  it('clears the L0 cache and the runtime cache on sly_cacheResetAt', () => {
    slyInternalState.l0Cache.set('spotify:track:a', { lines: [] });
    w.slyRuntimeCache = new Map([['Now playing: A by B', { lines: [] }]]);

    storageListener!({ sly_cacheResetAt: { newValue: Date.now() } }, 'local');

    expect(slyInternalState.l0Cache.size).toBe(0);
    expect(w.slyRuntimeCache.size).toBe(0);
  });

  it('ignores unrelated storage changes and other areas', () => {
    slyInternalState.l0Cache.set('spotify:track:b', { lines: [] });
    storageListener!({ someOtherKey: { newValue: 1 } }, 'local');
    storageListener!({ sly_cacheResetAt: { newValue: 1 } }, 'sync');
    expect(slyInternalState.l0Cache.has('spotify:track:b')).toBe(true);
  });
});
