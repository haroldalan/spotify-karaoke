import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ytmAnswer = vi.hoisted(() => ({ value: null as null | Record<string, unknown>, gate: null as null | Promise<void> }));
vi.mock('../../lib/lyricsProviders/ytm', () => ({
  fetchYtmLyrics: vi.fn(async () => { if (ytmAnswer.gate) await ytmAnswer.gate; return ytmAnswer.value; }),
}));

// L1-N: native-script lyrics from YouTube Music and LRCLIB (Musixmatch was removed: it no longer serves anonymous clients).
// Every title, artist, id and line below is invented.

const TITLE = 'Invented Song';
const ARTIST = 'Invented Singer';
// Invented Devanagari test sentences (not lyrics of any song).
const NATIVE_LINES = ['यह परीक्षण पंक्ति एक है', 'यह परीक्षण पंक्ति दो है', 'यह परीक्षण पंक्ति तीन है'];
// Invented romanized Hindi made of common words (not lyrics of any song).
const ROMANIZED_LINES = ['kabhi phir mujhe yaad aaya', 'tujhe apna naam diya', 'raat aur subah ki baat', 'koi sapna kuch liya'];
const ENGLISH_LINES = ['the quiet morning light', 'we walk along the river', 'counting every passing cloud', 'until the evening falls'];

const lrc = (lines: string[]) => lines.map((l, i) => `[00:${String(10 + i * 4).padStart(2, '0')}.50] ${l}`).join('\n');

const copy = (over: Record<string, unknown>) => ({
  id: 1, trackName: TITLE, artistName: ARTIST, duration: 200, instrumental: false,
  syncedLyrics: lrc(NATIVE_LINES), plainLyrics: NATIVE_LINES.join('\n'), ...over,
});

let originalFetch: typeof globalThis.fetch;
let searches: URLSearchParams[];
let results: unknown;

