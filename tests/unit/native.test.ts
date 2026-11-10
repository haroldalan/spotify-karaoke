import { describe, expect, it } from 'vitest';
import { fit, searchNative, similarity, skeleton, wholeMeasures, type NativeRequest, type NativeSources } from '../../src/background/lyrics/native';
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

const timed = (lines: string[], step = 1000, offset = 0) => lines.map((text, i) => ({ startMs: offset + step * (i + 1), text }));

describe('fit: a whole copy, judged', () => {
  it('takes a synced copy whole, with its own timings', async () => {
    const r = await fit(req(spotifyHindi), { lines: timed(nativeHindi, 900, 50), synced: true, source: 'LRCLIB' }, 'Deva', romanize);
    expect(r?.lines).toEqual(timed(nativeHindi, 900, 50));
    expect(r?.synced).toBe(true);
  });
  it('one for one with Spotify\'s lines: an overlay for when it arrives after Spotify drew its own', async () => {
    const r = await fit(req(spotifyHindi), { lines: timed(nativeHindi), synced: true, source: 'LRCLIB' }, 'Deva', romanize);
    expect(r?.aligned).toBe(true);
    expect(r?.overlay).toEqual([nativeHindi[0], '', nativeHindi[1], nativeHindi[2]]);
  });
  it('a copy with a line more is still the song (its own timings), but no overlay', async () => {
    const r = await fit(req(spotifyHindi), { lines: timed([...nativeHindi, 'फिर भी मुझे तुझसे प्यार है']), synced: true, source: 'LRCLIB' }, 'Deva', romanize);
    expect(r).toMatchObject({ aligned: false, synced: true });
    expect(r?.overlay).toBeUndefined();
  });
  it('never trades synced lyrics for unsynced ones; both unsynced is fine', async () => {
    const cand = { lines: nativeHindi.map((text) => ({ startMs: 0, text })), synced: false, source: 'LRCLIB' };
    expect(await fit(req(spotifyHindi), cand, 'Deva', romanize)).toBeNull();
    expect((await fit(req(spotifyHindi, ['hi'], false), cand, 'Deva', romanize))?.synced).toBe(false);
  });
  it('refuses another song in the right script', async () => {
    const other = ['कभी कभी मेरे दिल में ख़याल आता है', 'के जैसे तुझको बनाया गया है', 'मेरे लिए'];
    expect(await fit(req(spotifyHindi), { lines: timed(other), synced: true, source: 'LRCLIB' }, 'Deva', romanize)).toBeNull();
  });
  it('refuses a copy in the wrong script', async () => {
    expect(await fit(req(spotifyHindi), { lines: timed(spotifyHindi), synced: true, source: 'LRCLIB' }, 'Deva', romanize)).toBeNull();
  });
});

