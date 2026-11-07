/**
 * Group B2 (phase 1): content.ts sly:panel_close guard (2026 UI) and K11 layout-host cleanup,
 * on the synthetic 2026 lyrics-panel fixture (invented text only).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf8');
const w = window as any;

function loadFixture(): void {
  const doc = new DOMParser().parseFromString(FIXTURE_HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
}

const themed = () => document.querySelector('.bm5I7yGVN8NXt6vH9eiC') as HTMLElement;

/** Simulate an active HUD: root in the themed panel's slot, native panel hidden, K11 classes on the slot. */
function showHud(): { host: HTMLElement; root: HTMLElement } {
  const panel = themed();
  const host = panel.parentElement as HTMLElement;
  const root = document.createElement('div');
  root.id = 'lyrics-root-sync';
  host.insertBefore(root, panel);
  host.classList.add('sly-active', 'sly-hud-active');
  panel.style.display = 'none';
  w.slyInternalState.statusHUDActive = true;
  w.slyInternalState.isFetchingHUD = true;
  return { host, root };
}

function setLyricsButtonActive(active: boolean): void {
  const btn = document.querySelector('[data-testid="lyrics-button"]')!;
  btn.setAttribute('data-active', String(active));
  btn.setAttribute('aria-pressed', String(active));
}

const release = vi.fn();

beforeAll(async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  sessionStorage.clear();
  await import('../../lib/slyCore/state');
  await import('../../lib/slyCore/preFetch');
  await import('../../lib/slyCore/adManager');
  await import('../../lib/slyCore/styles');
  await import('../../lib/slyCore/detector');
  await import('../../lib/slyCore/domEngine');
  await import('../../lib/slyCore/messaging');
  await import('../../lib/slyCore/content');
  await vi.advanceTimersByTimeAsync(0);
  // Stop the 500ms poll so only the events dispatched by these tests reach the handler.
  clearTimeout(w.antigravityInterval);
  document.addEventListener('sly:release', release);
});

afterAll(() => {
  document.removeEventListener('sly:release', release);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  // Let any earlier ignore window expire.
  await vi.advanceTimersByTimeAsync(6000);
  loadFixture();
  w.slyInternalState.statusHUDActive = false;
  w.slyInternalState.isFetchingHUD = false;
  release.mockClear();
});