beforeEach(() => {
  vi.resetModules();
  ytmAnswer.value = null;
  ytmAnswer.gate = null;
  searches = [];
  results = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'lrclib.net') searches.push(url.searchParams);
    return new Response(JSON.stringify(results), { status: 200 });
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('findNativeLrclib', () => {
  it('takes the native-script copy closest to the track duration, within 3 s', async () => {
    results = [
      copy({ id: 10, syncedLyrics: lrc(ROMANIZED_LINES) }), // romanized copy: skipped
      copy({ id: 11, duration: 205 }),                       // too far off
      copy({ id: 12, duration: 198 }),
      copy({ id: 13, duration: 200.4 }),                     // closest
    ];
    const { findNativeLrclib } = await import('../../lib/lyricsProviders/lrclibNative');
    const match = await findNativeLrclib({ title: `${TITLE} (From "Invented Film")`, artist: ARTIST, durationMs: 200_000 });
    expect(match?.id).toBe(13);
    // Searched by the core title and the artist.
    expect(searches[0].get('track_name')).toBe(TITLE);
    expect(searches[0].get('artist_name')).toBe(ARTIST);
  });

  it('no copy within 3 s of the duration: none', async () => {
    results = [copy({ id: 11, duration: 210 })];
    const { findNativeLrclib } = await import('../../lib/lyricsProviders/lrclibNative');
    expect(await findNativeLrclib({ title: TITLE, artist: ARTIST, durationMs: 200_000 })).toBeNull();
  });

  it('without the track duration no copy is used, and nothing is requested', async () => {
    results = [copy({ id: 21, duration: 150 }), copy({ id: 22, duration: 200 })];
    const { findNativeLrclib } = await import('../../lib/lyricsProviders/lrclibNative');
    expect(await findNativeLrclib({ title: TITLE, artist: ARTIST })).toBeNull();
    expect(searches).toHaveLength(0);
  });

  it('a copy with far more or fewer lines than the romanized lyrics is skipped', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `${NATIVE_LINES[i % 3]} ${i}`);
    results = [copy({ id: 23, syncedLyrics: lrc(many) }), copy({ id: 24, duration: 201 })];
    const { findNativeLrclib, lineCountFits } = await import('../../lib/lyricsProviders/lrclibNative');
    expect((await findNativeLrclib({ title: TITLE, artist: ARTIST, durationMs: 200_000, referenceWordLines: 3 }))?.id).toBe(24);
    // 25 % or 3 lines of slack, whichever is more.
    expect(lineCountFits(30, 33)).toBe(true);
    expect(lineCountFits(24, 33)).toBe(false);
    expect(lineCountFits(6, 3)).toBe(true);
    expect(lineCountFits(7, 3)).toBe(false);
    expect(lineCountFits(50, undefined)).toBe(true);
  });

  it('another song, another artist, unsynced or instrumental copies never count', async () => {
    results = [
      copy({ id: 31, trackName: 'Different Song' }),
      copy({ id: 32, artistName: 'Someone Else' }),
      copy({ id: 33, syncedLyrics: null }),
      copy({ id: 34, instrumental: true }),
    ];
    const { findNativeLrclib } = await import('../../lib/lyricsProviders/lrclibNative');
    expect(await findNativeLrclib({ title: TITLE, artist: ARTIST, durationMs: 200_000 })).toBeNull();
  });

  it('an artist list naming the track artist matches', async () => {
    results = [copy({ id: 41, artistName: `${ARTIST} & Another Invented Singer` })];
    const { findNativeLrclib } = await import('../../lib/lyricsProviders/lrclibNative');
    expect((await findNativeLrclib({ title: TITLE, artist: ARTIST, durationMs: 200_000 }))?.id).toBe(41);
  });

  it('no request without a title or an artist; a failed request is no match', async () => {
    const { findNativeLrclib } = await import('../../lib/lyricsProviders/lrclibNative');
    expect(await findNativeLrclib({ title: '', artist: ARTIST })).toBeNull();
    expect(await findNativeLrclib({ title: TITLE, artist: '' })).toBeNull();
    expect(searches).toHaveLength(0);
    globalThis.fetch = vi.fn(async () => { throw new TypeError('offline'); }) as any;
    expect(await findNativeLrclib({ title: TITLE, artist: ARTIST })).toBeNull();
  });
});

describe('LRC helpers', () => {
  it('lrcToSubtitleLines: times, sorted, end = next start', async () => {
    const { lrcToSubtitleLines } = await import('../../lib/lyricsProviders/lrclibNative');
    const lines = lrcToSubtitleLines('[00:12.00] second\n[00:02.50] first\n[01:00.25]\nnot a line');
    expect(lines.map((l) => [l.startTimeMs, l.words, l.endTimeMs])).toEqual([
      ['2500', 'first', '12000'],
      ['12000', 'second', '60250'],
      ['60250', '♪', '63250'],
    ]);
  });

  it('lrcLooksRomanized: romanized text yes, English and native script no', async () => {
    const { lrcLooksRomanized } = await import('../../lib/lyricsProviders/lrclibNative');
    expect(lrcLooksRomanized(lrc(ROMANIZED_LINES))).toBe(true);
    expect(lrcLooksRomanized(lrc(ENGLISH_LINES))).toBe(false);
    expect(lrcLooksRomanized(lrc(NATIVE_LINES))).toBe(false);
    expect(lrcLooksRomanized(undefined)).toBe(false);
  });
});

