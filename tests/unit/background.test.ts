import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from '../helpers/chrome';
import { RateLimited, googleLines } from '../../src/background/text/google';
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
    const impl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const client = body.context.client.clientName;
      const endpoint = url.split('/v1/')[1].split('?')[0];
      seen.push(`${endpoint}:${client}`);
      if (endpoint === 'search') return new Response(JSON.stringify(search));
      if (endpoint === 'next') return new Response(JSON.stringify(next));
      return new Response(JSON.stringify(client === 'ANDROID_MUSIC' ? browseAndroid : browseWeb));
    }) as typeof fetch;
    return { impl, seen };
  }

  it('prefers timed lyrics from the app client', async () => {
    const f = ytmFake(timed, plain);
    expect((await ytm(meta, f.impl))?.synced).toBe(true);
    expect(f.seen).toEqual(['search:WEB_REMIX', 'next:ANDROID_MUSIC', 'browse:ANDROID_MUSIC']);
  });

  it('falls back to the web client\'s plain lyrics', async () => {
    const f = ytmFake({}, plain);
    expect(await ytm(meta, f.impl)).toMatchObject({ synced: false, source: 'LyricFind via YouTube Music' });
  });

  it('refuses a search result that is another song', async () => {
    const f = ytmFake(timed, plain);
    expect(await ytm({ ...meta, durationMs: 300000 }, f.impl)).toBeNull();
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
    expect(first.translated).toEqual(['사랑해!', 'oh yeah!']);
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
