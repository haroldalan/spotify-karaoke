import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from '../helpers/chrome';
import { RateLimited, googleLines, resetGoogleBackoff } from '../../src/background/text/google';
import { parseLyricsBrowse, parseSearch, ytm } from '../../src/background/lyrics/ytm';
import type { TrackMeta } from '../../src/shared/types';

/** A Google gtx dj=1 response translating each line as "<line>!" (and romanizing as "r(<line>)"). */
function googleFake(opts: { status?: number; mangle?: boolean } = {}) {
  const requests: string[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    const q = new URLSearchParams(String(init?.body)).get('q') ?? '';
    requests.push(q);
    if (opts.status) return new Response('', { status: opts.status });
    const lines = q.split('\n');
    const sentences = lines.map((l, i) => ({ trans: `${l}!${i < lines.length - 1 && !opts.mangle ? '\n' : ''}`, orig: l }));
    return new Response(JSON.stringify({ sentences: [...sentences, { src_translit: lines.map((l) => `r(${l})`).join('\n') }] }));
  }) as typeof fetch;
  return { impl, requests };
}

describe('Google client', () => {
  it('translates a song in one request, keeping empty lines in place', async () => {
    const g = googleFake();
    const out = await googleLines(['one', '', 'two'], 'en', true, g.impl);
    expect(out.translated).toEqual(['one!', '', 'two!']);
    expect(out.romanized).toEqual(['r(one)', null, 'r(two)']);
    expect(g.requests).toHaveLength(1);
  });

  it('falls back to one line at a time when Google merges lines', async () => {
    const g = googleFake({ mangle: true });
    const out = await googleLines(['one', 'two', 'three'], 'en', false, g.impl);
    expect(out.translated).toEqual(['one!', 'two!', 'three!']);
    expect(g.requests).toHaveLength(4);
  });

  it('splits long songs into several requests', async () => {
    const g = googleFake();
    const lines = Array.from({ length: 120 }, (_, i) => `line number ${i} `.repeat(4));
    const out = await googleLines(lines, 'en', false, g.impl);
    expect(g.requests.length).toBeGreaterThan(1);
    expect(out.translated[119]).toBe(`${lines[119].trim()}!`);
  });

  it('reports rate limiting as such', async () => {
    await expect(googleLines(['a'], 'en', false, googleFake({ status: 429 }).impl)).rejects.toBeInstanceOf(RateLimited);
  });
});