describe('native lookup: YouTube Music, then LRCLIB', () => {
  const TRACK_ID = '0TestTrackNnnnnnnnnnnn';

  it('a native LRCLIB copy (by the track metadata and duration) is the answer', async () => {
    const store: Record<string, any> = {};
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    local.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, items); });
    results = [copy({ id: 51, duration: 240 }), copy({ id: 52, duration: 200 })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(1000);
    const gen = nativeLyricsProvider.newInterception(TRACK_ID);
    const pending = nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', gen);
    // The page names the track after Spotify asked for its lyrics: the lookup waited for it.
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    const lines = await pending;
    expect(lines?.map((l) => l.words)).toEqual(NATIVE_LINES);
    expect(searches).toHaveLength(1);
    expect(searches[0].get('track_name')).toBe(TITLE);
    // LRCLIB is the only request (YouTube Music is mocked here; Musixmatch was removed).
    expect((globalThis.fetch as any).mock.calls.every((c: any[]) => String(c[0]).includes('lrclib.net'))).toBe(true);
  });

  it('finds metadata the page sent under the hex GID, and a newer lookup makes an older one stale', async () => {
    const store: Record<string, any> = {};
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    local.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, items); });
    results = [copy({ id: 61, duration: 200 })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(0);
    const HEX = 'b39fe8081e1f4c54be38e8d6f9f12bb9';
    nativeLyricsProvider.notifyMetadata(HEX, TITLE, ARTIST, 200_000);
    const lines = await nativeLyricsProvider.fetchNativeLines(TRACK_ID, HEX, nativeLyricsProvider.newInterception(TRACK_ID), 3);
    expect(lines?.map((l) => l.words)).toEqual(NATIVE_LINES);

    // A lookup overtaken by a newer one for the same track answers null.
    nativeLyricsProvider.resetMemory();
    for (const k of Object.keys(store)) delete store[k];
    let release!: () => void;
    ytmAnswer.gate = new Promise<void>((r) => { release = r; }); // YouTube Music answers late
    const old = nativeLyricsProvider.fetchNativeLines(TRACK_ID, HEX, nativeLyricsProvider.newInterception(TRACK_ID), 3);
    nativeLyricsProvider.newInterception(TRACK_ID); // the track is played again meanwhile
    release();
    expect(await old).toBeNull();
  });

  it('YouTube Music\'s native-script synced lyrics come before LRCLIB', async () => {
    const store: Record<string, any> = {};
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    const ytmNative = ['यह दूसरी परीक्षण पंक्ति है', 'यह तीसरी परीक्षण पंक्ति है', 'यह चौथी परीक्षण पंक्ति है'];
    ytmAnswer.value = { isSynced: true, syncedLyrics: lrc(ytmNative), source: 'YTM', keySource: 'test' };
    results = [copy({ id: 53 })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(0);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    const lines = await nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3);
    // LRCLIB may be asked at the same time; YouTube Music's native lyrics still win.
    expect(lines?.map((l) => l.words)).toEqual(ytmNative);
  });

  it('LRCLIB is asked while YouTube Music is still answering (a slow YouTube Music adds no LRCLIB time)', async () => {
    const store: Record<string, any> = {};
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    let release!: () => void;
    ytmAnswer.gate = new Promise<void>((r) => { release = r; });
    ytmAnswer.value = { isSynced: true, syncedLyrics: lrc(ROMANIZED_LINES), source: 'YTM', keySource: 'test' };
    results = [copy({ id: 56 })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(0);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    const pending = nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3);
    for (let i = 0; i < 20 && !searches.length; i++) await new Promise((r) => setTimeout(r, 0));
    expect(searches).toHaveLength(1); // before YouTube Music answered
    release();
    expect((await pending)?.map((l) => l.words)).toEqual(NATIVE_LINES);
    expect(searches).toHaveLength(1); // not asked twice
  });

  it('native YouTube Music lyrics with far more lines than Spotify\'s (another song) are skipped for LRCLIB', async () => {
    const store: Record<string, any> = {};
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    local.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, items); });
    const otherSong = Array.from({ length: 20 }, (_, i) => `यह किसी और गीत की पंक्ति है ${i}`);
    ytmAnswer.value = { isSynced: true, syncedLyrics: lrc(otherSong), source: 'YTM', keySource: 'test' };
    results = [copy({ id: 57 })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(0);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    const lines = await nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3);
    expect(lines?.map((l) => l.words)).toEqual(NATIVE_LINES);
    await Promise.resolve(); await Promise.resolve();
    expect(store.skl_native_lines_v1?.[TRACK_ID]?.source).toBe('LRCLIB');
  });

  it('remembered native lines that do not fit Spotify\'s line count are forgotten and looked up again', async () => {
    const wrong = Array.from({ length: 20 }, (_, i) => ({ startTimeMs: String(i * 1000), words: `यह किसी और गीत की पंक्ति है ${i}`, syllables: [], endTimeMs: String(i * 1000 + 1000) }));
    const store: Record<string, any> = {
      skl_native_lines_v1: { [TRACK_ID]: { at: Date.now(), source: 'YTM', lines: wrong } },
    };
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    local.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, items); });
    results = [copy({ id: 58 })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(0);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    const lines = await nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3);
    expect(lines?.map((l) => l.words)).toEqual(NATIVE_LINES);
    await Promise.resolve(); await Promise.resolve();
    expect(store.skl_native_lines_v1[TRACK_ID].source).toBe('LRCLIB');
    expect(store.skl_native_lines_v1[TRACK_ID].lines).toHaveLength(NATIVE_LINES.length);
  });

  it('a cache check\'s title never replaces what the page named for a track', async () => {
    const { nativeLyricsProvider, getTrackMetadata } = await import('../../lib/lyricsProviders/nativeLyrics');
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, 'Previous Invented Song', 'Previous Invented Artist', undefined, { ifUnknown: true });
    expect(getTrackMetadata(TRACK_ID)).toEqual({ name: TITLE, artist: ARTIST, durationMs: 200_000 });
    // With nothing recorded yet, it is used (and the page's later notification replaces it).
    nativeLyricsProvider.notifyMetadata('0OtherTrackNnnnnnnnnnn', 'Some Invented Song', 'Some Artist', undefined, { ifUnknown: true });
    expect(getTrackMetadata('0OtherTrackNnnnnnnnnnn')?.name).toBe('Some Invented Song');
  });

  it('romanized YouTube Music lyrics are skipped: LRCLIB is asked with Spotify\'s line count', async () => {
    const store: Record<string, any> = {};
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    ytmAnswer.value = { isSynced: true, syncedLyrics: lrc(ROMANIZED_LINES), source: 'YTM', keySource: 'test' };
    const many = Array.from({ length: 20 }, (_, i) => `${NATIVE_LINES[i % 3]} ${i}`);
    results = [copy({ id: 54, syncedLyrics: lrc(many) })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(0);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    // Spotify's answer has 3 lines with words: a 20-line copy does not fit.
    expect(await nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3)).toBeNull();
    expect(searches).toHaveLength(1);
  });

  it('a restored track is remembered: the next lookup (song page, reload) answers with no request; Reset forgets it', async () => {
    const store: Record<string, any> = {};
    const local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: string[] | string) => Object.fromEntries(([] as string[]).concat(keys).filter((k) => k in store).map((k) => [k, store[k]])));
    local.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, items); });
    results = [copy({ id: 55 })];
    const { nativeLyricsProvider, setMetadataWaitMs } = await import('../../lib/lyricsProviders/nativeLyrics');
    setMetadataWaitMs(0);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    const first = await nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3);
    expect(first?.map((l) => l.words)).toEqual(NATIVE_LINES);
    await Promise.resolve(); await Promise.resolve();
    expect(store.skl_native_lines_v1?.[TRACK_ID]?.source).toBe('LRCLIB');
    const calls = (globalThis.fetch as any).mock.calls.length;
    const again = await nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3);
    expect(again?.map((l) => l.words)).toEqual(NATIVE_LINES);
    expect((globalThis.fetch as any).mock.calls.length).toBe(calls);
    // Reset Data removes the stored map and the background forgets its copy.
    delete store.skl_native_lines_v1;
    nativeLyricsProvider.resetMemory();
    results = [];
    expect(await nativeLyricsProvider.fetchNativeLines(TRACK_ID, '', nativeLyricsProvider.newInterception(TRACK_ID), 3)).toBeNull();
  });

  it('a notification without a duration keeps the one the page sent', async () => {
    const { nativeLyricsProvider, getTrackMetadata } = await import('../../lib/lyricsProviders/nativeLyrics');
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST, 200_000);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, TITLE, ARTIST);
    expect(getTrackMetadata(TRACK_ID)?.durationMs).toBe(200_000);
    nativeLyricsProvider.notifyMetadata(TRACK_ID, 'Next Invented Song', ARTIST);
    expect(getTrackMetadata(TRACK_ID)?.durationMs).toBeUndefined();
  });
});

