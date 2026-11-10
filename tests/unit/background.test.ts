import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from '../helpers/chrome';
import { RateLimited, alignSentences, googleLines, resetGoogleBackoff } from '../../src/background/text/google';
import { resetWidget } from '../../src/background/text/googleWidget';
import { parseLyricsBrowse, parseSearch, ytm } from '../../src/background/lyrics/ytm';
import type { TrackMeta } from '../../src/shared/types';

/**
 * A Google dj=1 response translating each line as "<line>!" (and romanizing as
 * "r(<line>)"). As Google does, each sentence's orig keeps its source line break.
 * mangle: the translations lose their line breaks. merge: lines 0 and 1 come back as one
 * sentence. rmLost: the romanization loses a line break. widget: the backup's answers
 * ("<line>?"), or false for a backup that fails.
 */
function googleFake(opts: { status?: number; mangle?: boolean; merge?: boolean; rmLost?: boolean; widget?: boolean; mark?: string } = {}) {
  /** What a "translation" adds to its line: "!" by default; a word where a test needs a real change. */
  const mark = opts.mark ?? '!';
  const requests: string[] = [];
  const urls: string[] = [];
  const widget: string[][] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.includes('translate_http')) return new Response(`x={"X-Goog-Api-Key":"${'k'.repeat(39)}"}`);
    if (url.includes('translate-pa')) {
      if (opts.widget === false) return new Response('', { status: 500 });
      const batch = (JSON.parse(String(init?.body)) as [[string[]]])[0][0];
      widget.push(batch);
      return new Response(JSON.stringify([batch.map((l) => `${l}?`)]));
    }
    const q = new URLSearchParams(String(init?.body)).get('q') ?? '';
    requests.push(q);
    if (opts.status) return new Response('', { status: opts.status });
    const lines = q.split('\n');
    const nl = (i: number) => (i < lines.length - 1 ? '\n' : '');
    let sentences = lines.map((l, i) => ({ trans: `${l}${mark}${opts.mangle ? '' : nl(i)}`, orig: `${l}${nl(i)}` }));
    if (opts.merge && lines.length > 2) sentences = [{ trans: `${lines[0]} ${lines[1]}!\n`, orig: `${lines[0]}\n${lines[1]}\n` }, ...sentences.slice(2)];
    const rm = lines.map((l) => `r(${l})`).join(opts.rmLost ? ' ' : '\n');
    return new Response(JSON.stringify({ sentences: [...sentences, { src_translit: rm }] }));
  }) as typeof fetch;
  return { impl, requests, urls, widget };
}

