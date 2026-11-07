/**
 * Group B2 (phase 1): LYRICS_UPGRADED unwraps payload.data (a FetchedLyricsResult)
 * like FetchEngine does, and never stages another track's lyrics. Also the K5
 * late-native mismatch guard.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { slyInternalState, spotifyState } from '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import { handleLyricsUpgraded } from '../../lib/slyCore/messaging';

const w = window as any;
const CURRENT = 'spotify:track:0000000000000000000Cur';
const OTHER = 'spotify:track:0000000000000000000Oth';
const LRC = '[00:01.00]Invented synced line one\n[00:04.00]Invented synced line two';

/** Shape sent by background.ts processUpgradeQueue: payload.data is a FetchedLyricsResult. */
function upgradePayload(uri: string) {
  return {
    cacheKey: `key:${uri}`,
    uri,
    data: {
      ok: true,
      data: { syncedLyrics: LRC, plainLyrics: '', isSynced: true, source: 'LRCLIB' },
      prefetchState: 'SYNCED',
      nativeStatus: 'MISSING',
    },
  };
}

let onMessage: ((m: Record<string, unknown>) => void) | undefined;

beforeAll(() => {
  const calls = (globalThis as any).browser.runtime.onMessage.addListener.mock.calls;
  onMessage = calls.at(-1)?.[0];
});

beforeEach(() => {
  document.body.innerHTML = '';
  slyInternalState.l0Cache.clear();
  slyInternalState.currentLyrics = null;
  slyInternalState.pendingLyricsData = null;
  slyInternalState.forceFallback = false;
  (spotifyState as any).track = { uri: CURRENT, name: 'Current Song' };
  w.slyPreFetchRegistry.states.clear();
});

describe('LYRICS_UPGRADED', () => {
  it('is routed from the runtime message listener', () => {
    expect(typeof onMessage).toBe('function');
    onMessage!({ type: 'LYRICS_UPGRADED', payload: upgradePayload(CURRENT) });
    expect(slyInternalState.l0Cache.get(CURRENT)?.isSynced).toBe(true);
  });

  it('unwraps the FetchedLyricsResult and stamps the URI', () => {
    handleLyricsUpgraded(upgradePayload(CURRENT));
    const cached = slyInternalState.l0Cache.get(CURRENT);
    expect(cached.syncedLyrics).toBe(LRC);
    expect(cached.isSynced).toBe(true);
    expect(cached._slyUri).toBe(CURRENT);
    expect(cached.nativeStatus).toBe('MISSING');
    expect(cached.ok).toBeUndefined(); // not the wrapper
    expect(cached.data).toBeUndefined();
  });

  it('stages the unwrapped lyrics for the current track when no takeover root exists', () => {
    handleLyricsUpgraded(upgradePayload(CURRENT));
    const pending = slyInternalState.pendingLyricsData as any;
    expect(pending?.syncedLyrics).toBe(LRC);
    expect(pending?._slyUri).toBe(CURRENT);
  });

  it('hot-swaps through sly:inject with the unwrapped object when the root is on screen', () => {
    const root = document.createElement('div');
    root.id = 'lyrics-root-sync';
    document.body.appendChild(root);
    const inject = vi.fn();
    document.addEventListener('sly:inject', inject);

    handleLyricsUpgraded(upgradePayload(CURRENT));

    expect(inject).toHaveBeenCalledTimes(1);
    const lyricsObj = (inject.mock.calls[0][0] as CustomEvent).detail.lyricsObj;
    expect(lyricsObj.syncedLyrics).toBe(LRC);
    expect(lyricsObj._slyUri).toBe(CURRENT);
    expect(slyInternalState.pendingLyricsData).toBeNull();
    document.removeEventListener('sly:inject', inject);
  });

  it('ignores upgrades for a different track except for the L0 cache', () => {
    const staged = { syncedLyrics: '[00:01.00]Current track line', _slyUri: CURRENT };
    slyInternalState.pendingLyricsData = staged;
    const inject = vi.fn();
    document.addEventListener('sly:inject', inject);

    handleLyricsUpgraded(upgradePayload(OTHER));

    expect(slyInternalState.pendingLyricsData).toBe(staged);
    expect(inject).not.toHaveBeenCalled();
    expect(slyInternalState.l0Cache.get(OTHER)?._slyUri).toBe(OTHER);
    document.removeEventListener('sly:inject', inject);
  });

  it('ignores failed or malformed upgrades', () => {
    handleLyricsUpgraded({ uri: CURRENT, data: { ok: false } });
    handleLyricsUpgraded({ uri: CURRENT, data: { ok: true } });
    handleLyricsUpgraded({ data: upgradePayload(CURRENT).data });
    expect(slyInternalState.l0Cache.size).toBe(0);
    expect(slyInternalState.pendingLyricsData).toBeNull();
  });
});

describe('SKL_NATIVE_LYRICS late upgrade (K5)', () => {
  const postGateway = (action: Record<string, unknown>) =>
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'SLY_ACTION_GATEWAY', action }, source: window }));

  it('does not mark NATIVE_OK when the late lines cannot be applied 1:1', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    postGateway({
      type: 'SKL_NATIVE_LYRICS', trackId: '0000000000000000000Cur',
      nativeLines: ['a', 'b'], isRomanizedUpgrade: true, late: true, spotifyLineCount: 3,
    });
    expect(w.slyPreFetchRegistry.getState(CURRENT)).toBeUndefined();
    expect(slyInternalState.forceFallback).toBe(true);
    vi.useRealTimers();
  });

  it('marks NATIVE_OK when the late lines match the Spotify line count', () => {
    postGateway({
      type: 'SKL_NATIVE_LYRICS', trackId: '0000000000000000000Cur',
      nativeLines: ['a', 'b', 'c'], isRomanizedUpgrade: true, late: true, spotifyLineCount: 3,
    });
    expect(w.slyPreFetchRegistry.getState(CURRENT)?.nativeStatus).toBe('NATIVE_OK');
  });

  // Amended K5: the interceptor sends spotifyWordLineCount (lines with words) and the
  // gate compares it with the Musixmatch lines that carry words, not the raw counts.
  // Spotify's 8 lines here = 6 word lines + a '♪' line + a trailing '' line.
  const wordLines = (n: number) => Array.from({ length: n }, (_, i) => `Invented word line ${i + 1}`);

  it('marks NATIVE_OK when the word-line counts match even though the raw counts differ (6 vs 8)', () => {
    vi.useFakeTimers();
    postGateway({
      type: 'SKL_NATIVE_LYRICS', trackId: '0000000000000000000Cur',
      nativeLines: wordLines(6), isRomanizedUpgrade: true, late: true,
      spotifyLineCount: 8, spotifyWordLineCount: 6,
    });
    expect(w.slyPreFetchRegistry.getState(CURRENT)?.nativeStatus).toBe('NATIVE_OK');
    expect(slyInternalState.forceFallback).toBe(false);
    vi.useRealTimers();
  });

  it('forces the Layer-2 fallback when the word-line counts differ (4 vs 6)', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    postGateway({
      type: 'SKL_NATIVE_LYRICS', trackId: '0000000000000000000Cur',
      nativeLines: wordLines(4), isRomanizedUpgrade: true, late: true,
      spotifyLineCount: 8, spotifyWordLineCount: 6,
    });
    expect(w.slyPreFetchRegistry.getState(CURRENT)).toBeUndefined();
    expect(slyInternalState.forceFallback).toBe(true);
    vi.useRealTimers();
  });
});
