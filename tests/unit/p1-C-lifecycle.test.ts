import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isPipelineALive } from '../../lib/core/lifecycleController';
import { slyInternalState, spotifyState } from '../../lib/slyCore/state';
import { resetContentCaches } from '../../lib/core/storageListener';
import { StateStore } from '../../lib/core/store';
import { resolveProcessed } from '../../lib/core/processedCache';
import type { ProcessedCache } from '../../lib/core/lyricsTypes';

describe('p1-C stale-HUD bypass guard (isPipelineALive)', () => {
  beforeEach(() => {
    slyInternalState.currentLyrics = null;
    slyInternalState.fetchingForUri.clear();
    slyInternalState.fetchingForTitle = '';
    slyInternalState.statusHUDActive = false;
    slyInternalState.isAdHUDActive = false;
    slyInternalState.isFetchingHUD = false;
    spotifyState.track = { uri: 'spotify:track:CurrentTrack0000000001' };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    slyInternalState.currentLyrics = null;
    slyInternalState.fetchingForUri.clear();
    slyInternalState.fetchingForTitle = '';
    spotifyState.track = null;
  });

  it('is false for a leftover godState with nothing running (bypass allowed)', () => {
    expect(isPipelineALive()).toBe(false);
  });

  it('is true while a FETCHING HUD is mounted or flagged', () => {
    const hud = document.createElement('div');
    hud.id = 'sly-status-hud';
    document.body.appendChild(hud);
    expect(isPipelineALive()).toBe(true);
    hud.remove();
    slyInternalState.statusHUDActive = true;
    expect(isPipelineALive()).toBe(true);
  });

  it('is true while an external fetch is in flight', () => {
    slyInternalState.fetchingForUri.add('spotify:track:CurrentTrack0000000001');
    expect(isPipelineALive()).toBe(true);
    slyInternalState.fetchingForUri.clear();
    slyInternalState.fetchingForTitle = 'Test Song';
    expect(isPipelineALive()).toBe(true);
  });

  it('is true for a failure of the current track but not of a previous one', () => {
    slyInternalState.currentLyrics = { failed: true, _slyUri: 'spotify:track:CurrentTrack0000000001' };
    expect(isPipelineALive()).toBe(true);
    slyInternalState.currentLyrics = { failed: true, _slyUri: 'spotify:track:PreviousTrack000000001' };
    expect(isPipelineALive()).toBe(false);
  });
});

describe('p1-C K7 cache reset (content side)', () => {
  afterEach(() => sessionStorage.clear());

  it('clears runtime, processed and sly_proc:* session caches but nothing else', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const store = new StateStore();
    store.runtimeCache.set('k', { original: ['a'], processed: {}, lastAccessed: 1 });
    store.cache = { original: ['a'], processed: new Map([['en', { translated: ['b'], romanized: ['a'] }]]) };
    store.canonicalHashes.set('t', 1);
    store.canonicalHash = 1;
    sessionStorage.setItem('sly_proc:Now playing: X', '{}');
    sessionStorage.setItem('sly_proc:Now playing: Y', '{}');
    sessionStorage.setItem('other_key', 'keep');

    resetContentCaches(store);

    expect(store.runtimeCache.size).toBe(0);
    expect(store.cache.processed.size).toBe(0);
    expect(store.canonicalHashes.size).toBe(0);
    expect(store.canonicalHash).toBeNull();
    expect(sessionStorage.getItem('sly_proc:Now playing: X')).toBeNull();
    expect(sessionStorage.getItem('sly_proc:Now playing: Y')).toBeNull();
    expect(sessionStorage.getItem('other_key')).toBe('keep');
    vi.restoreAllMocks();
  });
});

describe('p1-C resolveProcessed (shared lookup for every apply path)', () => {
  const en: ProcessedCache = { translated: ['Hello'], romanized: ['Konnichiwa'] };
  const jaFailed: ProcessedCache = { translated: null, romanized: ['Konnichiwa'], translationFailed: true };

  it('romanized mode may reuse an entry stored under another target language', () => {
    const processed = new Map([['en', en]]);
    expect(resolveProcessed(processed, 'ja', 'romanized')).toBe(en);
  });

  it('translated mode never borrows another language and never uses a failed translation', () => {
    expect(resolveProcessed(new Map([['en', en]]), 'ja', 'translated')).toBeUndefined();
    expect(resolveProcessed(new Map([['ja', jaFailed]]), 'ja', 'translated')).toBeUndefined();
    expect(resolveProcessed(new Map([['ja', jaFailed]]), 'ja', 'romanized')).toBe(jaFailed);
  });

  it('prefers entries not flagged low quality and skips entries without lines', () => {
    const low: ProcessedCache = { translated: ['x'], romanized: ['low'], isLowQualityRomanization: true };
    const empty = { translated: ['x'], romanized: [] } as ProcessedCache;
    expect(resolveProcessed({ de: low, fr: empty, en }, 'ja', 'romanized')).toBe(en);
  });
});
