import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/lyrics/lyricsProcessor', () => ({ processLines: vi.fn() }));
vi.mock('../../lib/lyricsProviders/lyricsEngine', () => ({
  getLyricsForTrack: vi.fn(),
  getColorOnly: vi.fn().mockResolvedValue(null),
  clearColorCache: vi.fn(),
}));

import background from '../../entrypoints/background';
import { getLyricsForTrack } from '../../lib/lyricsProviders/lyricsEngine';
import { lyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import {
  LyricsPersistence,
  NATIVE_STATUS_KEY,
  NATIVE_STATUS_REFRESH_MS,
} from '../../lib/lyricsProviders/lyricsPersistence';

const URI = 'spotify:track:testTrack0000000000002';
const META = { title: 'Test Title', artist: 'Test Artist', uri: URI };
const report = (status: string, meta = META) => ({ type: 'SLY_REPORT_NATIVE_STATUS', payload: { ...meta, status } });

// ---------------------------------------------------------------------------
// In-memory storage.local backing the global browser mock
// ---------------------------------------------------------------------------
let store: Record<string, any> = {};
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const local = () => (global as any).browser.storage.local;

function installStorage() {
  const l = local();
  l.get = vi.fn(async (keys: any) => {
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
  l.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, clone(items)); });
  l.remove = vi.fn(async (keys: string | string[]) => {
    for (const k of ([] as string[]).concat(keys)) delete store[k];
  });
}

/** storage.local.set calls that wrote the native-status map. */
const nativeMapWrites = () =>
  local().set.mock.calls.filter(([items]: [Record<string, unknown>]) => NATIVE_STATUS_KEY in items).length;

let onMessage: (msg: any, sender: any, sendResponse: (r: any) => void) => any;
let onStorageChanged: (changes: Record<string, any>, area: string) => void;

function send(msg: any): Promise<any> {
  return new Promise((resolve) => {
    const keepOpen = onMessage(msg, { tab: { id: 1 } }, resolve);
    if (keepOpen !== true) resolve(undefined);
  });
}

/** Popup "Reset Data": removes the persisted keys, then writes the K7 sentinel. */
function popupReset() {
  store = {};
  onStorageChanged({ sly_cacheResetAt: { newValue: Date.now() } }, 'local');
}

beforeAll(() => {
  installStorage();
  (background as unknown as () => void)();
  const b = (global as any).browser;
  onMessage = b.runtime.onMessage.addListener.mock.calls.at(-1)[0];
  onStorageChanged = b.storage.onChanged.addListener.mock.calls.at(-1)[0];
});

beforeEach(() => {
  popupReset(); // also clears the background's in-memory memo
  installStorage();
  lyricsCache.clear();
  (getLyricsForTrack as any).mockReset();
});