describe('searchNative', () => {
  const sources = (cands: { lines: { startMs: number; text: string }[]; synced: boolean; durationKnown: boolean }[]): NativeSources => ({
    lrclib: async () => cands,
    romanize,
  });
  const good = { lines: timed(nativeHindi), synced: true, durationKnown: true };
  it('restores romanized Hindi', async () => {
    expect((await searchNative(req(spotifyHindi), sources([good]))).result?.lines).toEqual(timed(nativeHindi));
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
  it('prefers licensed lyrics over crowd-sourced ones that also fit', async () => {
    const ytm = async () => ({ lines: timed(nativeHindi), synced: true, source: 'LyricFind via YouTube Music' });
    expect((await searchNative(req(spotifyHindi), { ...sources([good]), ytm })).result?.source).toBe('LyricFind via YouTube Music');
  });
  it('asks both sources at once: a first play has seconds, not minutes', async () => {
    const order: string[] = [];
    const ytm = async () => { order.push('ytm start'); await new Promise((r) => setTimeout(r, 30)); order.push('ytm end'); return null; };
    const lrclib = async () => { order.push('lrclib start'); return [good]; };
    expect((await searchNative(req(spotifyHindi), { lrclib, ytm, romanize })).result).not.toBeNull();
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
describe('multilingual songs: one whole copy', () => {
  const tamilSong = {
    spotify: [
      'naan unnai kaadhalikkiren',
      'nee enakku uyir',
      'चल तू खोने दे',                     // Hindi, in its own script on Spotify
      'all night long we dance',         // English
      'en nenjil nee mattum',
      'naan unnai paarthen 10,000 वाला',
    ],
    native: [
      'நான் உன்னை காதலிக்கிறேன்',
      'நீ எனக்கு உயிர்',
      'சல் தூ கோனே தே',                  // the copy writes the Hindi line in Tamil script
      'all night long we dance',
      'என் நெஞ்சில் நீ மட்டும்',
      'நான் உன்னை பார்த்தேன் 10,000 வாலா',
    ],
  };
  const tamilReq = () => req(tamilSong.spotify, ['ta']);

  it('takes the copy as it is when it is the same song, other scripts included (one source per song)', async () => {
    const r = await fit(tamilReq(), { lines: timed(tamilSong.native), synced: true, source: 'LRCLIB' }, 'Taml', romanize);
    expect(r?.lines.map((l) => l.text)).toEqual(tamilSong.native);
  });

  it('is judged the same song when Spotify\'s romanized lines are found in it, with an extra line in between', async () => {
    const native = [...tamilSong.native.slice(0, 2), 'இசை', ...tamilSong.native.slice(2)];
    const r = await fit(tamilReq(), { lines: timed(native), synced: true, source: 'LRCLIB' }, 'Taml', romanize);
    expect(r?.lines.map((l) => l.text)).toEqual(native);
    expect(r?.overlay).toBeUndefined();
  });

  it('refuses a copy that has too few of Spotify\'s romanized lines (another version)', async () => {
    const other = ['வேறு வரி ஒன்று', 'வேறு வரி இரண்டு', tamilSong.native[2], tamilSong.native[3], 'வேறு வரி மூன்று', tamilSong.native[5]];
    expect(await fit(tamilReq(), { lines: timed(other), synced: true, source: 'LRCLIB' }, 'Taml', romanize)).toBeNull();
  });

  it('among crowd-sourced copies, picks the one that covers more of the song', async () => {
    const partial = tamilSong.native.map((t, i) => (i === 1 ? 'வேறு வரி' : t));
    const { result } = await searchNative(tamilReq(), {
      lrclib: async () => [{ lines: timed(partial), synced: true, durationKnown: true }, { lines: timed(tamilSong.native), synced: true, durationKnown: true }],
      romanize,
    });
    expect(result?.lines.map((l) => l.text)).toEqual(tamilSong.native);
  });

  it('asks no source for a Korean song Spotify has in Hangul with English verses', async () => {
    let asked = false;
    const spy: NativeSources = { lrclib: async () => { asked = true; return []; }, romanize };
    const kpop = ['보고 싶다 너를', 'I just want you tonight', '사랑해 매일', 'baby you are my love'];
    expect((await searchNative(req(kpop, ['ko']), spy)).result).toBeNull();
    expect(asked).toBe(false);
  });

  it('judges identical uploads once', async () => {
    let calls = 0;
    const counting: NativeSources['romanize'] = async (lines, script) => { calls++; return romanize(lines, script); };
    const copy = { lines: timed(tamilSong.native), synced: true, durationKnown: true };
    await searchNative(tamilReq(), { lrclib: async () => [copy, { ...copy }, { ...copy }], romanize: counting });
    expect(calls).toBe(1);
  });
});

// Made-up lines (not lyrics of any song): one song, transcribed with different line breaks.
describe('the same song, judged by the whole text', () => {
  const spotify = [
    'saari raat jaage hum tere liye',
    'chanda bhi so gaya sitaare bhi',
    'dil ki baat kahi na jaaye',
    'aankhon se hi samjha de',
    'saari raat jaage hum tere liye',
    'chanda bhi so gaya sitaare bhi',
    'pal pal teri yaad sataaye',
    'phir bhi muskura de',
  ];
  // The copy joins each pair of Spotify's lines into one (as LyricFind often does).
  const joined = [
    'सारी रात जागे हम तेरे लिए चंदा भी सो गया सितारे भी',
    'दिल की बात कही ना जाए आँखों से ही समझा दे',
    'सारी रात जागे हम तेरे लिए चंदा भी सो गया सितारे भी',
    'पल पल तेरी याद सताए फिर भी मुस्कुरा दे',
  ];
  const spotifyReq = (): NativeRequest => ({ ...req(spotify), times: spotify.map((_, i) => 4000 * (i + 1)) });
  const joinedCopy = () => ({ lines: joined.map((text, k) => ({ startMs: 4000 * (2 * k + 1), text })), synced: true, source: 'LyricFind via YouTube Music' });

  it('takes a copy that joins lines Spotify splits (its own timings, no overlay)', async () => {
    const r = await fit(spotifyReq(), joinedCopy(), 'Deva', romanize);
    expect(r?.lines.map((l) => l.text)).toEqual(joined);
    expect(r).toMatchObject({ synced: true, aligned: false });
    expect(r?.overlay).toBeUndefined();
  });

  it('measures the joined copy as the song, and another song as not', async () => {
    const w = (ls: string[]) => ls.map((l, i) => ({ l, i }));
    const rom = async (ls: string[]) => (await romanize(ls, 'Deva')).map((r, k) => r ?? ls[k]);
    const same = wholeMeasures(w(spotify), spotify.map((_, j) => j), w(joined), await rom(joined), 'Deva');
    expect(same.cover).toBeGreaterThan(0.8);
    expect(same.own).toBeGreaterThan(0.8);
    expect(same.lines).toBeGreaterThan(0.8);
    const other = ['कभी कभी मेरे दिल में ख़याल आता है', 'के जैसे तुझको बनाया गया है', 'मेरे लिए'];
    const diff = wholeMeasures(w(spotify), spotify.map((_, j) => j), w(other), await rom(other), 'Deva');
    expect(Math.max(diff.cover, diff.own, diff.lines)).toBeLessThan(0.4);
  });

  it('refuses the same text timed to another recording (every line 30 s late): it would play out of sync', async () => {
    const late = { lines: joined.map((text, k) => ({ startMs: 4000 * (2 * k + 1) + 30_000, text })), synced: true, source: 'LRCLIB' };
    expect(await fit(spotifyReq(), late, 'Deva', romanize)).toBeNull();
  });

  it('a timing check only when both are timed: an unsynced request takes the joined copy', async () => {
    const r = await fit({ ...spotifyReq(), synced: false }, { ...joinedCopy(), lines: joinedCopy().lines.map((l) => ({ ...l, startMs: l.startMs + 30_000 })) }, 'Deva', romanize);
    expect(r?.lines.map((l) => l.text)).toEqual(joined);
  });

  it('refuses a copy with much of its own (another version: half the song is other lines)', async () => {
    const padded = [...joined.slice(0, 2), 'बादल बरसे भीगी रातें', 'नदिया किनारे बैठे हम', 'मौसम ने ली अंगड़ाई', 'गलियों में शोर मचा'];
    const copy = { lines: padded.map((text, k) => ({ startMs: 4000 * (k + 1), text })), synced: true, source: 'LRCLIB' };
    expect(await fit(spotifyReq(), copy, 'Deva', romanize)).toBeNull();
  });

  it('a song remembered as "none" by the older judge is looked up once more; a new "none" is kept', async () => {
    const { installChromeStorage } = await import('../helpers/chrome');
    installChromeStorage();
    const { cacheSet } = await import('../../src/background/cache');
    const { hash } = await import('../../src/shared/hash');
    const { restoreNative } = await import('../../src/background/lyrics/native');
    const r = spotifyReq();
    const key = `nat:${r.meta.id}:${hash(`${r.meta.name}\n${r.lines.join('\n')}`)}`;
    await cacheSet(key, { none: true }, 3600_000);
    let asked = 0;
    const src: NativeSources = { lrclib: async () => [], ytm: async () => { asked++; return joinedCopy(); }, romanize };
    expect((await restoreNative(r, src))?.lines.map((l) => l.text)).toEqual(joined);
    expect(asked).toBe(1);
    // A "none" from this judge stands: not asked again.
    const other = { ...r, lines: [...r.lines, 'ek aur line'] };
    const none: NativeSources = { lrclib: async () => [], ytm: async () => { asked++; return null; }, romanize };
    expect(await restoreNative(other, none)).toBeNull();
    expect(await restoreNative(other, none)).toBeNull();
    expect(asked).toBe(2);
    delete (globalThis as any).chrome;
  });
});
