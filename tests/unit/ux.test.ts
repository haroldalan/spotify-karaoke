import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from '../helpers/chrome';
import { fakePage, json } from '../helpers/fakePage';
import { browserTargetLanguage } from '../../src/shared/settings';
import type { TrackMeta } from '../../src/shared/types';

describe('target language from the browser', () => {
  it.each([
    ['en-US', 'en'], ['hi-IN', 'hi'], ['ja', 'ja'], ['zh-TW', 'zh-TW'], ['zh-Hant-HK', 'zh-TW'], ['zh', 'zh-CN'],
    ['he-IL', 'iw'], ['nb-NO', 'no'], ['tlh', 'en'], ['', 'en'],
  ])('%s -> %s', (lang, code) => expect(browserTargetLanguage(lang)).toBe(code));
});

describe('Google backoff', () => {
  beforeEach(() => vi.resetModules());

  it('stops asking for a while after a 429, then tries again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { googleLines, googleBlockedUntil, RateLimited } = await import('../../src/background/text/google');
    let calls = 0;
    const limited = (async () => { calls++; return new Response('', { status: 429 }); }) as typeof fetch;
    await expect(googleLines(['a'], 'en', false, limited)).rejects.toBeInstanceOf(RateLimited);
    expect(googleBlockedUntil()).toBeGreaterThan(Date.now());
    await expect(googleLines(['a'], 'en', false, limited)).rejects.toBeInstanceOf(RateLimited);
    expect(calls).toBe(1); // the second request never left
    vi.setSystemTime(Date.now() + 61_000);
    const ok = (async () => new Response(JSON.stringify({ sentences: [{ trans: 'b' }] }))) as typeof fetch;
    expect((await googleLines(['a'], 'en', false, ok)).translated).toEqual(['b']);
    vi.useRealTimers();
  });
});

describe('translation', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('is skipped when the song is already in the target language', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', (async () => { calls++; return new Response(JSON.stringify({ sentences: [{ trans: 'x' }] })); }) as typeof fetch);
    const { processLines } = await import('../../src/background/text/process');
    await processLines({ lines: ['मेरा दिल'], language: 'hi', romanize: false, translateTo: 'hi' });
    await processLines({ lines: ['I walk alone'], language: 'en', romanize: false, translateTo: 'en' });
    expect(calls).toBe(0);
    // A romanized Hindi song tagged "hi" is not Hindi script: still translated.
    await processLines({ lines: ['mera dil'], language: 'hi', romanize: false, translateTo: 'hi' });
    expect(calls).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('search again', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });
  const meta: TrackMeta = { id: 'q'.repeat(22), name: 'Song', artists: ['A'], album: '', durationMs: 200000, languages: [], hasLyrics: false };

  it('forgets "no lyrics" and asks the sources now', async () => {
    const { findLyrics, retryLyrics, knownNoLyrics } = await import('../../src/background/lyrics/find');
    await findLyrics(meta, { lrclib: async () => null });
    expect(await knownNoLyrics()).toEqual([meta.id]);
    const found = await retryLyrics(meta, { lrclib: async () => ({ synced: '[00:01.00]now', plain: 'now', instrumental: false }) });
    expect(found?.lines[0].text).toBe('now');
    expect(await knownNoLyrics()).toEqual([]);
  });
});

describe('page hook: reports empty lookups', () => {
  it('tells the content script whether lyrics were found for a song Spotify has none for', async () => {
    const meta = JSON.parse((await import('node:fs')).readFileSync('tests/fixtures/metadata-no-lyrics.json', 'utf8'));
    const page = fakePage({ routes: { 'metadata/4': () => json(meta), 'color-lyrics': () => new Response('', { status: 404 }) }, answer: () => null });
    await page.fetch('https://spclient.wg.spotify.com/metadata/4/track/647a7f80ed7b47578743b227e6bfb793');
    await page.fetch('https://spclient.wg.spotify.com/color-lyrics/v2/track/33BdipYlRY2WBvIBNk4Wmn/image/x');
    await new Promise((r) => setTimeout(r, 0));
    expect(page.events.find((e) => e.type === 'missing')?.data).toEqual({ id: '33BdipYlRY2WBvIBNk4Wmn', found: false });
  });
});
