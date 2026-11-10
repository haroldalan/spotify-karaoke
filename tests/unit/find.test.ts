import { describe, expect, it } from 'vitest';
import { searchLyrics } from '../../src/background/lyrics/find';
import type { TrackMeta } from '../../src/shared/types';

const meta: TrackMeta = { id: 'x'.repeat(22), name: 'Song', artists: ['Artist'], album: 'Album', durationMs: 200000, languages: [], hasLyrics: false };

describe('searchLyrics', () => {
  it('prefers synced lyrics', async () => {
    const r = await searchLyrics(meta, { lrclib: async () => ({ synced: '[00:01.00]one\n[00:02.00]two', plain: 'one\ntwo', instrumental: false }) });
    expect(r.found).toMatchObject({ synced: true, source: 'LRCLIB' });
    expect(r.found?.lines).toEqual([{ startMs: 1000, text: 'one' }, { startMs: 2000, text: 'two' }]);
    expect(r.complete).toBe(true);
  });
  it('falls back to plain lyrics', async () => {
    const r = await searchLyrics(meta, { lrclib: async () => ({ synced: null, plain: 'one\ntwo', instrumental: false }) });
    expect(r.found).toMatchObject({ synced: false });
    expect(r.found?.lines.map((l) => l.startMs)).toEqual([0, 0]);
  });
  it('says "not found" only when every source answered', async () => {
    expect(await searchLyrics(meta, { lrclib: async () => null })).toEqual({ found: null, complete: true, instrumental: false });
    expect(await searchLyrics(meta, { lrclib: async () => { throw new Error('offline'); } })).toEqual({ found: null, complete: false, instrumental: false });
  });
  it('tells an instrumental (LRCLIB says so) from a song nothing was found for', async () => {
    const inst = async () => ({ synced: null, plain: null, instrumental: true });
    expect(await searchLyrics(meta, { lrclib: inst })).toMatchObject({ found: null, complete: true, instrumental: true });
  });
  it('ranks licensed synced first, crowd-sourced synced next, licensed plain above crowd-sourced plain', async () => {
    const yt = (synced: boolean) => async () => ({ lines: [{ startMs: synced ? 500 : 0, text: 'yt' }], synced, source: 'LyricFind via YouTube Music' });
    const lrSynced = async () => ({ synced: '[00:01.00]lr', plain: 'lr', instrumental: false });
    const lrPlain = async () => ({ synced: null, plain: 'lr', instrumental: false });
    expect((await searchLyrics(meta, { lrclib: lrSynced, ytm: yt(true) })).found?.lines[0].text).toBe('yt');
    expect((await searchLyrics(meta, { lrclib: lrSynced, ytm: yt(false) })).found?.lines[0].text).toBe('lr');
    expect((await searchLyrics(meta, { lrclib: lrPlain, ytm: yt(false) })).found?.lines[0].text).toBe('yt');
  });
});