describe('YouTube Music parsing', () => {
  const search = {
    contents: [{
      musicResponsiveListItemRenderer: {
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'まどろみ - Madoromi' }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Naoko Gushima' }, { text: ' • ' }, { text: 'Best' }, { text: ' • ' }, { text: '4:11' }] } } },
        ],
        playlistItemData: { videoId: 'vid123' },
      },
    }],
  };
  const timed = { contents: { elementRenderer: { newElement: { type: { componentType: { model: { timedLyricsModel: { lyricsData: {
    timedLyricsData: [
      { lyricLine: 'ずっと', cueRange: { startTimeMilliseconds: '1200' } },
      { lyricLine: 'そばで', cueRange: { startTimeMilliseconds: '5300' } },
    ],
    sourceMessage: 'Source: LyricFind',
  } } } } } } } } };
  const plain = { contents: { musicDescriptionShelfRenderer: { description: { runs: [{ text: 'ずっと\nそばで' }] }, footer: { runs: [{ text: 'Source: LyricFind' }] } } } };

  it('reads search results with their durations', () => {
    expect(parseSearch(search)).toEqual([{ videoId: 'vid123', title: 'まどろみ - Madoromi', artist: 'Naoko Gushima', durationS: 251 }]);
  });

  it('reads timed and plain lyrics', () => {
    expect(parseLyricsBrowse(timed)).toEqual({ lines: [{ startMs: 1200, text: 'ずっと' }, { startMs: 5300, text: 'そばで' }], synced: true, source: 'LyricFind via YouTube Music' });
    expect(parseLyricsBrowse(plain)).toMatchObject({ synced: false, lines: [{ startMs: 0, text: 'ずっと' }, { startMs: 0, text: 'そばで' }] });
    expect(parseLyricsBrowse({})).toBeNull();
  });

  const meta: TrackMeta = { id: 'x'.repeat(22), name: 'まどろみ', artists: ['Naoko Gushima'], album: '', durationMs: 250040, languages: ['ja'], hasLyrics: false };
  const next = { contents: { tabs: [{ tabRenderer: { title: 'Up next' } }, { tabRenderer: { title: 'Lyrics', endpoint: { browseEndpoint: { browseId: 'MPLYt_x' } } } }] } };

  function ytmFake(browseAndroid: unknown, browseWeb: unknown) {
    const seen: string[] = [];
    const versions: string[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      if (!url.includes('/youtubei/')) return new Response('<script>{"INNERTUBE_CLIENT_VERSION":"1.20261109.00.00"}</script>');
      const body = JSON.parse(String(init?.body));
      const client = body.context.client.clientName;
      if (client === 'WEB_REMIX') versions.push(body.context.client.clientVersion);
      const endpoint = url.split('/v1/')[1].split('?')[0];
      seen.push(`${endpoint}:${client}`);
      if (endpoint === 'search') return new Response(JSON.stringify(search));
      if (endpoint === 'next') return new Response(JSON.stringify(next));
      return new Response(JSON.stringify(client === 'ANDROID_MUSIC' ? browseAndroid : browseWeb));
    }) as typeof fetch;
    return { impl, seen, versions };
  }

  it('prefers timed lyrics from the app client', async () => {
    const f = ytmFake(timed, plain);
    expect((await ytm(meta, f.impl))?.synced).toBe(true);
    expect(f.seen).toEqual(['search:WEB_REMIX', 'next:ANDROID_MUSIC', 'browse:ANDROID_MUSIC']);
    expect(f.versions).toEqual(['1.20261109.00.00']); // read from the homepage, not hard-coded
  });

  it('falls back to the web client\'s plain lyrics', async () => {
    const f = ytmFake({}, plain);
    expect(await ytm(meta, f.impl)).toMatchObject({ synced: false, source: 'LyricFind via YouTube Music' });
  });

  it('refuses a search result that is another song', async () => {
    const f = ytmFake(timed, plain);
    expect(await ytm({ ...meta, durationMs: 300000 }, f.impl)).toBeNull();
  });

  it('says "no lyrics" only when YouTube Music said so: a failed request is a failure, not an answer', async () => {
    // Both lyrics requests fail (HTTP 403): the lookup is incomplete, and is asked again soon.
    const blocked = (async (url: string, init?: RequestInit) => {
      if (!url.includes('/youtubei/')) return new Response('');
      const endpoint = url.split('/v1/')[1].split('?')[0];
      if (endpoint === 'search') return new Response(JSON.stringify(search));
      return new Response('', { status: 403 });
    }) as typeof fetch;
    await expect(ytm(meta, blocked)).rejects.toThrow(/HTTP 403/);
    // Answered without lyrics (no Lyrics tab): that is an answer.
    const none = (async (url: string) => {
      if (!url.includes('/youtubei/')) return new Response('');
      const endpoint = url.split('/v1/')[1].split('?')[0];
      return new Response(JSON.stringify(endpoint === 'search' ? search : { contents: { tabs: [{ tabRenderer: { title: 'Up next' } }] } }));
    }) as typeof fetch;
    expect(await ytm(meta, none)).toBeNull();
  });
});

