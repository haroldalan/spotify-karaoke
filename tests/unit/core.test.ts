import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decoration } from '../../src/content/decorate';
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
  it('romanized main with the original beneath', () => {
    expect(decoration('君を愛してる', info, s({ mode: 'romanized' }))).toEqual({ main: 'kimi o aishiteru', sub: '君を愛してる', dir: null });
  });
  it('translated main with the romanization beneath, so the line can still be sung', () => {
    expect(decoration('君を愛してる', info, s({ mode: 'translated' }))).toEqual({ main: 'I love you', sub: 'kimi o aishiteru', dir: null });
  });
  it('translated main with the original beneath for a line already in Latin script', () => {
    expect(decoration('te quiero', { romanized: null, translated: { en: 'I love you' } }, s({ mode: 'translated' })).sub).toBe('te quiero');
  });
  it('shows the romanized line, not bare text, while the translation is on its way', () => {
    expect(decoration('君を愛してる', { romanized: 'kimi o aishiteru', translated: {} }, s({ mode: 'translated' })))
      .toEqual({ main: 'kimi o aishiteru', sub: '君を愛してる', dir: null });
  });
  it('original mode is Spotify as it is', () => {
    expect(decoration('君を愛してる', info, s({ mode: 'original' }))).toEqual({ main: null, sub: null, dir: null });
  });
  it('shows nothing extra for a line with nothing to add', () => {
    expect(decoration('hello', { romanized: null }, s({ mode: 'romanized' }))).toEqual({ main: null, sub: null, dir: null });
    expect(decoration('hello', undefined, s({ mode: 'translated' }))).toEqual({ main: null, sub: null, dir: null });
  });
  it('turns right-to-left lines left-to-right when the main line is Latin', () => {
    expect(decoration('أحبك', { romanized: "'uhibuk" }, s({ mode: 'romanized' })).dir).toBe('ltr');
  });
});
