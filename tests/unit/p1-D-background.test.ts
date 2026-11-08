import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/lyrics/lyricsProcessor', () => ({ processLines: vi.fn() }));
vi.mock('../../lib/lyricsProviders/lyricsEngine', () => ({
  getLyricsForTrack: vi.fn(),
  getColorOnly: vi.fn().mockResolvedValue(null),
  clearColorCache: vi.fn(),
}));

import background from '../../entrypoints/background';
import { processLines } from '../../lib/lyrics/lyricsProcessor';
import { getLyricsForTrack, clearColorCache } from '../../lib/lyricsProviders/lyricsEngine';
import { lyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import { NATIVE_STATUS_KEY } from '../../lib/lyricsProviders/lyricsPersistence';

const HOUR = 60 * 60 * 1000;
const URI = 'spotify:track:testTrack0000000000001';
const META = { title: 'Test Title', artist: 'Test Artist', uri: URI };

// ---------------------------------------------------------------------------
// In-memory storage.local backing the global browser mock
// ---------------------------------------------------------------------------
let store: Record<string, any> = {};
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function installStorage() {
  const local = (global as any).browser.storage.local;
  local.get = vi.fn(async (keys: any) => {
    if (keys == null) return clone(store);
    if (typeof keys === 'string') return keys in store ? { [keys]: clone(store[keys]) } : {};
    if (Array.isArray(keys)) {
      const out: Record<string, any> = {};
      for (const k of keys) if (k in store) out[k] = clone(store[k]);
      return out;
    }
    const out: Record<string, any> = {};
    for (const [k, def] of Object.entries(keys)) out[k] = k in store ? clone(store[k]) : def;
    return out;
  });
  local.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, clone(items)); });
  local.remove = vi.fn(async (keys: string | string[]) => {
    for (const k of ([] as string[]).concat(keys)) delete store[k];
  });
}

let onMessage: (msg: any, sender: any, sendResponse: (r: any) => void) => any;
let onStorageChanged: (changes: Record<string, any>, area: string) => void;

function send(msg: any): Promise<any> {
  return new Promise((resolve) => {
    const keepOpen = onMessage(msg, { tab: { id: 1 } }, resolve);
    if (keepOpen !== true) resolve(undefined);
  });
}

beforeAll(() => {
  installStorage();
  (background as unknown as () => void)();
  const b = (global as any).browser;
  onMessage = b.runtime.onMessage.addListener.mock.calls.at(-1)[0];
  onStorageChanged = b.storage.onChanged.addListener.mock.calls.at(-1)[0];
});

beforeEach(() => {
  store = {};
  installStorage();
  lyricsCache.clear();
  // K7 reset also drops the background's in-memory native-status memo between tests.
  onStorageChanged({ sly_cacheResetAt: { newValue: Date.now() } }, 'local');
  (processLines as any).mockReset();
  (getLyricsForTrack as any).mockReset();
  (clearColorCache as any).mockClear();
});

describe('PROCESS (K1)', () => {
  it('answers null on total failure instead of echoing the originals', async () => {
    (processLines as any).mockRejectedValue(new Error('boom'));
    const res = await send({ type: 'PROCESS', lines: ['テスト'], targetLang: 'en', sourceLang: 'ja' });
    expect(res).toBeNull();
  });

  it('forwards the sourceLang hint and returns the processor result', async () => {
    const result = { translated: null, romanized: ['tesuto'], translationFailed: true };
    (processLines as any).mockResolvedValue(result);
    const res = await send({ type: 'PROCESS', lines: ['テスト'], targetLang: 'en', sourceLang: 'ja' });
    expect(processLines).toHaveBeenCalledWith(['テスト'], 'en', 'ja');
    expect(res).toEqual(result);
  });
});