describe('YouTube Music header rules', () => {
  it('limit the rules to this extension\'s own origin host (the id in Chrome, the uuid in Firefox)', async () => {
    const rules: any[] = [];
    (globalThis as any).chrome = {
      runtime: { id: 'spotify-karaoke@example.com', getURL: (p: string) => `moz-extension://6f2a7c1e-uuid-0000/${p.replace(/^\//, '')}` },
      tabs: { TAB_ID_NONE: -1 },
      declarativeNetRequest: { updateSessionRules: async (o: any) => { rules.push(...o.addRules); } },
    };
    vi.resetModules();
    const { ytmHeaderRules } = await import('../../src/background/lyrics/ytm');
    await ytmHeaderRules();
    expect(rules.map((r) => r.id)).toEqual([101, 102]);
    for (const r of rules) {
      expect(r.condition.initiatorDomains).toEqual(['6f2a7c1e-uuid-0000']); // not the add-on id, which Firefox refuses as a domain
      expect(r.condition.tabIds).toEqual([-1]);
    }
    delete (globalThis as any).chrome;
  });
});

describe('cache', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('stores, expires, and shares concurrent work', async () => {
    const { cacheGet, cacheSet, once } = await import('../../src/background/cache');
    await cacheSet('a', { v: 1 });
    expect(await cacheGet('a')).toEqual({ v: 1 });
    vi.useFakeTimers({ toFake: ['Date'] });
    await cacheSet('b', 2, 1000);
    vi.setSystemTime(Date.now() + 2000);
    expect(await cacheGet('b')).toBeUndefined();
    vi.useRealTimers();
    let runs = 0;
    const work = () => once('k', async () => { runs++; await new Promise((r) => setTimeout(r, 10)); return runs; });
    expect(await Promise.all([work(), work()])).toEqual([1, 1]);
  });

  it('survives a service worker restart (storage, not memory)', async () => {
    const storage = installChromeStorage();
    const first = await import('../../src/background/cache');
    await first.cacheSet('song', ['line']);
    vi.resetModules();
    (globalThis as any).chrome.storage.local.get = async (k: string) => ({ [k]: storage.local.get(k) });
    const second = await import('../../src/background/cache');
    expect(await second.cacheGet('song')).toEqual(['line']);
  });
});