describe('songs without Spotify lyrics: native script over a romanized fallback', () => {
  async function engineWith(ytmLines: string[]) {
    vi.doMock('../../lib/lyricsProviders/ytm', () => ({
      fetchYtmLyrics: vi.fn(async () => ({ isSynced: true, syncedLyrics: lrc(ytmLines), source: 'YTM', keySource: 'test' })),
    }));
    vi.doMock('../../lib/lyricsProviders/lrclib', () => ({ fetchLrcLibLyrics: vi.fn(async () => null) }));
    vi.doMock('../../lib/lyricsProviders/color', () => ({ extractImageColor: vi.fn(async () => null) }));
    (global as any).browser.runtime.sendMessage = vi.fn(async () => {});
    const engine = await import('../../lib/lyricsProviders/lyricsEngine');
    // The page named the tracks with their duration (an LRCLIB copy needs it).
    const { nativeLyricsProvider } = await import('../../lib/lyricsProviders/nativeLyrics');
    for (const id of ['0TestTrackRrrrrrrrrrrr', '0TestTrackEeeeeeeeeeee']) nativeLyricsProvider.notifyMetadata(id, TITLE, ARTIST, 200_000);
    return engine;
  }

  afterEach(() => {
    vi.doUnmock('../../lib/lyricsProviders/ytm');
    vi.doUnmock('../../lib/lyricsProviders/lrclib');
    vi.doUnmock('../../lib/lyricsProviders/color');
  });

  it('romanized synced lyrics give way to a native-script LRCLIB copy', async () => {
    results = [copy({ id: 61 })];
    const { getLyricsForTrack } = await engineWith(ROMANIZED_LINES);
    const res = await getLyricsForTrack(TITLE, ARTIST, undefined, 'spotify:track:0TestTrackRrrrrrrrrrrr');
    expect(res.data).toMatchObject({ source: 'LRCLIB', isSynced: true, nativeChecked: true });
    expect(res.data?.syncedLyrics).toBe(lrc(NATIVE_LINES));
  });

  it('romanized lyrics stay when LRCLIB has no native copy, marked as checked', async () => {
    results = [copy({ id: 62, syncedLyrics: lrc(ROMANIZED_LINES) })];
    const { getLyricsForTrack } = await engineWith(ROMANIZED_LINES);
    const res = await getLyricsForTrack(TITLE, ARTIST, undefined, 'spotify:track:0TestTrackRrrrrrrrrrrr');
    expect(res.data).toMatchObject({ source: 'YTM', nativeChecked: true });
    expect(res.data?.syncedLyrics).toBe(lrc(ROMANIZED_LINES));
  });

  it('without the track duration the romanized lyrics stay', async () => {
    results = [copy({ id: 64 })];
    const { getLyricsForTrack } = await engineWith(ROMANIZED_LINES);
    const res = await getLyricsForTrack(TITLE, ARTIST, undefined, 'spotify:track:0TestTrackUnknownDurat');
    expect(res.data?.source).toBe('YTM');
    expect(searches).toHaveLength(0);
  });

  it('English lyrics never cause a native-script search', async () => {
    results = [copy({ id: 63 })];
    const { getLyricsForTrack } = await engineWith(ENGLISH_LINES);
    const res = await getLyricsForTrack(TITLE, ARTIST, undefined, 'spotify:track:0TestTrackEeeeeeeeeeee');
    expect(res.data?.source).toBe('YTM');
    expect(searches).toHaveLength(0);
  });
});
