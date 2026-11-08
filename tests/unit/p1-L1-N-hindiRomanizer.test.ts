import { describe, it, expect } from 'vitest';
import { romanizeHindiLine } from '../../lib/lyrics/hindiRomanizer';
import { romanizedByTime } from '../../lib/colorLyricsInterceptor';

// Single common Hindi words and invented phrases (not lyrics of any song).
describe('romanizeHindiLine: Hindi as written in Latin letters', () => {
  it.each([
    ['हम', 'ham'],          // word-final schwa dropped
    ['रहती', 'rahti'],      // medial schwa dropped
    ['करते', 'karte'],
    ['झपकता', 'jhapaktaa'], // right to left: only one of two dropped
    ['बातें', 'baaten'],    // nasal as n, long a doubled
    ['मैं', 'main'],
    ['हूँ', 'hoon'],
    ['आसमाँ', 'aasmaan'],
    ['यादों', 'yaadon'],
    ['फ़रिश्तों', 'farishton'], // nukta f, conjunct sh+t
    ['क', 'ka'],             // a one-letter word keeps its vowel
    ['ज़िंदगी', 'zindagi'],
    ['दुःख', 'duhkh'],
  ])('%s → %s', (word, roman) => {
    expect(romanizeHindiLine(word)).toBe(roman);
  });

  it('keeps punctuation, spaces, Latin and digits; danda becomes a full stop', () => {
    expect(romanizeHindiLine('हम, तुम (OK) १२।')).toBe('ham, tum (OK) 12.');
  });
});

describe('romanizedByTime: Spotify lines paired with native lines that split differently', () => {
  const line = (t: number, words: string) => ({ startTimeMs: String(t), words });
  it('joins the Spotify lines that start within a native line, and needs most lines paired', () => {
    const spotify = [line(1000, 'one a'), line(3000, 'one b'), line(6000, 'two'), line(9000, '♪'), line(12000, 'three')];
    const native = [line(1100, 'एक'), line(6200, 'दो'), line(11900, 'तीन')];
    expect(romanizedByTime(spotify, native)).toEqual(['one a one b', 'two', 'three']);
  });

  it('copies not timed alike (most lines without a partner): no pairs', () => {
    const spotify = [line(1000, 'one'), line(2000, 'two')];
    const native = [line(50000, 'एक'), line(60000, 'दो'), line(70000, 'तीन')];
    expect(romanizedByTime(spotify, native)).toBeNull();
  });

  it('unsynced native lines are never paired by time', () => {
    expect(romanizedByTime([line(1000, 'one')], [line(0, 'एक'), line(0, 'दो')])).toBeNull();
  });
});

describe('saved romanizations from the old Devanagari scheme', () => {
  it('are redone once; other scripts and current ones are kept', async () => {
    const { getStoredEntryDefect, ROMANIZER_VERSION } = await import('../../lib/core/processedCache');
    const hindi = ['हम', 'तुम'];
    const old = { romanized: ['hama', 'tuma'], translated: null };
    expect(getStoredEntryDefect(hindi, 'en', old)).toBe('romanized with an older romanizer');
    expect(getStoredEntryDefect(hindi, 'en', { ...old, romanizerVersion: ROMANIZER_VERSION })).toBeNull();
    expect(getStoredEntryDefect(['안녕'], 'en', { romanized: ['annyeong'], translated: null })).toBeNull();
  });
});
