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
  it('asks both sources at once: a first play has seconds, not minutes', async () => {
    const order: string[] = [];
    const ytm = async () => { order.push('ytm start'); await new Promise((r) => setTimeout(r, 30)); order.push('ytm end'); return null; };
    const lrclib = async () => { order.push('lrclib start'); return [good]; };
    expect((await searchNative(req(spotifyHindi), { lrclib, ytm, romanize })).result?.aligned).toBe(true);
    expect(order.indexOf('lrclib start')).toBeLessThan(order.indexOf('ytm end'));
  });
  it('says the search was incomplete when YouTube Music fails, so "none" is not final', async () => {
    const ytm = async () => { throw new Error('YouTube Music HTTP 503'); };
    const other = { ...good, lines: [{ startMs: 0, text: 'कोई और गाना' }] };
    expect(await searchNative(req(spotifyHindi), { ...sources([other]), ytm })).toEqual({ result: null, complete: false });
    expect(await searchNative(req(spotifyHindi), sources([other]))).toEqual({ result: null, complete: true });
  });
});

// Made-up lines (not lyrics of any song), in the shapes Spotify serves multilingual songs.
describe('line by line: multilingual songs', () => {
  const tamilSong = {
    spotify: [
      'naan unnai kaadhalikkiren',       // romanized Tamil: restored
      'nee enakku uyir',                 // romanized Tamil: restored
      'चल तू खोने दे',                     // Hindi, already in its script: kept
      'all night long we dance',         // English: kept
      'en nenjil nee mattum',            // romanized Tamil: restored
      'naan unnai paarthen 10,000 वाला',  // Tamil and Hindi in one line: kept
    ],
    native: [
      'நான் உன்னை காதலிக்கிறேன்',
      'நீ எனக்கு உயிர்',
      'சல் தூ கோனே தே',                  // the copy writes the Hindi line in Tamil script
      'ஆல் நைட் லாங் வி டான்ஸ்',           // and the English line too
      'என் நெஞ்சில் நீ மட்டும்',
      'நான் உன்னை பார்த்தேன் 10,000 வாலா',
    ],
  };

  it('restores only the romanized lines; Hindi in its own script, English and mixed lines stay', async () => {
    const r = await fit(req(tamilSong.spotify, ['ta']), { lines: tamilSong.native.map((text, i) => ({ startMs: 1000 * (i + 1), text })), synced: true, source: 'LRCLIB' }, 'Taml', romanize);
    expect(r?.lines.map((l) => l.text)).toEqual([
      tamilSong.native[0], tamilSong.native[1], tamilSong.spotify[2], tamilSong.spotify[3], tamilSong.native[4], tamilSong.spotify[5],
    ]);
    expect(r).toMatchObject({ aligned: true, replaced: 3, total: 6 });
    expect(r?.lines.map((l) => l.startMs)).toEqual([1000, 2000, 3000, 4000, 5000, 6000]); // Spotify's timings
  });

  it('pairs by time when the copy has an extra line', async () => {
    const native = [...tamilSong.native.slice(0, 2), 'இசை', ...tamilSong.native.slice(2)];
    const times = [1000, 2000, 2600, 3000, 4000, 5000, 6000];
    const r = await fit(req(tamilSong.spotify, ['ta']), { lines: native.map((text, i) => ({ startMs: times[i], text })), synced: true, source: 'LRCLIB' }, 'Taml', romanize);
    expect(r?.lines[0].text).toBe(tamilSong.native[0]);
    expect(r?.lines[4].text).toBe(tamilSong.native[4]);
    expect(r?.lines[3].text).toBe(tamilSong.spotify[3]);
  });

  it('keeps an English chorus in English in a romanized Hindi song', async () => {
    const spotify = ['Mera dil tera hai, tu kahan hai yaar', 'Baby I love you, yeah', 'Phir bhi mujhe tujhse pyaar hai'];
    const native = ['मेरा दिल तेरा है, तू कहाँ है यार', 'बेबी आई लव यू, येह', 'फिर भी मुझे तुझसे प्यार है'];
    const r = await fit(req(spotify), { lines: native.map((text) => ({ startMs: 0, text })), synced: false, source: 'LRCLIB' }, 'Deva', romanize);
    expect(r?.lines.map((l) => l.text)).toEqual([native[0], spotify[1], native[2]]);
    expect(r).toMatchObject({ replaced: 2, total: 3 });
  });

  it('takes from a copy in another order only the lines that verify against their own line', async () => {
    const shifted = [tamilSong.native[1], tamilSong.native[4], tamilSong.native[2], tamilSong.native[3], tamilSong.native[0], tamilSong.native[5]];
    const r = await fit(req(tamilSong.spotify, ['ta']), { lines: shifted.map((text) => ({ startMs: 0, text })), synced: false, source: 'LRCLIB' }, 'Taml', romanize);
    // Every line it changed is that line in Tamil script; none took a neighbour's.
    r?.lines.forEach((l, i) => expect([tamilSong.spotify[i], tamilSong.native[i]]).toContain(l.text));
  });

  it('never carries a neighbour\'s line into a line (a timing that lets two in)', async () => {
    const lines = [...nativeHindi, 'फिर भी मुझे तुझसे प्यार है'].map((text, i) => ({ startMs: 500 * (i + 1), text }));
    const r = await fit(req(spotifyHindi), { lines, synced: true, source: 'LRCLIB' }, 'Deva', romanize);
    r?.lines.forEach((l, i) => expect(['', spotifyHindi[i], ...nativeHindi]).toContain(l.text));
  });

  it('picks the copy that improves the most lines, not the first that fits', async () => {
    const partial = tamilSong.native.map((t, i) => (i === 1 ? 'வேறு வரி' : t)); // one line differs
    const full = { lines: tamilSong.native.map((text, i) => ({ startMs: 1000 * (i + 1), text })), synced: true, durationKnown: true };
    const part = { lines: partial.map((text, i) => ({ startMs: 1000 * (i + 1), text })), synced: true, durationKnown: true };
    const { result } = await searchNative(req(tamilSong.spotify, ['ta']), { lrclib: async () => [part, full], romanize });
    expect(result?.lines[1].text).toBe(tamilSong.native[1]);
    expect(result).toMatchObject({ replaced: 3, total: 6 });
  });

  it('asks no source for a Korean song Spotify has in Hangul with English verses', async () => {
    let asked = false;
    const spy: NativeSources = { lrclib: async () => { asked = true; return []; }, romanize };
    const kpop = ['보고 싶다 너를', 'I just want you tonight', '사랑해 매일', 'baby you are my love'];
    expect((await searchNative(req(kpop, ['ko']), spy)).result).toBeNull();
    expect(asked).toBe(false);
  });

  it('tries identical uploads once', async () => {
    let calls = 0;
    const counting: NativeSources['romanize'] = async (lines, script) => { calls++; return romanize(lines, script); };
    const copy = { lines: tamilSong.native.map((text, i) => ({ startMs: 1000 * (i + 1), text })), synced: true, durationKnown: true };
    await searchNative(req(tamilSong.spotify, ['ta']), { lrclib: async () => [copy, { ...copy }, { ...copy }], romanize: counting });
    expect(calls).toBe(1);
  });
});
