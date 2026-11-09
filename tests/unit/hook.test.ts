import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakePage, json, tick } from '../helpers/fakePage';

const fixture = (name: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${name}`, 'utf8'));

const NO_LYRICS_ID = '33BdipYlRY2WBvIBNk4Wmn';
const NO_LYRICS_META = `https://spclient.wg.spotify.com/metadata/4/track/647a7f80ed7b47578743b227e6bfb793?market=from_token`;
const HINDI_ID = '0296TIIbB3u904riPYGPJJ';
const HINDI_META = `https://spclient.wg.spotify.com/metadata/4/track/0123456789abcdef0123456789abcdef?market=from_token`;
const lyricsUrl = (id: string) => `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}/image/https%3A%2F%2Fi.scdn.co%2Fimage%2Fx?format=json&vocalRemoval=false&market=from_token`;

const found = { lines: [{ startMs: 1000, text: 'ずっと' }, { startMs: 4000, text: 'そばで' }], synced: true, source: 'LRCLIB' };

describe('page hook: track metadata', () => {
  it('claims lyrics for a song without them, keeping every other field', async () => {
    const page = fakePage({ routes: { 'metadata/4': () => json(fixture('metadata-no-lyrics.json')) } });
    const body = await (await page.fetch(NO_LYRICS_META)).json();
    expect(body.has_lyrics).toBe(true);
    expect(body.name).toBe('まどろみ');
    expect(body.language_of_performance).toEqual(['ja']);
    await tick();
    expect(page.events.find((e) => e.type === 'meta')?.data).toMatchObject({ id: NO_LYRICS_ID, hasLyrics: false, durationMs: 250040 });
  });

  it('leaves songs with lyrics alone', async () => {
    const page = fakePage({ routes: { 'metadata/4': () => json(fixture('metadata-hindi.json')) } });
    const res = await page.fetch(HINDI_META);
    expect((await res.json()).has_lyrics).toBe(true);
  });

  it('claims nothing for a song known to have none', async () => {
    for (const config of [{ noLyrics: [NO_LYRICS_ID] }]) {
      const page = fakePage({ routes: { 'metadata/4': () => json(fixture('metadata-no-lyrics.json')) }, config });
      await tick(); // let the content script's settings arrive
      expect((await (await page.fetch(NO_LYRICS_META)).json()).has_lyrics).toBeUndefined();
    }
  });

  it('passes errors and other URLs through untouched', async () => {
    const page = fakePage({ routes: { 'metadata/4': () => new Response('nope', { status: 500 }), 'other': () => new Response('x') } });
    expect((await page.fetch(NO_LYRICS_META)).status).toBe(500);
    expect(await (await page.fetch('https://spclient.wg.spotify.com/other/thing')).text()).toBe('x');
  });
});

describe('page hook: lyrics Spotify does not have', () => {
  const routes = (lyrics: () => Response) => ({ 'metadata/4': () => json(fixture('metadata-no-lyrics.json')), 'color-lyrics': lyrics });

  it('answers the 404 with lyrics found elsewhere, in Spotify\'s format', async () => {
    const page = fakePage({ routes: routes(() => new Response('', { status: 404 })), answer: () => found });
    await page.fetch(NO_LYRICS_META);
    const res = await page.fetch(lyricsUrl(NO_LYRICS_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lyrics.syncType).toBe('LINE_SYNCED');
    expect(body.lyrics.lines.map((l: any) => [l.startTimeMs, l.words])).toEqual([['1000', 'ずっと'], ['4000', 'そばで']]);
    expect(body.lyrics.providerDisplayName).toBe('LRCLIB · Spotify Karaoke'); // Spotify's footer: "Lyrics provided by …"
    expect(page.calls[0]).toMatchObject({ type: 'findLyrics', data: { id: NO_LYRICS_ID, name: 'まどろみ' } });
  });

  it('keeps the 404 when nothing is found, or the lookup is too slow', async () => {
    for (const answer of [() => null, () => new Promise(() => {})]) {
      const page = fakePage({ routes: routes(() => new Response('', { status: 404 })), answer });
      await page.fetch(NO_LYRICS_META);
      expect((await page.fetch(lyricsUrl(NO_LYRICS_ID))).status).toBe(404);
    }
  });

  it('keeps the 404 when the track\'s metadata never came', async () => {
    const page = fakePage({ routes: { 'color-lyrics': () => new Response('', { status: 404 }) }, answer: () => found });
    expect((await page.fetch(lyricsUrl(NO_LYRICS_ID))).status).toBe(404);
    expect(page.calls).toHaveLength(0);
  });
});

describe('page hook: lyrics Spotify has', () => {
  it('reports them and returns Spotify\'s response unchanged', async () => {
    const native = fixture('color-lyrics-romanized-hindi.json');
    native.lyrics.lines = native.lyrics.lines.map((l: any) => ({ ...l, words: l.words ? 'तुम ही हो' : '' }));
    const page = fakePage({ routes: { 'metadata/4': () => json(fixture('metadata-hindi.json')), 'color-lyrics': () => json(native) } });
    await page.fetch(HINDI_META);
    const body = await (await page.fetch(lyricsUrl(HINDI_ID))).json();
    expect(body).toEqual(native);
    await tick();
    expect(page.events.find((e) => e.type === 'lyrics')?.data).toMatchObject({ id: HINDI_ID, source: 'spotify' });
    expect(page.calls).toHaveLength(0);
  });

  it('passes a body that is not JSON through untouched', async () => {
    const page = fakePage({ routes: { 'color-lyrics': () => new Response('<html>oops</html>', { status: 200 }) } });
    const res = await page.fetch(lyricsUrl(HINDI_ID));
    expect(await res.text()).toBe('<html>oops</html>');
  });

  it('restores the original script of romanized lyrics, keeping Spotify\'s timings', async () => {
    const roman = fixture('color-lyrics-romanized-hindi.json');
    const page = fakePage({
      routes: { 'metadata/4': () => json(fixture('metadata-hindi.json')), 'color-lyrics': () => json(roman) },
      answer: (type, data: any) =>
        type === 'restoreNative'
          ? { lines: data.lines.map((t: string, i: number) => ({ startMs: data.times[i], text: t ? `देवनागरी ${i}` : '' })), synced: true, source: 'LRCLIB', aligned: true }
          : null,
    });
    await page.fetch(HINDI_META);
    const body = await (await page.fetch(lyricsUrl(HINDI_ID))).json();
    expect(body.lyrics.lines[0]).toMatchObject({ startTimeMs: '780', words: 'देवनागरी 0' });
    expect(page.calls[0]).toMatchObject({ type: 'restoreNative', data: { synced: true } });
    expect(page.calls[0].data.lines[0]).toBe('Mera dil tera hai, tu kahan hai yaar');
  });

  it('waits a little for metadata that arrives after the lyrics request', async () => {
    const roman = fixture('color-lyrics-romanized-hindi.json');
    const page = fakePage({
      routes: { 'metadata/4': () => json(fixture('metadata-hindi.json')), 'color-lyrics': () => json(roman) },
      answer: () => null,
    });
    const pending = page.fetch(lyricsUrl(HINDI_ID));
    await tick(20);
    await page.fetch(HINDI_META);
    await pending;
    expect(page.calls.map((c) => c.type)).toEqual(['restoreNative']);
  });

  it('upgrades unsynced lyrics to a synced copy in the same script only', async () => {
    const unsynced = (words: string) => ({ lyrics: { syncType: 'UNSYNCED', lines: [{ startTimeMs: '0', words }, { startTimeMs: '0', words }], language: 'ja' } });
    const meta = fixture('metadata-no-lyrics.json');
    meta.has_lyrics = true;
    for (const [answer, expected] of [
      [found, 'LINE_SYNCED'],
      [{ ...found, lines: [{ startMs: 1000, text: 'zutto' }] }, 'UNSYNCED'],
    ] as const) {
      const page = fakePage({ routes: { 'metadata/4': () => json(meta), 'color-lyrics': () => json(unsynced('ずっと')) }, answer: () => answer });
      await page.fetch(NO_LYRICS_META);
      expect((await (await page.fetch(lyricsUrl(NO_LYRICS_ID))).json()).lyrics.syncType).toBe(expected);
    }
  });
});

describe('page hook: channel', () => {
  it('holds its messages until the content script is listening', async () => {
    const page = fakePage({
      routes: { 'metadata/4': () => json(fixture('metadata-no-lyrics.json')), 'color-lyrics': () => new Response('', { status: 404 }) },
      answer: () => found,
      contentLate: true,
      timing: { lookupMs: 500 },
    });
    await page.fetch(NO_LYRICS_META);
    const pending = page.fetch(lyricsUrl(NO_LYRICS_ID));
    await tick(30);
    expect(page.calls).toHaveLength(0);
    page.connect();
    expect((await pending).status).toBe(200);
    expect(page.events.map((e) => e.type)).toContain('meta');
  });

  it('wraps fetch only once', async () => {
    const page = fakePage({ routes: {} });
    const wrapped = page.win.fetch;
    const { installHook } = await import('../../src/page/hook');
    installHook(page.win);
    expect(page.win.fetch).toBe(wrapped);
  });

  it('keeps a decision log', async () => {
    const page = fakePage({ routes: { 'metadata/4': () => json(fixture('metadata-no-lyrics.json')) } });
    await page.fetch(NO_LYRICS_META);
    expect(page.log().some((l) => l.includes(`meta ${NO_LYRICS_ID} has_lyrics=false lang=ja`))).toBe(true);
  });
});