describe('SLY_CHECK_CACHE (K8)', () => {
  it('reports a legacy placeholder as not found, with its native status', async () => {
    store[URI] = { ok: false, prefetchState: 'MISSING', nativeStatus: 'UNSYNCED', isPlaceholder: true, persistedAt: Date.now() };
    const res = await send({ type: 'SLY_CHECK_CACHE', payload: META });
    expect(res).toEqual({ ok: true, found: false, nativeStatus: 'UNSYNCED' });
  });

  it('reports an expired failure as not found', async () => {
    store[URI] = { ok: false, prefetchState: 'MISSING', data: { isSynced: false }, persistedAt: Date.now() - 13 * HOUR };
    const res = await send({ type: 'SLY_CHECK_CACHE', payload: META });
    expect(res.found).toBe(false);
    expect(res.ok).toBe(true);
  });

  it('reports a fresh failure as not found too (FETCH_LYRICS owns the failure verdict)', async () => {
    store[URI] = { ok: false, prefetchState: 'MISSING', data: { isSynced: false }, persistedAt: Date.now() - HOUR };
    const res = await send({ type: 'SLY_CHECK_CACHE', payload: META });
    expect(res.found).toBe(false);
  });

  it('returns a usable entry as found', async () => {
    store[URI] = {
      ok: true, prefetchState: 'SYNCED', nativeStatus: 'UNSYNCED',
      data: { syncedLyrics: '[00:01.00]test line', isSynced: true },
      persistedAt: Date.now() - 5 * 24 * HOUR,
    };
    const res = await send({ type: 'SLY_CHECK_CACHE', payload: META });
    expect(res.ok).toBe(true);
    expect(res.found).toBe(true);
    expect(res.data.syncedLyrics).toContain('test line');
  });

  it('uses the separate native-status store when no lyrics entry exists', async () => {
    store[NATIVE_STATUS_KEY] = { [URI]: { s: 'MISSING', t: Date.now() } };
    const res = await send({ type: 'SLY_CHECK_CACHE', payload: META });
    expect(res).toEqual({ ok: true, found: false, nativeStatus: 'MISSING' });
  });
});

describe('SLY_REPORT_NATIVE_STATUS', () => {
  it('keeps native-status markers out of the 200-entry lyrics index', async () => {
    const res = await send({ type: 'SLY_REPORT_NATIVE_STATUS', payload: { ...META, status: 'SYNCED' } });
    expect(res).toEqual({ ok: true });
    expect(store[NATIVE_STATUS_KEY][URI].s).toBe('SYNCED');
    expect(store[URI]).toBeUndefined();
    expect(store.l2_index).toBeUndefined();
    expect(lyricsCache.has(URI)).toBe(false);
  });

  it('updates the status on a real entry', async () => {
    store[URI] = { ok: true, prefetchState: 'UNSYNCED', data: { plainLyrics: 'test', isSynced: false }, persistedAt: Date.now() };
    await send({ type: 'SLY_REPORT_NATIVE_STATUS', payload: { ...META, status: 'ROMANIZED' } });
    expect(store[URI].nativeStatus).toBe('ROMANIZED');
    expect(store[NATIVE_STATUS_KEY]).toBeUndefined();
  });
});