describe('sly:panel_close guard', () => {
  it('does not treat Now Playing view preview lines as "panel still open"', () => {
    // Real close: the full-panel overlay is gone, only the aside preview has lines.
    document.querySelector('.BKBhMtk7_HSsKiFLJtC_')?.remove();
    setLyricsButtonActive(false);
    w.slyInternalState.statusHUDActive = true;
    w.slyInternalState.isFetchingHUD = true;
    expect(document.querySelectorAll('aside [data-testid="lyrics-line"]').length).toBe(3);

    document.dispatchEvent(new CustomEvent('sly:panel_close'));

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('ignores a transient close while the full panel is still mounted, but only for a bounded window', async () => {
    const { root } = showHud();
    setLyricsButtonActive(false); // Spotify clears the button briefly during a skip

    document.dispatchEvent(new CustomEvent('sly:panel_close'));
    expect(release).not.toHaveBeenCalled();
    expect(root.isConnected).toBe(true);

    await vi.advanceTimersByTimeAsync(1600);
    document.dispatchEvent(new CustomEvent('sly:panel_close'));
    expect(release).toHaveBeenCalledTimes(1);
    expect(root.isConnected).toBe(false);
  });
});

describe('sly:panel_close cleanup (K11)', () => {
  it('removes the layout classes from the themed panel parent and un-hides the native panel', () => {
    const { host, root } = showHud();
    w.slyInternalState.statusHUDActive = false;
    w.slyInternalState.isFetchingHUD = false;
    setLyricsButtonActive(false);

    document.dispatchEvent(new CustomEvent('sly:panel_close'));

    expect(root.isConnected).toBe(false);
    expect(host.classList.contains('sly-active')).toBe(false);
    expect(host.classList.contains('sly-hud-active')).toBe(false);
    expect(themed().style.display).toBe('');
    // The playlist <main> is never used as the layout host when the themed panel exists.
    expect(document.querySelector('main.sly-active')).toBeNull();
  });
});

describe('injection gate: HUD → takeover handoff (review C4)', () => {
  const URI = 'spotify:track:0000000000000000000Hnd';
  let realDetect: any;

  beforeEach(() => {
    realDetect = w.slyDetectNativeState;
  });

  afterEach(() => {
    w.slyDetectNativeState = realDetect;
    document.getElementById('lyrics-root-sync')?.remove();
    w.slyInternalState.currentLyrics = null;
    w.slyInternalState.pendingLyricsData = null;
  });

  it('removes the HUD but keeps the themed panel hidden when sly:inject is dispatched', async () => {
    await import('../../lib/slyCore/scavenger'); // SPOTIFY_CLASSES for slyPrepareContainer
    const { StatusEngine } = await import('../../lib/slyCore/statusEngine');
    const s = w.slyInternalState;
    w.spotifyState.track = { uri: URI, name: 'Test Song', artists: [{ name: 'Test Artist' }] };
    Object.assign(s, {
      lastUri: URI, isTransitioning: false, interceptorActive: false, isSpotifyFetching: false,
      forceFallback: false, currentLyrics: null, fetchingForTitle: '', panelIntentCooldown: 0,
    });
    s.fetchingForUri.clear();
    s.failedFetchUris.clear();
    w.slyDetectNativeState = async () => ({
      title: 'Test Song', artist: 'Test Artist', albumArtUrl: '', lyricsState: 'MISSING',
      isOnLyricsPage: true, isAd: false, hasNativeLines: false, hasUnavailableMessage: true,
      preFetch: null, currentTrackId: '0000000000000000000Hnd',
    });

    StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Test Song', artist: 'Test Artist' });
    const host = themed().parentElement!;
    expect(themed().style.display).toBe('none');
    // FetchEngine._handleSuccess: fetch flag off, lyrics staged.
    s.isFetchingHUD = false;
    s.pendingLyricsData = { plainLyrics: 'Invented line one\nInvented line two', isSynced: false, _slyUri: URI, isInstant: true };

    const atInject: Array<{ panel: string; root: boolean; hud: boolean; active: boolean }> = [];
    const onInject = () => atInject.push({
      panel: themed().style.display,
      root: !!document.getElementById('lyrics-root-sync'),
      hud: !!document.getElementById('sly-status-hud'),
      active: host.classList.contains('sly-active'),
    });
    document.addEventListener('sly:inject', onInject);
    await w.slyCheckNowPlaying();
    document.removeEventListener('sly:inject', onInject);

    expect(atInject.length).toBeGreaterThan(0);
    expect(atInject[0]).toEqual({ panel: 'none', root: true, hud: false, active: true });
    expect(themed().style.display).toBe('none');
    expect(host.classList.contains('sly-hud-active')).toBe(false);
    expect(s.statusHUDActive).toBe(false);
  });

  it('a late native result after the pending window keeps the takeover when re-injection swapped currentLyrics (review C6)', async () => {
    await import('../../lib/slyCore/scavenger');
    const { StatusEngine } = await import('../../lib/slyCore/statusEngine');
    const { NATIVE_LOOKUP_PENDING_MS } = await import('../../lib/slyCore/state');
    const trackId = URI.split(':').pop();
    const s = w.slyInternalState;
    w.spotifyState.track = { uri: URI, name: 'Test Song', artists: [{ name: 'Test Artist' }] };
    Object.assign(s, {
      lastUri: URI, isTransitioning: false, interceptorActive: false, isSpotifyFetching: false,
      forceFallback: false, currentLyrics: null, fetchingForTitle: '', panelIntentCooldown: 0,
    });
    s.fetchingForUri.clear();
    s.failedFetchUris.clear();
    w.slyDetectNativeState = async () => ({
      title: 'Test Song', artist: 'Test Artist', albumArtUrl: '', lyricsState: 'MISSING',
      isOnLyricsPage: true, isAd: false, hasNativeLines: false, hasUnavailableMessage: true,
      preFetch: null, currentTrackId: trackId,
    });
    const gateway = (action: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', {
      data: { source: 'SLY_ACTION_GATEWAY', action }, source: window,
    }));
    // The Layer-1 lookup reported ROMANIZED, then its pending window expired and the fallback armed.
    gateway({ type: 'SLY_PREFETCH_REPORT', trackId, state: 'ROMANIZED', romanizedLang: 'hi' });
    vi.setSystemTime(Date.now() + NATIVE_LOOKUP_PENDING_MS + 1);
    s.forceFallback = true;

    StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Test Song', artist: 'Test Artist' });
    s.isFetchingHUD = false;
    s.pendingLyricsData = { plainLyrics: 'Invented line one\nInvented line two', isSynced: false, _slyUri: URI };

    // Stand-in for Pipeline B's sly:inject handler: setupLock, then a storage read before
    // executeTakeover builds the lines onto the object it received.
    let lock = false;
    const built: any[] = [];
    const pipelineB = async (e: Event) => {
      if (lock) return;
      lock = true;
      const { lyricsObj } = (e as CustomEvent).detail;
      await new Promise(r => setTimeout(r, 0));
      w.slyBuildLyricsList(document.getElementById('lyrics-root-sync'), lyricsObj);
      built.push(lyricsObj);
      lock = false;
    };
    document.addEventListener('sly:inject', pipelineB);
    await w.slyCheckNowPlaying();
    await vi.advanceTimersByTimeAsync(0);
    document.removeEventListener('sly:inject', pipelineB);

    expect(built).toHaveLength(1);
    expect(document.querySelector('#lyrics-root-sync [data-testid="lyrics-line"]')).not.toBeNull();
    expect(s.currentLyrics).not.toBe(built[0]);
    expect(s.currentLyrics.lines).toBeUndefined();

    const panelClose = vi.fn();
    document.addEventListener('sly:panel_close', panelClose);
    gateway({
      type: 'SKL_NATIVE_LYRICS', trackId, nativeLines: ['परीक्षण एक', 'परीक्षण दो'], isRomanizedUpgrade: true,
      late: true, spotifyLineCount: 2, spotifyWordLineCount: 2,
    });
    document.removeEventListener('sly:panel_close', panelClose);

    expect(w.slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
    expect(s.forceFallback).toBe(true);
    expect(panelClose).not.toHaveBeenCalled();
    expect(document.querySelector('#lyrics-root-sync [data-testid="lyrics-line"]')).not.toBeNull();

    s.forceFallback = false;
    w.slyPreFetchRegistry.states.delete(URI);
  });
});
