import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePage, json } from '../helpers/fakePage';
import { installChromeStorage } from '../helpers/chrome';
import { buildColorLyrics, classify, harvestTracks } from '../../src/page/spotifyFormat';
import { fit } from '../../src/background/lyrics/native';
import { romanizeLines } from '../../src/background/text/romanize';
import { LineStore } from '../../src/content/lineStore';
import { DEFAULT_SETTINGS, type TrackMeta } from '../../src/shared/types';

const fixture = (name: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${name}`, 'utf8'));
const lyricsUrl = (id: string, host = 'spclient.wg.spotify.com') => `https://${host}/color-lyrics/v2/track/${id}/image/x?format=json`;
const NO_LYRICS_ID = '33BdipYlRY2WBvIBNk4Wmn';
const NO_LYRICS_META = 'https://spclient.wg.spotify.com/metadata/4/track/647a7f80ed7b47578743b227e6bfb793';

/** A GraphQL response shaped like Spotify's album/playlist track items. */
const graphql = {
  data: { albumUnion: { tracksV2: { items: [{ track: {
    uri: `spotify:track:${NO_LYRICS_ID}`,
    name: 'まどろみ',
    duration: { totalMilliseconds: 250040 },
    artists: { items: [{ profile: { name: 'Naoko Gushima' } }] },
    albumOfTrack: { name: 'Best' },
  } }] } } },
};

describe('Spotify requests', () => {
  it('are recognized on any Spotify host, and only there', () => {
    expect(classify(lyricsUrl(NO_LYRICS_ID))).toEqual({ kind: 'lyrics', id: NO_LYRICS_ID });
    expect(classify(lyricsUrl(NO_LYRICS_ID, 'gae2-spclient.spotify.com'))).toEqual({ kind: 'lyrics', id: NO_LYRICS_ID });
    expect(classify(NO_LYRICS_META)).toEqual({ kind: 'metadata', gid: '647a7f80ed7b47578743b227e6bfb793' });
    expect(classify('https://api-partner.spotify.com/pathfinder/v2/query')).toEqual({ kind: 'graphql' });
    expect(classify(lyricsUrl(NO_LYRICS_ID, 'spotify.com.evil.example'))).toBeNull();
    expect(classify(`http://spclient.wg.spotify.com/color-lyrics/v2/track/${NO_LYRICS_ID}`)).toBeNull();
    expect(classify('not a url')).toBeNull();
  });

  it('track details come out of GraphQL responses', () => {
    expect(harvestTracks(graphql)).toEqual([{ id: NO_LYRICS_ID, name: 'まどろみ', artists: ['Naoko Gushima'], album: 'Best', durationMs: 250040 }]);
    expect(harvestTracks({ a: [{ uri: 'spotify:episode:x', name: 'podcast' }] })).toEqual([]);
  });

  it('marks right-to-left lyrics as such', () => {
    expect(buildColorLyrics({ lines: [{ startMs: 0, text: 'أحبك يا حبيبي' }], synced: false, source: 'x' }, 'ar').lyrics.isRtlLanguage).toBe(true);
    expect(buildColorLyrics({ lines: [{ startMs: 0, text: 'hello' }], synced: false, source: 'x' }, null).lyrics.isRtlLanguage).toBe(false);
  });
});

describe('page hook: integration', () => {
  const found = { lines: [{ startMs: 1000, text: 'ずっと' }], synced: true, source: 'LRCLIB' };

  it('finds lyrics with GraphQL details when the metadata request never came', async () => {
    const page = fakePage({
      routes: { pathfinder: () => json(graphql), 'color-lyrics': () => new Response('', { status: 404 }) },
      answer: () => found,
    });
    await page.fetch('https://api-partner.spotify.com/pathfinder/v2/query');
    await new Promise((r) => setTimeout(r, 10));
    const res = await page.fetch(lyricsUrl(NO_LYRICS_ID, 'gae2-spclient.spotify.com'));
    expect(res.status).toBe(200);
    expect(page.calls[0].data).toMatchObject({ id: NO_LYRICS_ID, name: 'まどろみ', artists: ['Naoko Gushima'], durationMs: 250040 });
  });

  it('waits for the settings before claiming lyrics, even when they arrive late', async () => {
    const page = fakePage({
      routes: { 'metadata/4': () => json(fixture('metadata-no-lyrics.json')) },
      config: { spotifyOnly: [NO_LYRICS_ID] },
      contentLate: true,
    });
    const pending = page.fetch(NO_LYRICS_META);
    await new Promise((r) => setTimeout(r, 20));
    page.connect();
    expect((await (await pending).json()).has_lyrics).toBeUndefined();
  });

  it('recognizes romanized lyrics by their words when the metadata has no language', async () => {
    const meta = fixture('metadata-hindi.json');
    meta.language_of_performance = [];
    const roman = fixture('color-lyrics-romanized-hindi.json'); // tagged "id" by Spotify
    const page = fakePage({ routes: { 'metadata/4': () => json(meta), 'color-lyrics': () => json(roman) }, answer: () => null });
    await page.fetch('https://spclient.wg.spotify.com/metadata/4/track/0123456789abcdef0123456789abcdef');
    await page.fetch(lyricsUrl('0296TIIbB3u904riPYGPJJ'));
    expect(page.calls[0]).toMatchObject({ type: 'restoreNative', data: { meta: { languages: ['hi'] } } });
  });

  it('leaves Latin-script songs alone', async () => {
    const meta = fixture('metadata-hindi.json');
    meta.language_of_performance = ['en'];
    const english = { lyrics: { syncType: 'LINE_SYNCED', language: 'en', lines: Array.from({ length: 8 }, (_, i) => ({ startTimeMs: String(i * 1000), words: 'I walk along the empty road tonight' })) } };
    const page = fakePage({ routes: { 'metadata/4': () => json(meta), 'color-lyrics': () => json(english) }, answer: () => null });
    await page.fetch('https://spclient.wg.spotify.com/metadata/4/track/0123456789abcdef0123456789abcdef');
    await page.fetch(lyricsUrl('0296TIIbB3u904riPYGPJJ'));
    expect(page.calls).toHaveLength(0);
  });
});

describe('native restoration: pairing by time', () => {
  const romanize = (lines: string[], script: any) => romanizeLines(lines, script, { google: async () => null });
  const meta: TrackMeta = { id: 'x'.repeat(22), name: 'S', artists: ['A'], album: '', durationMs: 200000, languages: ['hi'], hasLyrics: true };

  it('keeps Spotify\'s lines and timings when the native copy splits lines differently', async () => {
    const req = { meta, lines: ['Mera dil tera hai tu kahan hai yaar', 'Phir bhi mujhe tujhse pyaar hai'], times: [1000, 9000], synced: true };
    const cand = {
      lines: [
        { startMs: 1100, text: 'मेरा दिल तेरा है' }, { startMs: 4800, text: 'तू कहाँ है यार' },
        { startMs: 9050, text: 'फिर भी मुझे तुझसे प्यार है' },
      ],
      synced: true,
      source: 'LRCLIB',
    };
    const r = await fit(req, cand, 'Deva', romanize);
    expect(r).toMatchObject({ aligned: true, synced: true });
    expect(r?.lines).toEqual([{ startMs: 1000, text: 'मेरा दिल तेरा है तू कहाँ है यार' }, { startMs: 9000, text: 'फिर भी मुझे तुझसे प्यार है' }]);
  });
});

describe('restored songs', () => {
  it('show Spotify\'s own romanization, line for line', () => {
    const store = new LineStore(async () => ({ script: 'Deva', romanized: ['ours'], translated: null }), { ...DEFAULT_SETTINGS, mode: 'romanized' });
    const song = store.addRestored(['Mera dil tera hai'], ['मेरा दिल तेरा है'], 'hi');
    expect(store.resolve(song, 'मेरा दिल तेरा है')?.info.romanized).toBe('Mera dil tera hai');
  });
});

describe('no-lyrics list', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });
  const meta: TrackMeta = { id: 'z'.repeat(22), name: 'Instrumental', artists: ['A'], album: '', durationMs: 200000, languages: [], hasLyrics: false };

  it('lists songs no source has, and forgets them once lyrics appear', async () => {
    const { findLyrics, knownNoLyrics } = await import('../../src/background/lyrics/find');
    let t = 0;
    await findLyrics(meta, { lrclib: async () => null }, () => t);
    expect(await knownNoLyrics(t)).toEqual([meta.id]);
    t = 4 * 24 * 3600_000;
    expect(await knownNoLyrics(t)).toEqual([]);
    await findLyrics(meta, { lrclib: async () => ({ synced: '[00:01.00]la', plain: 'la', instrumental: false }) }, () => t);
    expect(await knownNoLyrics(t)).toEqual([]);
  });

  it('does not list a song when a source was down', async () => {
    const { findLyrics, knownNoLyrics } = await import('../../src/background/lyrics/find');
    await findLyrics(meta, { lrclib: async () => { throw new Error('offline'); } }, () => 0);
    expect(await knownNoLyrics(0)).toEqual([]);
  });
});