describe('Google client', () => {
  it('translates a song in one request, keeping empty lines in place', async () => {
    const g = googleFake();
    const out = await googleLines(['one', '', 'two'], 'en', true, g.impl);
    expect(out.translated).toEqual(['one!', '', 'two!']);
    expect(out.romanized).toEqual(['r(one)', null, 'r(two)']);
    expect(g.requests).toHaveLength(1);
  });

  it('asks as Google Translate\'s Android app (client=at)', async () => {
    const g = googleFake();
    await googleLines(['one'], 'en', true, g.impl);
    const main = g.urls.filter((u) => u.includes('translate_a/single'));
    expect(main).toHaveLength(1);
    expect(new URL(main[0]).searchParams.get('client')).toBe('at');
  });

  it('puts translations back on their lines by Google\'s sentences when it moves the line breaks: one request', async () => {
    const g = googleFake({ mangle: true });
    const out = await googleLines(['one', 'two', 'three'], 'en', false, g.impl);
    expect(out.translated).toEqual(['one!', 'two!', 'three!']);
    expect(g.requests).toHaveLength(1);
    expect(out.incomplete).toBeUndefined();
  });

  it('asks the backup once for lines Google merged into one sentence, never one request per line', async () => {
    resetWidget();
    const g = googleFake({ merge: true });
    const out = await googleLines(['one', 'two', 'three', 'four'], 'en', false, g.impl);
    expect(out.translated).toEqual(['one?', 'two?', 'three!', 'four!']);
    expect(g.requests).toHaveLength(1);
    expect(g.widget).toEqual([['one', 'two']]);
    expect(out.incomplete).toBeUndefined();
  });

  it('leaves such lines without a translation when the backup fails too, and says the result is incomplete', async () => {
    resetWidget();
    const g = googleFake({ merge: true, widget: false });
    const out = await googleLines(['one', 'two', 'three'], 'en', false, g.impl);
    expect(out.translated).toEqual(['', '', 'three!']);
    expect(out.incomplete).toBe(true);
    expect(g.requests).toHaveLength(1);
  });

  it('drops a romanization that lost its line breaks (a stopgap, not "none"), without asking again', async () => {
    const g = googleFake({ rmLost: true });
    const out = await googleLines(['one', 'two'], 'en', true, g.impl);
    expect(out.translated).toEqual(['one!', 'two!']);
    expect(out.romanized).toEqual([null, null]);
    expect(out.romanizationLost).toBe(true);
    expect(g.requests).toHaveLength(1);
  });

  it('places sentences: several on one line joined, a spanning one split by its own line breaks, a mismatch never shifted', () => {
    // Two sentences on line 0; line 1 alone.
    expect(alignSentences([{ orig: 'Hi. ', trans: 'Salut. ' }, { orig: 'Bye.\n', trans: 'Au revoir.\n' }, { orig: 'Again', trans: 'Encore' }], 2))
      .toEqual(['Salut. Au revoir.', 'Encore']);
    // One sentence over two lines whose translation keeps the break: split.
    expect(alignSentences([{ orig: 'a\nb\n', trans: 'A\nB\n' }, { orig: 'c', trans: 'C' }], 3)).toEqual(['A', 'B', 'C']);
    // Sources that don't add up to the lines sent: nothing placed rather than misplaced.
    expect(alignSentences([{ orig: 'a b c', trans: 'A B C' }], 3)).toEqual([null, null, null]);
  });

  it('splits long songs into several requests', async () => {
    const g = googleFake();
    const lines = Array.from({ length: 120 }, (_, i) => `line number ${i} `.repeat(4));
    const out = await googleLines(lines, 'en', false, g.impl);
    expect(g.requests.length).toBeGreaterThan(1);
    expect(out.translated[119]).toBe(`${lines[119].trim()}!`);
  });

  it('takes a 403 or the CAPTCHA page served as a page for a block, and translates through the backup', async () => {
    for (const blocked of [new Response('', { status: 403 }), new Response('<html>unusual traffic</html>', { status: 200 })]) {
      resetGoogleBackoff();
      resetWidget();
      const g = googleFake({});
      const impl = (async (url: string, init?: RequestInit) => (url.includes('translate_a') ? blocked.clone() : g.impl(url, init))) as typeof fetch;
      const out = await googleLines(['one', 'two'], 'en', false, impl);
      expect(out).toMatchObject({ translated: ['one?', 'two?'], backup: true });
    }
  });

  it('translates through the backup when the main endpoint fails any other way (a server error)', async () => {
    resetGoogleBackoff();
    resetWidget();
    const g = googleFake({});
    const impl = (async (url: string, init?: RequestInit) => (url.includes('translate_a') ? new Response('', { status: 503 }) : g.impl(url, init))) as typeof fetch;
    expect(await googleLines(['one'], 'en', false, impl)).toMatchObject({ translated: ['one?'], backup: true });
  });

  it('reports rate limiting as such', async () => {
    resetWidget();
    // Both endpoints refusing: the main one's rate limit is what is reported.
    await expect(googleLines(['a'], 'en', false, googleFake({ status: 429, widget: false }).impl)).rejects.toBeInstanceOf(RateLimited);
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

describe('Background network header rules', () => {
  const install = async () => {
    const rules: any[] = [];
    const removed: number[][] = [];
    (globalThis as any).chrome = {
      runtime: { id: 'spotify-karaoke@example.com', getURL: (p: string) => `moz-extension://6f2a7c1e-uuid-0000/${p.replace(/^\//, '')}` },
      tabs: { TAB_ID_NONE: -1 },
      declarativeNetRequest: {
        updateSessionRules: async (o: any) => { removed.push(o.removeRuleIds); rules.push(...o.addRules); },
        getSessionRules: async () => rules,
      },
    };
    vi.resetModules();
    const net = await import('../../src/background/net');
    await net.installHeaderRules();
    return { rules, removed, net };
  };
  const done = () => { delete (globalThis as any).chrome; };

  it('are scoped to this extension\'s own background requests (the uuid in Firefox, never a tab)', async () => {
    const { rules, net } = await install();
    expect(rules.map((r) => r.id)).toEqual([net.RULE_IDS.YTM_WEB, net.RULE_IDS.YTM_ANDROID, net.RULE_IDS.GOOGLE_TRANSLATE, net.RULE_IDS.LRCLIB]);
    for (const r of rules) {
      expect(r.condition.initiatorDomains).toEqual(['6f2a7c1e-uuid-0000']); // not the add-on id, which Firefox refuses as a domain
      expect(r.condition.tabIds).toEqual([-1]);
      expect(r.condition.resourceTypes).toEqual(['xmlhttprequest', 'other']);
    }
    done();
  });

  it('Google Translate\'s main endpoint: Origin and Referer left out, the Translate app\'s User-Agent, nothing else', async () => {
    const { rules, net } = await install();
    const gt = rules.find((r) => r.id === net.RULE_IDS.GOOGLE_TRANSLATE);
    expect(gt.condition.urlFilter).toBe('||translate.googleapis.com/translate_a/');
    expect(gt.action).toEqual({
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'origin', operation: 'remove' },
        { header: 'referer', operation: 'remove' },
        { header: 'user-agent', operation: 'set', value: net.TRANSLATE_ANDROID_UA },
      ],
    });
    expect(net.TRANSLATE_ANDROID_UA).toMatch(/^AndroidTranslate\//);
    done();
  });

  it('never touch the backup endpoint, and set a User-Agent only for the Android clients (YouTube Music, Google Translate)', async () => {
    const { rules, net } = await install();
    expect(rules.some((r) => /translate-pa|translate_http/.test(r.condition.urlFilter))).toBe(false);
    const setsUa = rules.filter((r) => r.action.requestHeaders.some((h: any) => h.header === 'user-agent'));
    expect(setsUa.map((r) => r.id)).toEqual([net.RULE_IDS.YTM_ANDROID, net.RULE_IDS.GOOGLE_TRANSLATE]);
    expect(setsUa[0].condition.urlFilter).toContain('music.youtube.com');
    expect(setsUa[1].condition.urlFilter).toBe('||translate.googleapis.com/translate_a/');
    done();
  });

  it('LRCLIB: Origin and Referer left out, its Lrclib-Client header untouched', async () => {
    const { rules, net } = await install();
    const lrc = rules.find((r) => r.id === net.RULE_IDS.LRCLIB);
    expect(lrc.condition.urlFilter).toBe('||lrclib.net/api/');
    expect(lrc.action.requestHeaders).toEqual([{ header: 'origin', operation: 'remove' }, { header: 'referer', operation: 'remove' }]);
    done();
  });

  it('replace their own earlier copies on install, and are installed again when one is missing', async () => {
    const { rules, removed, net } = await install();
    expect(removed[0]).toEqual(Object.values(net.RULE_IDS));
    net.resetRulesReadyForTest();
    await net.ensureHeaderRules(); // all present: nothing installed again
    expect(removed).toHaveLength(1);
    rules.splice(rules.findIndex((r) => r.id === net.RULE_IDS.GOOGLE_TRANSLATE), 1);
    net.resetRulesReadyForTest();
    await net.ensureHeaderRules();
    expect(removed).toHaveLength(2);
    expect(rules.some((r) => r.id === net.RULE_IDS.GOOGLE_TRANSLATE)).toBe(true);
    done();
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
    const g = googleFake({ mark: ' tr' });
    vi.stubGlobal('fetch', g.impl);
    const { processLines } = await import('../../src/background/text/process');
    const req = { lines: ['사랑해', 'oh yeah'], language: 'ko', romanize: true, translateTo: 'en' };
    const first = await processLines(req);
    expect(first.script).toBe('Kore');
    expect(first.romanized).toEqual(['saranghae', null]);
    expect(first.translated).toEqual(['사랑해 tr', 'Oh yeah tr']);
    await processLines(req);
    expect(g.requests).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('a line Google sends back unchanged (bar case or punctuation) has no translation', async () => {
    const g = googleFake();
    vi.stubGlobal('fetch', g.impl);
    const { processLines } = await import('../../src/background/text/process');
    const out = await processLines({ lines: ['aaja teriyaan duaavaan', 'saadi gali aaja'], language: 'pa', romanize: false, translateTo: 'en' });
    expect(out.translated).toEqual([null, null]); // "Aaja teriyaan duaavaan!" is the line again
    vi.unstubAllGlobals();
  });

  it('translates the English verses of a Korean song into Korean (not "already in Korean")', async () => {
    const g = googleFake({ mark: ' tr' });
    vi.stubGlobal('fetch', g.impl);
    const { processLines } = await import('../../src/background/text/process');
    const out = await processLines({ lines: ['보고 싶다', 'I just want you tonight'], language: 'ko', romanize: false, translateTo: 'ko' });
    expect(out.translated?.[1]).toBe('I just want you tonight tr');
    vi.unstubAllGlobals();
  });

  it('never asks again for lines already in the language translations go into (one request)', async () => {
    const g = googleFake({ mark: '' }); // Google sends the Korean lines back as they are
    vi.stubGlobal('fetch', g.impl);
    const { processLines } = await import('../../src/background/text/process');
    await processLines({ lines: ['보고 싶다', '사랑해 매일', 'I just want you tonight'], language: 'ko', romanize: false, translateTo: 'ko' });
    expect(g.requests).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('asks nothing for a Spanish song translated into Spanish, though one short line reads as English', async () => {
    const g = googleFake();
    vi.stubGlobal('fetch', g.impl);
    const { processLines } = await import('../../src/background/text/process');
    const out = await processLines({ lines: ['te quiero tanto', 'no, no, no', 'bailamos hasta el amanecer', 'la noche es nuestra', 'tu corazón es mío', 'ven conmigo esta noche'], language: 'es', romanize: false, translateTo: 'es' });
    expect(g.requests).toHaveLength(0);
    expect(out.translated).toBeNull();
    vi.unstubAllGlobals();
  });

  it('asks again, from the song\'s language, for its lines that came back unchanged (a mostly English request)', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      const sl = new URL(url).searchParams.get('sl') ?? '';
      asked.push(sl);
      const q = new URLSearchParams(String(init?.body)).get('q') ?? '';
      const lines = q.split('\n');
      // Detected as English: Korean words left as they were; from Korean, translated.
      const tr = (l: string) => (sl === 'ko' ? l.replace('말해줘', 'tell me') : l.includes('말해줘') ? l : `${l}`);
      const nl = (i: number) => (i < lines.length - 1 ? '\n' : '');
      return new Response(JSON.stringify({ sentences: lines.map((l, i) => ({ trans: tr(l) + nl(i), orig: l + nl(i) })) }));
    }) as typeof fetch);
    const { processLines } = await import('../../src/background/text/process');
    const out = await processLines({ lines: ['Baby I love you', "Don't want no riddle, 말해줘, say it back"], language: 'ko', romanize: false, translateTo: 'en' });
    expect(out.translated?.[1]).toBe("Don't want no riddle, tell me, say it back");
    expect(asked).toEqual(['auto', 'ko']);
    vi.unstubAllGlobals();
  });

  it('tries the repair again on the next play when it could not be asked', async () => {
    let koUp = false;
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      if (url.includes('translate_http') || url.includes('translate-pa')) return new Response('', { status: 500 });
      const sl = new URL(url).searchParams.get('sl') ?? '';
      if (sl === 'ko' && !koUp) return new Response('', { status: 503 });
      const q = new URLSearchParams(String(init?.body)).get('q') ?? '';
      const lines = q.split('\n');
      const nl = (i: number) => (i < lines.length - 1 ? '\n' : '');
      const tr = (l: string) => (sl === 'ko' ? l.replace('말해줘', 'tell me') : l);
      return new Response(JSON.stringify({ sentences: lines.map((l, i) => ({ trans: tr(l) + nl(i), orig: l + nl(i) })) }));
    }) as typeof fetch);
    const { processLines } = await import('../../src/background/text/process');
    const req = { lines: ['Baby I love you', "Don't want no riddle, 말해줘, say it back"], language: 'ko', romanize: false, translateTo: 'en' };
    expect((await processLines(req)).translated?.[1]).toBeNull();
    koUp = true;
    expect((await processLines(req)).translated?.[1]).toBe("Don't want no riddle, tell me, say it back");
    vi.unstubAllGlobals();
  });

  it('keeps romanization when translation fails, and says why', async () => {
    vi.stubGlobal('fetch', googleFake({ status: 429, widget: false }).impl);
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