describe('processing', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('romanizes locally, translates through Google once, then answers from cache', async () => {
    const g = googleFake();
    vi.stubGlobal('fetch', g.impl);
    const { processLines } = await import('../../src/background/text/process');
    const req = { lines: ['사랑해', 'oh yeah'], language: 'ko', romanize: true, translateTo: 'en' };
    const first = await processLines(req);
    expect(first.script).toBe('Kore');
    expect(first.romanized).toEqual(['saranghae', null]);
    expect(first.translated).toEqual(['사랑해!', 'Oh yeah!']);
    await processLines(req);
    expect(g.requests).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('keeps romanization when translation fails, and says why', async () => {
    vi.stubGlobal('fetch', googleFake({ status: 429 }).impl);
    const { processLines } = await import('../../src/background/text/process');
    const out = await processLines({ lines: ['사랑해'], language: 'ko', romanize: true, translateTo: 'en' });
    expect(out.romanized).toEqual(['saranghae']);
    expect(out.translated).toBeNull();
    expect(out.translateError).toMatch(/rate-limiting/);
    vi.unstubAllGlobals();
  });
});

describe('romanization from Google', () => {
  beforeEach(() => {
    resetGoogleBackoff(); // the statically imported copy still holds the 429 test's pause
    vi.resetModules();
    installChromeStorage();
  });

  /** Google answering with a translation and no romanization at all. */
  const noTranslit = (async (_u: string, init?: RequestInit) => {
    const q = new URLSearchParams(String(init?.body)).get('q') ?? '';
    const lines = q.split('\n');
    return new Response(JSON.stringify({ sentences: lines.map((l, i) => ({ trans: `${l}!${i < lines.length - 1 ? '\n' : ''}` })) }));
  }) as typeof fetch;

  it('takes "no romanization sent" as an answer: the translation stays one request, not one per line', async () => {
    const requests: string[] = [];
    const counting = (async (u: string, init?: RequestInit) => { requests.push(String(init?.body)); return noTranslit(u, init); }) as typeof fetch;
    const out = await googleLines(['مرحبا', 'شكرا', 'وداعا'], 'en', true, counting);
    expect(out.translated).toEqual(['مرحبا!', 'شكرا!', 'وداعا!']);
    expect(out.romanized).toEqual([null, null, null]);
    expect(requests).toHaveLength(1);
  });

  it('answers an Arabic song with transliteration, final, when Google has no romanization for it', async () => {
    vi.stubGlobal('fetch', noTranslit);
    const { processLines } = await import('../../src/background/text/process');
    const out = await processLines({ lines: ['مرحبا', 'شكرا'], language: 'ar', romanize: true, translateTo: 'en' });
    expect(out.romanized?.every(Boolean)).toBe(true);
    expect(out.incomplete).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('gives a romanizer that needs Google its own request when the shared one had no romanization', async () => {
    // Japanese with the dictionary unavailable: translation first (no romanization asked),
    // then the romanizer falls back to Google and must not be answered with the shared nothing.
    const asked: { rm: boolean }[] = [];
    vi.stubGlobal('fetch', (async (_u: string, init?: RequestInit) => {
      const params = new URL(_u).searchParams.getAll('dt');
      const rm = params.includes('rm');
      asked.push({ rm });
      const q = new URLSearchParams(String(init?.body)).get('q') ?? '';
      const lines = q.split('\n');
      const sentences = lines.map((l, i) => ({ trans: `T(${l})${i < lines.length - 1 ? '\n' : ''}` }));
      return new Response(JSON.stringify({ sentences: rm ? [...sentences, { src_translit: lines.map((l) => `R(${l})`).join('\n') }] : sentences }));
    }) as typeof fetch);
    vi.doMock('../../src/background/text/japanese', () => ({
      romanizeJapanese: async () => { throw new Error('dictionary not loaded'); },
      japaneseAnalyzer: async () => { throw new Error('dictionary not loaded'); },
    }));
    const { processLines } = await import('../../src/background/text/process');
    const out = await processLines({ lines: ['君を愛してる', '永遠に'], language: 'ja', romanize: true, translateTo: 'en' });
    expect(out.romanized).toEqual(['R(君を愛してる)', 'R(永遠に)']);
    expect(out.translated).toEqual(['T(君を愛してる)', 'T(永遠に)']);
    expect(asked.some((a) => a.rm)).toBe(true);
    vi.doUnmock('../../src/background/text/japanese');
    vi.unstubAllGlobals();
  });

  it('never caches an empty romanization of a song with words', async () => {
    vi.stubGlobal('fetch', noTranslit);
    vi.doMock('../../src/background/text/japanese', () => ({
      romanizeJapanese: async () => { throw new Error('dictionary not loaded'); },
      japaneseAnalyzer: async () => { throw new Error('dictionary not loaded'); },
    }));
    const stores = installChromeStorage();
    const { processLines } = await import('../../src/background/text/process');
    // Dictionary missing, Google has no romanization: nothing usable. Asked again next time.
    const out = await processLines({ lines: ['君を愛してる'], language: 'ja', romanize: true, translateTo: null });
    expect(out.romanized?.some(Boolean) ?? false).toBe(false);
    expect(out.incomplete).toBe(true);
    expect([...stores.local.keys()].some((k) => k.startsWith('rm'))).toBe(false);
    vi.doUnmock('../../src/background/text/japanese');
    vi.unstubAllGlobals();
  });
});

describe('Google pauses survive the worker stopping', () => {
  it('remembers a pause across a new worker life, and forgets it after a success', async () => {
    vi.resetModules();
    const stores = installChromeStorage();
    const limited = (async () => new Response('', { status: 429 })) as typeof fetch;
    const first = await import('../../src/background/text/google');
    await expect(first.googleLines(['a'], 'en', false, limited)).rejects.toBeInstanceOf(first.RateLimited);
    expect([...stores.local.keys()].filter((k) => k.startsWith('pause:')).sort()).toEqual(['pause:google', 'pause:widget']);

    // The worker stopped and started again: memory is gone, storage is not.
    vi.resetModules();
    let sent = 0;
    const second = await import('../../src/background/text/google');
    const counting = (async () => { sent++; return new Response('', { status: 200 }); }) as typeof fetch;
    await expect(second.googleLines(['a'], 'en', false, counting)).rejects.toBeInstanceOf(second.RateLimited);
    expect(sent).toBe(0);
    await second.ensurePauseLoaded();
    expect(second.mainBlockedUntil()).toBeGreaterThan(Date.now());
    expect(second.googleBlockedUntil()).toBeGreaterThan(Date.now());
  });
});

describe('lyrics cache', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });
  const meta: TrackMeta = { id: 'y'.repeat(22), name: 'Song', artists: ['A'], album: '', durationMs: 200000, languages: [], hasLyrics: false };
  const DAY = 24 * 3600_000;
  const lrc = (text: string) => async () => ({ synced: `[00:01.00]${text}`, plain: text, instrumental: false });
  const plain = (text: string) => async () => ({ synced: null, plain: text, instrumental: false });

  it('answers from cache until the result is due, sooner for unsynced lyrics', async () => {
    const { findLyrics } = await import('../../src/background/lyrics/find');
    let t = 0;
    let asked = 0;
    const sources = { lrclib: async () => { asked++; return plain('words')(); } };
    await findLyrics(meta, sources, () => t);
    t = 6 * DAY;
    await findLyrics(meta, sources, () => t);
    expect(asked).toBe(1);
    t = 8 * DAY;
    await findLyrics(meta, sources, () => t);
    expect(asked).toBe(2);
  });

  it('keeps good lyrics when a refresh fails or finds less', async () => {
    const { findLyrics } = await import('../../src/background/lyrics/find');
    let t = 0;
    await findLyrics(meta, { lrclib: lrc('synced') }, () => t);
    t = 31 * DAY;
    const offline = { lrclib: async () => { throw new Error('offline'); } };
    expect((await findLyrics(meta, offline, () => t))?.lines[0].text).toBe('synced');
    t += 31 * 60_000; // retried soon, not in a month
    expect((await findLyrics(meta, { lrclib: plain('unsynced') }, () => t))?.synced).toBe(true);
  });

  it('does not keep "unreachable" as long as "none"', async () => {
    const { findLyrics } = await import('../../src/background/lyrics/find');
    let t = 0;
    let asked = 0;
    const down = { lrclib: async () => { asked++; throw new Error('offline'); } };
    await findLyrics(meta, down, () => t);
    t = 31 * 60_000;
    await findLyrics(meta, down, () => t);
    expect(asked).toBe(2);
  });
});

describe('romanization cache', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('does not keep a stopgap: Arabic without Google is retried next time', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', (async () => { calls++; return new Response('', { status: 503 }); }) as typeof fetch);
    const { processLines } = await import('../../src/background/text/process');
    const req = { lines: ['أحبك'], language: 'ar', romanize: true, translateTo: null };
    await processLines(req);
    const before = calls;
    await processLines(req);
    expect(calls).toBeGreaterThan(before);
    vi.unstubAllGlobals();
  });

  it('keys romanizations by script, so a kanji-only song read without its language can be read again as Japanese', async () => {
    vi.stubGlobal('fetch', (async () => new Response('', { status: 503 })) as typeof fetch);
    const { processLines } = await import('../../src/background/text/process');
    const zh = await processLines({ lines: ['永远'], language: null, romanize: true, translateTo: null });
    expect(zh.script).toBe('Hani');
    const ja = await processLines({ lines: ['永远'], language: 'ja', romanize: true, translateTo: null });
    expect(ja.script).toBe('Jpan');
    vi.unstubAllGlobals();
  });
});
