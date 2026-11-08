import { describe, it, expect, beforeEach } from 'vitest';
import {
  applySpotifyRomanization, rememberSpotifyRomanization, resetSpotifyRomanization, spotifyRomanizationFor,
} from '../../lib/core/spotifyRomanization';
import type { ProcessedCache } from '../../lib/core/lyricsTypes';

// Invented lines: Devanagari test sentences and made-up romanizations (not lyrics).
const NATIVE = ['यह पहली परीक्षण पंक्ति है', '♪', 'यह दूसरी परीक्षण पंक्ति है', ''];
const SPOTIFY_ROMANIZED = ['yeh pehli pareekshan pankti hai', 'yeh doosri pareekshan pankti hai'];

beforeEach(() => resetSpotifyRomanization());

describe("Spotify's romanized lines for restored native lines", () => {
  it('pairs native lines with words with Spotify\'s lines in order and uses them in a processed result', () => {
    expect(rememberSpotifyRomanization(NATIVE, SPOTIFY_ROMANIZED)).toBe(2);
    expect(spotifyRomanizationFor(NATIVE[2])).toBe(SPOTIFY_ROMANIZED[1]);
    const processed: ProcessedCache = { romanized: ['literal one', '♪', 'literal two', ''], translated: null };
    expect(applySpotifyRomanization(NATIVE, processed)).toBe(true);
    expect(processed.romanized).toEqual([SPOTIFY_ROMANIZED[0], '♪', SPOTIFY_ROMANIZED[1], '']);
    expect(applySpotifyRomanization(NATIVE, processed)).toBe(false); // already applied
  });

  it('records nothing when the counts differ', () => {
    expect(rememberSpotifyRomanization(NATIVE, [SPOTIFY_ROMANIZED[0]])).toBe(0);
    const processed: ProcessedCache = { romanized: ['literal one', '♪', 'literal two', ''], translated: null };
    expect(applySpotifyRomanization(NATIVE, processed)).toBe(false);
    expect(processed.romanized[0]).toBe('literal one');
  });

  it('lines it has no Spotify line for keep the local romanization; Reset Data forgets them', () => {
    rememberSpotifyRomanization(NATIVE, SPOTIFY_ROMANIZED);
    const other = ['यह कोई और पंक्ति है'];
    const processed: ProcessedCache = { romanized: ['local'], translated: null };
    expect(applySpotifyRomanization(other, processed)).toBe(false);
    resetSpotifyRomanization();
    expect(spotifyRomanizationFor(NATIVE[0])).toBeUndefined();
  });
});
