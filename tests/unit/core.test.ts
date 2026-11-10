import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NONE, decoration } from '../../src/content/decorate';
import { read } from '../helpers/lines';
import { artistScore, isMatch, normalizeTitle, parseClock, titleScore } from '../../src/background/lyrics/match';
import { parseLrc } from '../../src/background/lyrics/lrc';
import { buildColorLyrics, parseColorLyrics, parseMeta } from '../../src/page/spotifyFormat';
import { base62ToHex, hexToBase62 } from '../../src/shared/spotifyId';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';

describe('Spotify ids', () => {
  it('converts between hex gids and base62 ids (live pair, 2026-11-09)', () => {
    expect(hexToBase62('647a7f80ed7b47578743b227e6bfb793')).toBe('33BdipYlRY2WBvIBNk4Wmn');
    expect(base62ToHex('33BdipYlRY2WBvIBNk4Wmn')).toBe('647a7f80ed7b47578743b227e6bfb793');
    expect(hexToBase62('nope')).toBeNull();
  });
});

describe('Spotify formats', () => {
  it('reads metadata, with has_lyrics only when present', () => {
    const m = parseMeta({ gid: '647a7f80ed7b47578743b227e6bfb793', name: 'まどろみ', artist: [{ name: 'Naoko Gushima' }], duration: 250040, language_of_performance: ['ja'], album: { name: 'Best' } });
    expect(m).toMatchObject({ id: '33BdipYlRY2WBvIBNk4Wmn', hasLyrics: false, durationMs: 250040, languages: ['ja'] });
  });
  it('round-trips color-lyrics', () => {
    const fixture = JSON.parse(fs.readFileSync('tests/fixtures/color-lyrics-romanized-hindi.json', 'utf8'));
    expect(parseColorLyrics(fixture)?.lines[0]).toBe('Mera dil tera hai, tu kahan hai yaar');
    const built = buildColorLyrics({ lines: [{ startMs: 1500, text: 'a' }, { startMs: 3000, text: 'b' }], synced: true, source: 'LRCLIB' }, 'ja');
    expect(built.lyrics.syncType).toBe('LINE_SYNCED');
    expect(built.lyrics.lines[1]).toMatchObject({ startTimeMs: '3000', words: 'b' });
    expect(parseColorLyrics(built)?.lines).toEqual(['a', 'b']);
  });
  it('marks unsynced lyrics with zero times', () => {
    const built = buildColorLyrics({ lines: [{ startMs: 0, text: 'a' }], synced: false, source: 'x' }, null);
    expect(built.lyrics.syncType).toBe('UNSYNCED');
  });
});

describe('matching', () => {
  const meta = { name: 'Vizhi Veekura - From "Think Indie"', artists: ['Sai Abhyankkar', 'Sai Smriti'], durationMs: 219000 };
  it('normalizes titles', () => {
    expect(normalizeTitle('Vizhi Veekura - From "Think Indie"')).toBe('vizhi veekura');
    expect(normalizeTitle('Song (feat. Someone)')).toBe('song');
    expect(normalizeTitle('Song - Remastered 2011')).toBe('song');
  });
  it('accepts the same song, rejects others', () => {
    expect(isMatch(meta, { title: 'Vizhi Veekura', artist: 'Sai Abhyankkar', durationS: 220 })).toBe(true);
    expect(isMatch(meta, { title: 'Vizhi Veekura', artist: 'Sai Abhyankkar', durationS: 240 })).toBe(false);
    expect(isMatch(meta, { title: 'Other Song', artist: 'Sai Abhyankkar', durationS: 219 })).toBe(false);
    expect(isMatch(meta, { title: 'Vizhi Veekura', artist: 'Someone Else', durationS: 219 })).toBe(false);
  });
  it('scores YouTube Music style titles', () => {
    expect(titleScore('まどろみ', 'まどろみ - Madoromi')).toBeGreaterThanOrEqual(0.8);
    expect(artistScore(['Naoko Gushima'], 'Naoko Gushima')).toBe(1);
    expect(parseClock('4:11')).toBe(251);
    expect(parseClock('1:02:03')).toBe(3723);
  });
});

describe('LRC', () => {
  it('parses timestamps, repeats and metadata tags', () => {
    const lines = parseLrc('[ar:Someone]\n[00:01.50]one\n[00:03.00][00:10.25]chorus\n[00:05]two');
    expect(lines).toEqual([
      { startMs: 1500, text: 'one' },
      { startMs: 3000, text: 'chorus' },
      { startMs: 5000, text: 'two' },
      { startMs: 10250, text: 'chorus' },
    ]);
  });
});