describe('SLY_REPORT_NATIVE_STATUS dedupe (C8/C3)', () => {
  it('10 identical reports write the native-status map at most once', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await send(report('UNSYNCED'))).toEqual({ ok: true });
    }
    expect(nativeMapWrites()).toBeLessThanOrEqual(1);
    expect(store[NATIVE_STATUS_KEY][URI].s).toBe('UNSYNCED');
  });

  it('answers repeats from memory, before any storage read', async () => {
    await send(report('UNSYNCED'));
    local().get.mockClear();
    local().set.mockClear();

    for (let i = 0; i < 9; i++) await send(report('UNSYNCED'));

    expect(local().get).not.toHaveBeenCalled();
    expect(local().set).not.toHaveBeenCalled();
  });

  it('dedupes concurrent repeats too', async () => {
    const res = await Promise.all(Array.from({ length: 10 }, () => send(report('UNSYNCED'))));
    expect(res.every((r) => r?.ok === true)).toBe(true);
    expect(nativeMapWrites()).toBeLessThanOrEqual(1);
  });

  it('still records a changed status', async () => {
    await send(report('UNSYNCED'));
    await send(report('UNSYNCED'));
    await send(report('MISSING'));
    await send(report('MISSING'));
    expect(nativeMapWrites()).toBe(2);
    expect(store[NATIVE_STATUS_KEY][URI].s).toBe('MISSING');
  });

  it('does not re-read a real L2 entry for repeated reports of its status', async () => {
    store[URI] = { ok: true, prefetchState: 'UNSYNCED', nativeStatus: 'UNSYNCED', data: { plainLyrics: 'test line', isSynced: false }, persistedAt: Date.now() };
    await send(report('UNSYNCED'));
    local().get.mockClear();
    for (let i = 0; i < 9; i++) await send(report('UNSYNCED'));
    expect(local().get).not.toHaveBeenCalled();
    expect(local().set).not.toHaveBeenCalled();
  });

  it('records again after the K7 reset wiped the stored map', async () => {
    await send(report('UNSYNCED'));
    popupReset();
    installStorage();

    await send(report('UNSYNCED'));

    expect(nativeMapWrites()).toBe(1);
    expect(store[NATIVE_STATUS_KEY][URI].s).toBe('UNSYNCED');
  });

  it('forgets the memo when the lyrics entry is rewritten elsewhere (self-heal)', async () => {
    store[URI] = {
      ok: true, prefetchState: 'UNSYNCED', nativeStatus: 'ROMANIZED',
      data: { plainLyrics: 'test line', isSynced: false }, persistedAt: Date.now(),
    };
    await send(report('ROMANIZED'));
    // The cache check corrects a stale ROMANIZED tag on Latin-only lyrics.
    await send({ type: 'SLY_CHECK_CACHE', payload: META });
    expect(store[URI].nativeStatus).toBe('NATIVE_OK');

    // A later ROMANIZED report is processed again, not skipped by the memo.
    await send(report('ROMANIZED'));
    expect(store[URI].nativeStatus).toBe('ROMANIZED');
  });

  it('forgets the memo when FETCH_LYRICS stores a new entry', async () => {
    await send(report('UNSYNCED'));
    (getLyricsForTrack as any).mockResolvedValue({
      ok: true, nativeStatus: 'SYNCED', data: { syncedLyrics: '[00:01.00]test line', isSynced: true },
    });
    await send({ type: 'FETCH_LYRICS', payload: META });
    expect(store[URI].nativeStatus).toBe('SYNCED');

    await send(report('UNSYNCED'));
    expect(store[URI].nativeStatus).toBe('UNSYNCED');
  });

  it('keeps one memo entry per key', async () => {
    const other = { ...META, uri: 'spotify:track:testTrack0000000000003' };
    await send(report('UNSYNCED'));
    await send(report('UNSYNCED', other));
    await send(report('UNSYNCED'));
    await send(report('UNSYNCED', other));
    expect(nativeMapWrites()).toBe(2);
    expect(Object.keys(store[NATIVE_STATUS_KEY]).sort()).toEqual([URI, other.uri].sort());
  });

  it('bounds the memo: the oldest key falls back to storage', async () => {
    await send(report('UNSYNCED'));
    for (let i = 0; i < 1000; i++) {
      await send(report('UNSYNCED', { ...META, uri: `spotify:track:testBulk${String(i).padStart(14, '0')}` }));
    }
    local().get.mockClear();
    await send(report('UNSYNCED'));
    expect(local().get).toHaveBeenCalled();
  });
});

describe('LyricsPersistence.setNativeStatus — unchanged status (C8/C3)', () => {
  const T0 = 1_800_000_000_000;
  let persistence: LyricsPersistence;

  beforeEach(() => {
    store = {};
    installStorage();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    persistence = new LyricsPersistence();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not rewrite the map for 10 identical calls', async () => {
    for (let i = 0; i < 10; i++) await persistence.setNativeStatus(URI, 'UNSYNCED');
    expect(nativeMapWrites()).toBe(1);
    expect(store[NATIVE_STATUS_KEY][URI]).toEqual({ s: 'UNSYNCED', t: T0 });
  });

  it('refreshes the age stamp of an unchanged status at most once an hour', async () => {
    await persistence.setNativeStatus(URI, 'UNSYNCED');
    vi.setSystemTime(T0 + NATIVE_STATUS_REFRESH_MS - 1);
    await persistence.setNativeStatus(URI, 'UNSYNCED');
    expect(nativeMapWrites()).toBe(1);

    vi.setSystemTime(T0 + NATIVE_STATUS_REFRESH_MS);
    await persistence.setNativeStatus(URI, 'UNSYNCED');
    expect(nativeMapWrites()).toBe(2);
    expect(store[NATIVE_STATUS_KEY][URI]).toEqual({ s: 'UNSYNCED', t: T0 + NATIVE_STATUS_REFRESH_MS });
  });

  it('writes a changed status immediately', async () => {
    await persistence.setNativeStatus(URI, 'UNSYNCED');
    vi.setSystemTime(T0 + 1000);
    await persistence.setNativeStatus(URI, 'SYNCED');
    expect(nativeMapWrites()).toBe(2);
    expect(store[NATIVE_STATUS_KEY][URI]).toEqual({ s: 'SYNCED', t: T0 + 1000 });
  });
});
