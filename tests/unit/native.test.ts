import { describe, expect, it } from 'vitest';
import { fit, searchNative, similarity, skeleton, type NativeRequest, type NativeSources } from '../../src/background/lyrics/native';
import { romanizeLines } from '../../src/background/text/romanize';
import { expectedScript } from '../../src/shared/scripts';
import type { TrackMeta } from '../../src/shared/types';

const romanize: NativeSources['romanize'] = (lines, script) => romanizeLines(lines, script, { google: async () => null });
const meta = (languages: string[]): TrackMeta => ({ id: 'x'.repeat(22), name: 'Song', artists: ['A'], album: '', durationMs: 200000, languages, hasLyrics: true });

// Spotify's romanized fallback (the fixture's style) and the same song in Devanagari.
const spotifyHindi = ['Mera dil tera hai, tu kahan hai yaar', '', 'Main har pal teri yaad mein rehta hoon', 'Phir bhi mujhe tujhse pyaar hai'];
const nativeHindi = ['मेरा दिल तेरा है, तू कहाँ है यार', 'मैं हर पल तेरी याद में रहता हूँ', 'फिर भी मुझे तुझसे प्यार है'];
const req = (lines: string[], languages = ['hi'], synced = true): NativeRequest => ({
  meta: meta(languages),
  lines,
  times: lines.map((_, i) => 1000 * (i + 1)),
  synced,
});

describe('similarity', () => {
  it('sees through romanization schemes', () => {
    expect(skeleton('Thangamae')).toBe(skeleton('thangame'));
    expect(similarity('Phir bhi mujhe tujhse pyaar hai', 'phir bhi mujhe tujhse pyar hai')).toBeGreaterThan(0.9);
    expect(similarity('Mera dil tera hai', 'Kabhi kabhi mere dil mein')).toBeLessThan(0.45);
  });
});

describe('expectedScript', () => {
  it('maps languages to their scripts', () => {
    expect(expectedScript(['hi'])).toBe('Deva');
    expect(expectedScript(['ta'])).toBe('Taml');
    expect(expectedScript(['pt-BR'])).toBeNull();
    expect(expectedScript([])).toBeNull();
  });
});

describe('fit', () => {
  it('aligned: keeps Spotify timings and empty lines, swaps the text', async () => {
    const r = await fit(req(spotifyHindi), { lines: nativeHindi.map((text) => ({ startMs: 0, text })), synced: false, source: 'LRCLIB' }, 'Deva', romanize);
    expect(r?.aligned).toBe(true);
    expect(r?.lines.map((l) => l.text)).toEqual([nativeHindi[0], '', nativeHindi[1], nativeHindi[2]]);
    expect(r?.lines.map((l) => l.startMs)).toEqual([1000, 2000, 3000, 4000]);
  });
  it('own timing: a synced copy with a line more', async () => {
    const lines = [...nativeHindi, 'फिर भी मुझे तुझसे प्यार है'].map((text, i) => ({ startMs: 500 * (i + 1), text }));
    const r = await fit(req(spotifyHindi), { lines, synced: true, source: 'LRCLIB' }, 'Deva', romanize);
    expect(r).toMatchObject({ aligned: false, synced: true });
    expect(r?.lines[0].startMs).toBe(500);
  });
  it('refuses another song in the right script', async () => {
    const other = ['कभी कभी मेरे दिल में ख़याल आता है', 'के जैसे तुझको बनाया गया है', 'मेरे लिए'];
    expect(await fit(req(spotifyHindi), { lines: other.map((text) => ({ startMs: 0, text })), synced: true, source: 'LRCLIB' }, 'Deva', romanize)).toBeNull();
  });
  it('refuses a copy in the wrong script', async () => {
    expect(await fit(req(spotifyHindi), { lines: spotifyHindi.map((text) => ({ startMs: 0, text })), synced: true, source: 'LRCLIB' }, 'Deva', romanize)).toBeNull();
  });
});

describe('searchNative', () => {
  const sources = (cands: { lines: { startMs: number; text: string }[]; synced: boolean; durationKnown: boolean }[]): NativeSources => ({
    lrclib: async () => cands,
    romanize,
  });
  const good = { lines: nativeHindi.map((text) => ({ startMs: 0, text })), synced: false, durationKnown: true };
  it('restores romanized Hindi', async () => {
    expect((await searchNative(req(spotifyHindi), sources([good]))).result?.aligned).toBe(true);
  });
  it('needs a known duration for crowd-sourced copies', async () => {
    expect((await searchNative(req(spotifyHindi), sources([{ ...good, durationKnown: false }]))).result).toBeNull();
  });
  it('leaves lyrics already in their script, and Latin-script languages, alone', async () => {
    let asked = false;
    const spy: NativeSources = { lrclib: async () => { asked = true; return [good]; }, romanize };
    expect((await searchNative(req(nativeHindi), spy)).result).toBeNull();
    expect((await searchNative(req(spotifyHindi, ['es']), spy)).result).toBeNull();
    expect(asked).toBe(false);
  });
  it('tries licensed lyrics first', async () => {
    const ytm = async () => ({ lines: nativeHindi.map((text) => ({ startMs: 0, text })), synced: false, source: 'LyricFind via YouTube Music' });
    expect((await searchNative(req(spotifyHindi), { ...sources([good]), ytm })).result?.source).toBe('LyricFind via YouTube Music');
  });
  it('says the search was incomplete when YouTube Music fails, so "none" is not final', async () => {
    const ytm = async () => { throw new Error('YouTube Music HTTP 503'); };
    const other = { ...good, lines: [{ startMs: 0, text: 'कोई और गाना' }] };
    expect(await searchNative(req(spotifyHindi), { ...sources([other]), ytm })).toEqual({ result: null, complete: false });
    expect(await searchNative(req(spotifyHindi), sources([other]))).toEqual({ result: null, complete: true });
  });
});