describe('decoration', () => {
  const s = (p: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...p });
  const info = { romanized: 'kimi o aishiteru', translated: { en: 'I love you' } };
  const shown = (original: string, i: Parameters<typeof decoration>[1], p: Partial<Settings>, aliased = false, onScreen = original) =>
    read(onScreen, decoration(original, i, s(p), aliased));

  it('by default: romanized main with the original beneath', () => {
    expect(shown('君を愛してる', info, {})).toEqual({ main: 'kimi o aishiteru', beneath: ['君を愛してる'] });
  });
  it('translated main with the original beneath', () => {
    expect(shown('君を愛してる', info, { mode: 'translated' })).toEqual({ main: 'I love you', beneath: ['君を愛してる'] });
  });
  it('two lines off: the main line alone (Original mode is Spotify as it is)', () => {
    expect(shown('君を愛してる', info, { twoLines: false })).toEqual({ main: 'kimi o aishiteru', beneath: [] });
    expect(shown('君を愛してる', info, { mode: 'translated', twoLines: false })).toEqual({ main: 'I love you', beneath: [] });
    expect(decoration('君を愛してる', info, s({ mode: 'original', twoLines: false }))).toEqual(NONE);
    // No translation yet: the romanization alone, not the bare original.
    expect(shown('君を愛してる', { romanized: 'kimi o aishiteru', translated: {} }, { mode: 'translated', twoLines: false })).toEqual({ main: 'kimi o aishiteru', beneath: [] });
    // Nothing to romanize: the original, as Spotify draws it.
    expect(decoration('hello', { romanized: null }, s({ twoLines: false }))).toEqual(NONE);
  });
  it('two lines off on a restored song: Spotify\'s romanization alone, or the translation alone', () => {
    const restored = { romanized: 'tera hai', translated: { en: 'is yours' } };
    expect(decoration('तेरा है', restored, s({ twoLines: false }), true)).toEqual(NONE);
    expect(shown('तेरा है', restored, { mode: 'translated', twoLines: false }, true, 'tera hai')).toEqual({ main: 'is yours', beneath: [] });
  });
  it('all three lines win over two lines off', () => {
    expect(shown('君を愛してる', info, { twoLines: false, allLines: true })).toEqual({ main: 'kimi o aishiteru', beneath: ['君を愛してる', 'I love you'] });
  });
  it('leaves a line without words (an instrumental ♪) as Spotify draws it', () => {
    const note = { romanized: '♪', translated: { en: '♫' } };
    expect(decoration('♪', note, s({ mode: 'translated' }))).toEqual(NONE);
    expect(decoration('♪', note, s({ mode: 'romanized', allLines: true }))).toEqual(NONE);
  });
  it('original mode is Spotify as it is', () => {
    expect(decoration('君を愛してる', info, s({ mode: 'original' }))).toEqual(NONE);
  });
  it('all three lines, in every mode: the main line, then original, romanization, translation', () => {
    expect(shown('君を愛してる', info, { mode: 'romanized', allLines: true })).toEqual({ main: 'kimi o aishiteru', beneath: ['君を愛してる', 'I love you'] });
    expect(shown('君を愛してる', info, { mode: 'translated', allLines: true })).toEqual({ main: 'I love you', beneath: ['君を愛してる', 'kimi o aishiteru'] });
    expect(shown('君を愛してる', info, { mode: 'original', allLines: true })).toEqual({ main: '君を愛してる', beneath: ['kimi o aishiteru', 'I love you'] });
  });
  it('puts the translation in its own slot (::after), styled apart from the lines in the song\'s words', () => {
    expect(decoration('君を愛してる', info, s({ mode: 'romanized', allLines: true })).b).toBe('I love you');
    expect(decoration('君を愛してる', info, s({ mode: 'translated', allLines: true }))).toMatchObject({ big: 'b', a: 'kimi o aishiteru' });
  });
  it('shows the romanized line, never bare text, while the translation is on its way', () => {
    expect(shown('君を愛してる', { romanized: 'kimi o aishiteru', translated: {} }, { mode: 'translated' })).toEqual({ main: 'kimi o aishiteru', beneath: ['君を愛してる'] });
  });
  it('a Latin-script line: the translation with the original beneath', () => {
    expect(shown('te quiero', { romanized: null, translated: { en: 'I love you' } }, { mode: 'translated' })).toEqual({ main: 'I love you', beneath: ['te quiero'] });
  });
  it('shows nothing extra for a line with nothing to add', () => {
    expect(decoration('hello', { romanized: null }, s({ mode: 'romanized' }))).toEqual(NONE);
    expect(decoration('hello', undefined, s({ mode: 'translated' }))).toEqual(NONE);
  });
  it('a restored song: Spotify shows its romanization, ours is the original script', () => {
    const restored = { romanized: 'tera hai', translated: { en: 'is yours' } };
    expect(shown('तेरा है', restored, { mode: 'romanized' }, true, 'tera hai')).toEqual({ main: 'tera hai', beneath: ['तेरा है'] });
    expect(shown('तेरा है', restored, { mode: 'original' }, true, 'tera hai')).toEqual({ main: 'तेरा है', beneath: [] });
    expect(shown('तेरा है', restored, { mode: 'translated', allLines: true }, true, 'tera hai')).toEqual({ main: 'is yours', beneath: ['तेरा है', 'tera hai'] });
  });
  it('shows the translation as the main line even when it equals the romanization, and never twice', () => {
    // A name, a number or a vocalise: both come out the same. Found by reading the code (2026-11-10):
    // the translation was dropped as a duplicate, leaving the large slot empty.
    const same = { romanized: 'Rabba', translated: { en: 'Rabba' } };
    expect(decoration('ரப்பா', same, s({ mode: 'translated' }))).toMatchObject({ big: 'b', b: 'Rabba', a: null });
    expect(decoration('ரப்பா', same, s({ mode: 'translated', allLines: true }))).toMatchObject({ big: 'b', b: 'Rabba', a: null });
    expect(decoration('ரப்பா', same, s({ mode: 'original', allLines: true }))).toMatchObject({ big: 'c', a: 'Rabba', b: null });
    expect(decoration('ரப்பா', same, s({ mode: 'romanized', allLines: true }))).toMatchObject({ big: 'a', a: 'Rabba', b: null });
    // A restored song (Spotify's text is the romanization): same.
    expect(decoration('ரப்பா', same, s({ mode: 'translated' }), true)).toMatchObject({ big: 'b', b: 'Rabba' });
  });
  it('turns right-to-left lines left-to-right when the main line is Latin', () => {
    expect(decoration('أحبك', { romanized: "'uhibuk" }, s({ mode: 'romanized' })).dir).toBe('ltr');
  });
  it('turns only right-to-left lines: every other script keeps Spotify\'s direction and alignment', () => {
    // Found live (2026-11-10): the right-to-left class had come to cover every script up to U+FDFF.
    const lines: [string, string][] = [
      ['தங்கபூவே', 'thangapoove'], ['तेरा है', 'tera hai'], ['ਤੇਰੇ ਵਰਗਾ', 'tere warga'], ['君を愛してる', 'kimi o aishiteru'],
      ['사랑해', 'saranghae'], ['我爱你', 'wo ai ni'], ['Я тебя люблю', 'Ya tebya lyublyu'], ['รักเธอ', 'rak thoe'], ['Σ\u2019 αγαπώ', "S' agapo"],
    ];
    for (const [original, romanized] of lines) {
      expect(decoration(original, { romanized }, s({ mode: 'romanized' })).dir, original).toBeNull();
      expect(decoration(original, { romanized, translated: { en: 'I love you' } }, s({ mode: 'translated', allLines: true })).dir, original).toBeNull();
    }
  });
  it('turns a right-to-left line whenever its main line is not right-to-left, whatever that script is', () => {
    const arabic = { romanized: "'uhibuk", translated: { en: 'I love you', hi: 'मैं तुमसे प्यार करता हूँ', ja: '愛してる', iw: 'אני אוהב אותך' } };
    for (const targetLang of ['en', 'hi', 'ja']) expect(decoration('أحبك', arabic, s({ mode: 'translated', targetLang })).dir, targetLang).toBe('ltr');
    // Hebrew presentation forms and Arabic presentation forms count as right-to-left too.
    expect(decoration('\uFB1D\uFB2A', { romanized: 'yish' }, s({ mode: 'romanized' })).dir).toBe('ltr');
    expect(decoration('\uFE8D\uFEDF', { romanized: 'al' }, s({ mode: 'romanized' })).dir).toBe('ltr');
    // A right-to-left main line stays as Spotify lays it out.
    expect(decoration('أحبك', arabic, s({ mode: 'translated', targetLang: 'iw' })).dir).toBeNull();
    expect(decoration('أحبك', arabic, s({ mode: 'original', allLines: true })).dir).toBeNull();
  });
});
