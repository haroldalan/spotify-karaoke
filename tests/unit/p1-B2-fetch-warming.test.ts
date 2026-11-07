/**
 * Group B2 (phase 1): FetchEngine failure paths and WarmingEngine queue warming / K8.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { slyInternalState, spotifyState } from '../../lib/slyCore/state';
import { slyPreFetchRegistry } from '../../lib/slyCore/preFetch';
import '../../lib/slyCore/styles';
import '../../lib/slyCore/domEngine';
import '../../lib/slyCore/messaging';
import { FetchEngine } from '../../lib/slyCore/fetchEngine';
import { WarmingEngine } from '../../lib/slyCore/warmingEngine';

const w = window as any;
const URI = 'spotify:track:0000000000000000000Aaa';
const sendMessage = () => (globalThis as any).browser.runtime.sendMessage;

function resetState(): void {
  document.body.innerHTML = '';
  slyInternalState.lastUri = URI;
  slyInternalState.currentLyrics = null;
  slyInternalState.pendingLyricsData = null;
  slyInternalState.fetchingForTitle = '';
  slyInternalState.fetchingForUri.clear();
  slyInternalState.failedFetchUris.clear();
  slyInternalState.l0Cache.clear();
  slyInternalState.forceFallback = false;
  slyInternalState.statusHUDActive = false;
  slyInternalState.isFetchingHUD = false;
  slyPreFetchRegistry.states.clear();
  (spotifyState as any).track = { uri: URI, name: 'Song A', artists: [{ name: 'Artist A' }] };
  sendMessage().mockClear();
}

beforeEach(() => {
  resetState();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('FetchEngine L0 failed cache hit', () => {
  it('does not leave the URI in fetchingForUri (no endless spinner) and blocks automatic retries', () => {
    slyInternalState.l0Cache.set(URI, { failed: true, _slyUri: URI });
    FetchEngine.triggerFetch('Song A', 'Artist A', '', URI);

    expect(slyInternalState.fetchingForUri.has(URI)).toBe(false);
    expect(slyInternalState.failedFetchUris.has(URI)).toBe(true);
    expect((slyInternalState.currentLyrics as any)?.failed).toBe(true);
    expect(sendMessage()).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'FETCH_LYRICS' }));
  });

  it('stands down quietly for a ROMANIZED track instead of recording a failure', () => {
    slyInternalState.l0Cache.set(URI, { failed: true, _slyUri: URI });
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', nativeStatus: 'ROMANIZED' });
    slyInternalState.forceFallback = true;

    FetchEngine.triggerFetch('Song A', 'Artist A', '', URI);

    expect(slyInternalState.currentLyrics).toBeNull();
    expect(slyInternalState.forceFallback).toBe(false);
    expect(slyInternalState.fetchingForUri.has(URI)).toBe(false);
  });
});

describe('FetchEngine failure for a ROMANIZED track', () => {
  it('reverts to Spotify lines without the error HUD and without an L0 failure entry', () => {
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', nativeStatus: 'ROMANIZED' });
    slyInternalState.forceFallback = true;
    slyInternalState.fetchingForUri.add(URI);
    // A fetching HUD is on screen.
    const root = document.createElement('div');
    root.id = 'lyrics-root-sync';
    document.body.appendChild(root);
    slyInternalState.statusHUDActive = true;
    const panelClose = vi.fn();
    document.addEventListener('sly:panel_close', panelClose);

    FetchEngine.handleFetchResult({ ok: false }, {
      title: 'Song A', artist: 'Artist A', uri: URI, myUri: URI,
      myGeneration: slyInternalState.fetchGeneration,
    });

    expect(slyInternalState.currentLyrics).toBeNull();
    expect(slyInternalState.forceFallback).toBe(false);
    expect(slyInternalState.failedFetchUris.has(URI)).toBe(true);
    expect(slyInternalState.l0Cache.has(URI)).toBe(false);
    expect(document.getElementById('sly-status-hud')).toBeNull();
    expect(panelClose).toHaveBeenCalledTimes(1);
    document.removeEventListener('sly:panel_close', panelClose);
  });

  it('still records a failure for a MISSING track', () => {
    slyPreFetchRegistry.register(URI, 'MISSING', { source: 'native', nativeStatus: 'MISSING' });
    FetchEngine.handleFetchResult({ ok: false }, {
      title: 'Song A', artist: 'Artist A', uri: URI, myUri: URI,
      myGeneration: slyInternalState.fetchGeneration,
    });
    expect(slyInternalState.l0Cache.get(URI)?.failed).toBe(true);
    expect((slyInternalState.currentLyrics as any)?.failed).toBe(true);
  });

  it('a discarded response for another track clears its in-flight markers', () => {
    const queued = 'spotify:track:0000000000000000000Bbb';
    slyInternalState.fetchingForUri.add(queued);
    slyInternalState.fetchingForTitle = 'Song B';
    FetchEngine.handleFetchResult({ ok: true, data: {} }, {
      title: 'Song B', artist: 'Artist B', uri: queued, myUri: queued,
      myGeneration: slyInternalState.fetchGeneration,
    });
    expect(slyInternalState.fetchingForUri.has(queued)).toBe(false);
    expect(slyInternalState.fetchingForTitle).toBe('');
  });
});

describe('WarmingEngine queue warming', () => {
  it('never goes through the foreground fetch and leaves current-song state alone', () => {
    const trigger = vi.fn();
    w.slyTriggerLyricsFetch = trigger;
    const current = { lines: [{ text: 'x', time: 0 }], _slyUri: URI };
    slyInternalState.currentLyrics = current;
    const post = vi.spyOn(window, 'postMessage');

    WarmingEngine.warmQueue([
      { title: 'Next One', artist: 'Artist N', uri: 'spotify:track:0000000000000000000Nx1' },
      { title: 'Next Two', artist: 'Artist N', id: '0000000000000000000Nx2' },
    ]);

    expect(trigger).not.toHaveBeenCalled();
    expect(slyInternalState.currentLyrics).toBe(current);
    expect(slyInternalState.fetchingForTitle).toBe('');
    expect(slyInternalState.fetchingForUri.size).toBe(0);
    const checks = post.mock.calls.map(c => c[0] as any).filter(m => m?.type === 'SLY_CHECK_CACHE');
    expect(checks.map(m => m.payload.uri)).toEqual([
      'spotify:track:0000000000000000000Nx1',
      'spotify:track:0000000000000000000Nx2',
    ]);

    // Runs on every bridge tick: each queued track is checked once.
    post.mockClear();
    WarmingEngine.warmQueue([{ title: 'Next One', artist: 'Artist N', uri: 'spotify:track:0000000000000000000Nx1' }]);
    expect(post.mock.calls.filter(c => (c[0] as any)?.type === 'SLY_CHECK_CACHE')).toHaveLength(0);
  });

  it('skips the playing track and items without an id', () => {
    const post = vi.spyOn(window, 'postMessage');
    WarmingEngine.warmQueue([
      { title: 'Song A', artist: 'Artist A', uri: URI },
      { title: 'No Id', artist: 'Artist X' },
    ]);
    expect(post.mock.calls.filter(c => (c[0] as any)?.type === 'SLY_CHECK_CACHE')).toHaveLength(0);
  });
});

describe('WarmingEngine cache results (K8)', () => {
  it('treats found:false as no cached lyrics and uses nativeStatus only as a registry hint', () => {
    WarmingEngine.handleCacheResult({ uri: URI, title: 'Song A', artist: 'Artist A', result: { ok: true, found: false, nativeStatus: 'MISSING' } });
    expect(slyInternalState.l0Cache.has(URI)).toBe(false);
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('MISSING');
  });

  it('found:false without a hint changes nothing', () => {
    WarmingEngine.handleCacheResult({ uri: URI, title: 'Song A', artist: 'Artist A', result: { ok: true, found: false } });
    expect(slyInternalState.l0Cache.has(URI)).toBe(false);
    expect(slyPreFetchRegistry.getState(URI)).toBeUndefined();
  });

  it('does not cache a native-status placeholder as an L0 failure', () => {
    WarmingEngine.handleCacheResult({ uri: URI, title: 'Song A', artist: 'Artist A', result: { found: true, ok: false, isPlaceholder: true, nativeStatus: 'MISSING' } });
    expect(slyInternalState.l0Cache.has(URI)).toBe(false);
  });

  it('hydrates L0 from a usable entry', () => {
    WarmingEngine.handleCacheResult({ uri: URI, title: 'Song A', artist: 'Artist A', result: { ok: true, found: true, data: { syncedLyrics: '[00:01.00]Invented', isSynced: true }, prefetchState: 'SYNCED', nativeStatus: 'MISSING' } });
    expect(slyInternalState.l0Cache.get(URI)?._slyUri).toBe(URI);
    expect(slyInternalState.l0Cache.get(URI)?.isSynced).toBe(true);
  });
});
