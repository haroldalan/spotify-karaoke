import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyLinesToDOM, isMeaningfullyDifferent, snapshotOriginals } from '../../lib/dom/lyricsDOM';
import { getLyricsLines } from '../../lib/dom/domQueries';
import type { SongCache } from '../../lib/core/lyricsTypes';

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf-8');
// Real color-lyrics response shape; romanized Hindi tagged "language":"id" (invented text).
const HINDI_RESPONSE = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/color-lyrics-romanized-hindi.json'), 'utf-8'));

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

describe('p1-C isMeaningfullyDifferent (dual-line duplicate check)', () => {
  it('treats NFD and NFC forms of the same text as identical', () => {
    const nfc = 'すぎさりし ひろがった'; // composed dakuten
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(isMeaningfullyDifferent(nfc, nfd)).toBe(false);
    expect(isMeaningfullyDifferent('café', 'café')).toBe(false);
  });

  it('ignores punctuation, whitespace and case', () => {
    expect(isMeaningfullyDifferent('Hello, world!', 'hello   world')).toBe(false);
    expect(isMeaningfullyDifferent('「きょう」、あめ。', 'きょう あめ')).toBe(false);
    expect(isMeaningfullyDifferent('♪', '♪')).toBe(false);
  });

  it('reports real differences', () => {
    expect(isMeaningfullyDifferent('きょうはあめです', 'Kyou wa ame desu')).toBe(true);
    expect(isMeaningfullyDifferent('Hello world', 'Hola mundo')).toBe(true);
  });

  it('never asks for a dual line when one side is empty', () => {
    expect(isMeaningfullyDifferent('', 'text')).toBe(false);
    expect(isMeaningfullyDifferent('text', undefined)).toBe(false);
  });
});

describe('p1-C applyLinesToDOM + snapshotOriginals on the 2026 overlay', () => {
  beforeEach(() => {
    loadFixture();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    (window as any).spotifyState = { track: null, language: HINDI_RESPONSE.lyrics.language };
    (window as any).slyInternalState = { interceptorActive: false };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    (window as any).spotifyState = { track: null };
  });

  it('does not render a duplicate dual line for an NFD copy of the original', () => {
    const originals = getLyricsLines().map(el => el.textContent ?? '');
    const processed = originals.map(l => l.normalize('NFD'));
    processed[0] = 'Something else entirely';
    applyLinesToDOM(processed, originals, true, () => {});
    const lines = getLyricsLines();
    expect(lines[0].querySelector('.sly-dual-line')).not.toBeNull();
    expect(lines.slice(1).every(el => el.querySelector('.sly-dual-line') === null)).toBe(true);
  });

  it('snapshots romanized Latin lines once the interceptor has settled (K4)', () => {
    const cache: SongCache = { original: [], processed: new Map() };
    snapshotOriginals(cache);
    expect(cache.original).toHaveLength(7);
    expect(cache.original[0]).toBe(HINDI_RESPONSE.lyrics.lines[0].words);
  });

  it('waits while the interceptor is in flight for a romanized fallback, even with a wrong language tag', () => {
    (window as any).slyInternalState = { interceptorActive: true };
    const cache: SongCache = { original: [], processed: new Map() };
    snapshotOriginals(cache);
    expect(cache.original).toEqual([]);
    expect(getLyricsLines().some(el => el.hasAttribute('data-sly-original'))).toBe(false);
  });
});