describe('lyrics we supply, in Spotify\'s format', () => {
  const found = (lines: string[]) => ({ lines: lines.map((text, i) => ({ startMs: i * 1000, text })), synced: true, source: 'LRCLIB' });

  it('mark dense scripts, as Spotify does, and not Latin ones', () => {
    expect(buildColorLyrics(found(['보고 싶다']), 'ko').lyrics.isDenseTypeface).toBe(true);
    expect(buildColorLyrics(found(['मेरा दिल']), 'hi').lyrics.isDenseTypeface).toBe(true);
    expect(buildColorLyrics(found(['bogo sipda']), null).lyrics.isDenseTypeface).toBe(false);
  });

  it('preview real lines, not ♪ or blanks', () => {
    expect(buildColorLyrics(found(['♪', '', 'one', 'two', 'three', 'four']), null).lyrics.previewLines.map((l) => l.words)).toEqual(['one', 'two', 'three']);
  });

  it('keep Spotify\'s album colours when replacing its response, and credit the source and us', () => {
    const colors = { background: -2543255, text: -16777216, highlightText: -1 };
    const built = buildColorLyrics(found(['a']), null, { colors, hasVocalRemoval: true });
    expect(built.colors).toEqual(colors);
    expect(built.hasVocalRemoval).toBe(true);
    expect(built.lyrics.providerDisplayName).toBe('LRCLIB · Spotify Karaoke');
  });
});