describe('FETCH_LYRICS — failed re-fetch after TTL expiry', () => {
  it('keeps the good cached entry instead of overwriting it with ok:false', async () => {
    store[URI] = {
      ok: true, prefetchState: 'UNSYNCED', nativeStatus: 'UNSYNCED',
      data: { plainLyrics: 'test line one\ntest line two', isSynced: false, source: 'LRCLIB' },
      persistedAt: Date.now() - 30 * HOUR, // past the 24h unsynced TTL
    };
    (getLyricsForTrack as any).mockResolvedValue({ ok: false, data: { isSynced: false } });

    const res = await send({ type: 'FETCH_LYRICS', payload: { ...META, nativeStatus: 'UNSYNCED' } });

    expect(getLyricsForTrack).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.data.plainLyrics).toContain('test line one');
    expect(store[URI].ok).toBe(true);
    expect(store[URI].data.plainLyrics).toContain('test line one');
  });

  describe('SYNCED entries (30d TTL)', () => {
    const DAY = 24 * HOUR;
    const T0 = 1_800_000_000_000;
    const SYNCED_DATA = { syncedLyrics: '[00:01.00]test synced line', isSynced: true, source: 'LRCLIB' };
    const syncedEntry = (persistedAt: number) => ({
      ok: true, prefetchState: 'SYNCED', nativeStatus: 'SYNCED', data: SYNCED_DATA, persistedAt,
    });
    const restartServiceWorker = () => lyricsCache.clear(); // L1 is gone after an SW restart

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps a synced entry aged 31d (L2 only) when the re-fetch fails', async () => {
      store[URI] = syncedEntry(T0 - 31 * DAY);
      store.l2_index = [URI];
      (getLyricsForTrack as any).mockResolvedValue({ ok: false });

      const res = await send({ type: 'FETCH_LYRICS', payload: META });

      expect(getLyricsForTrack).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(true);
      expect(res.data.syncedLyrics).toContain('test synced line');
      expect(store[URI].ok).toBe(true);
      expect(store[URI].prefetchState).toBe('SYNCED');
      expect(store[URI].data).toEqual(SYNCED_DATA);
      // Not back-dated: persistedAt is the real fetch time, the retry time is separate.
      expect(store[URI].persistedAt).toBe(T0 - 31 * DAY);
      expect(store[URI].retryAt).toBe(T0 + HOUR);
      expect(store.l2_index).toContain(URI);
    });

    it('still keeps the synced entry when it is re-requested 2h later and the retry fails again', async () => {
      store[URI] = syncedEntry(T0 - 31 * DAY);
      (getLyricsForTrack as any).mockResolvedValue({ ok: false });
      await send({ type: 'FETCH_LYRICS', payload: META });
      restartServiceWorker();

      // Within the retry window the kept entry is a usable cache hit.
      vi.setSystemTime(T0 + 30 * 60 * 1000);
      expect((await send({ type: 'SLY_CHECK_CACHE', payload: META })).found).toBe(true);

      // 2h later it is due for a retry: not a hit, but still in storage.
      restartServiceWorker();
      vi.setSystemTime(T0 + 2 * HOUR);
      const check = await send({ type: 'SLY_CHECK_CACHE', payload: META });
      expect(check).toEqual({ ok: true, found: false, nativeStatus: 'SYNCED' });
      expect(store[URI]?.ok).toBe(true);

      const res = await send({ type: 'FETCH_LYRICS', payload: META });

      expect(getLyricsForTrack).toHaveBeenCalledTimes(2);
      expect(res.ok).toBe(true);
      expect(res.data.syncedLyrics).toContain('test synced line');
      expect(store[URI].ok).toBe(true);
      expect(store[URI].data).toEqual(SYNCED_DATA);
      expect(store[URI].persistedAt).toBe(T0 - 31 * DAY);
      expect(store[URI].retryAt).toBe(T0 + 3 * HOUR);
    });

    it('replaces the kept entry once a retry succeeds', async () => {
      store[URI] = { ...syncedEntry(T0 - 31 * DAY), retryAt: T0 - HOUR, lastCheckedAt: T0 - 2 * HOUR };
      (getLyricsForTrack as any).mockResolvedValue({
        ok: true, data: { syncedLyrics: '[00:02.00]test refreshed line', isSynced: true, source: 'LRCLIB' },
      });

      const res = await send({ type: 'FETCH_LYRICS', payload: META });

      expect(res.ok).toBe(true);
      expect(store[URI].data.syncedLyrics).toContain('test refreshed line');
      expect(store[URI].persistedAt).toBe(T0);
      expect(store[URI].retryAt).toBeUndefined();
      expect(store[URI].nativeStatus).toBe('SYNCED');
    });

    it('serves a synced entry within its 30d TTL from L2 without re-fetching', async () => {
      store[URI] = syncedEntry(T0 - 29 * DAY);
      const res = await send({ type: 'FETCH_LYRICS', payload: META });
      expect(getLyricsForTrack).not.toHaveBeenCalled();
      expect(res.data.syncedLyrics).toContain('test synced line');
    });

    it('still garbage-collects failures older than 30d on read', async () => {
      store[URI] = { ok: false, prefetchState: 'MISSING', data: { isSynced: false }, persistedAt: T0 - 31 * DAY };
      store.l2_index = ['spotify:track:other', URI];
      const res = await send({ type: 'SLY_CHECK_CACHE', payload: META });
      expect(res.found).toBe(false);
      expect(store[URI]).toBeUndefined();
      expect(store.l2_index).toEqual(['spotify:track:other']);
    });
  });

  it('stores a successful fetch with persistedAt stamped and the stored native status', async () => {
    store[NATIVE_STATUS_KEY] = { [URI]: { s: 'MISSING', t: Date.now() } };
    (getLyricsForTrack as any).mockResolvedValue({ ok: true, data: { syncedLyrics: '[00:01.00]test', isSynced: true } });

    const res = await send({ type: 'FETCH_LYRICS', payload: META });

    expect(res.ok).toBe(true);
    expect(res.prefetchState).toBe('SYNCED');
    expect(res.nativeStatus).toBe('MISSING');
    expect(typeof res.persistedAt).toBe('number');
    expect(lyricsCache.get(URI)?.persistedAt).toBeGreaterThan(0);
  });
});

describe('Cache reset sentinel (K7)', () => {
  it('clears the L1 lyrics cache, in-flight fetches and the colour cache', () => {
    lyricsCache.set(URI, { ok: true, data: { plainLyrics: 'x', isSynced: false } });
    lyricsCache.setInFlight('spotify:track:other', new Promise(() => {}));

    onStorageChanged({ sly_cacheResetAt: { newValue: Date.now() } }, 'local');

    expect(lyricsCache.has(URI)).toBe(false);
    expect(lyricsCache.getInFlight('spotify:track:other')).toBeUndefined();
    expect(clearColorCache).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated storage changes', () => {
    lyricsCache.set(URI, { ok: true, data: { plainLyrics: 'x', isSynced: false } });
    onStorageChanged({ targetLang: { newValue: 'es' } }, 'sync');
    onStorageChanged({ lc_index: { newValue: {} } }, 'local');
    expect(lyricsCache.has(URI)).toBe(true);
    expect(clearColorCache).not.toHaveBeenCalled();
  });
});
