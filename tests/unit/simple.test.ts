// The decided UX (docs/ux-audit-personas.md §10): fewer, better choices; the listener still
// decides what is on their screen.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from '../helpers/chrome';
import { switchFor } from '../../src/content/modes';
import type { Song } from '../../src/content/lineStore';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';

const song = (lines: string[], language: string | null, script?: string): Song =>
  ({ key: 'k', lines, language, script, romanized: null, translated: {}, romanizeState: 'no', translateState: {} }) as Song;
const s = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });

describe('the switcher offers what changes something', () => {
  it('every mode for a song in another script', () => {
    expect(switchFor(song(['보고 싶다'], 'ko'), s())).toEqual({ modes: ['original', 'romanized', 'translated'], mode: 'romanized' });
  });
  it('Original and Translated for a Latin-script song in another language, Original in effect', () => {
    expect(switchFor(song(['te quiero tanto'], 'es'), s({ showOriginal: false }))).toEqual({ modes: ['original', 'translated'], mode: 'original' });
    expect(switchFor(song(['te quiero tanto'], 'es'), s({ mode: 'translated', showOriginal: false }))?.mode).toBe('translated');
  });
  it('nothing for a song already in the language translations go into', () => {
    expect(switchFor(song(['I walk alone'], 'en'), s())).toBeNull();
  });
  it('nothing when every version it would offer is already on screen', () => {
    expect(switchFor(song(['보고 싶다'], 'ko'), s({ showOriginal: true, showTranslation: true }))).toBeNull();
    expect(switchFor(song(['보고 싶다'], 'ko'), s({ mode: 'translated', showOriginal: true, showRomanized: true }))).toBeNull();
    // A Spanish song with its translation beneath: original and translation both showing.
    expect(switchFor(song(['te quiero tanto'], 'es'), s({ showTranslation: true }))).toBeNull();
    // Two lines (the default) keep the switcher.
    expect(switchFor(song(['보고 싶다'], 'ko'), s())).not.toBeNull();
  });
});

describe('settings', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('default to two lines: the romanization, with the original beneath', async () => {
    const { loadSettings } = await import('../../src/shared/settings');
    expect(await loadSettings()).toMatchObject({ mode: 'romanized', showOriginal: true, showRomanized: false, showTranslation: false, showPill: true });
  });

  it('drop the switches that are now always on, keeping everything else', async () => {
    await chrome.storage.sync.set({ settings: { mode: 'translated', targetLang: 'ta', showOriginal: true, showTranslation: false, fillMissing: false, restoreNative: false, showPill: false } });
    const { loadSettings } = await import('../../src/shared/settings');
    expect(await loadSettings()).toEqual({ mode: 'translated', targetLang: 'ta', showOriginal: true, showRomanized: false, showTranslation: false, showPill: false });
  });

  it('ignore a stored mode that no longer exists', async () => {
    await chrome.storage.sync.set({ settings: { mode: 'both', targetLang: 'ja' } });
    const { loadSettings } = await import('../../src/shared/settings');
    expect((await loadSettings()).mode).toBe('romanized');
  });

  it('know when all three lines are on screen', async () => {
    const { allLinesShown } = await import('../../src/shared/settings');
    expect(allLinesShown(s())).toBe(false);
    expect(allLinesShown(s({ showTranslation: true }))).toBe(true);
    expect(allLinesShown(s({ mode: 'original', showRomanized: true, showTranslation: true }))).toBe(true);
  });
});

describe('Not this song', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('is a per-song choice that can be undone, and Clear cache keeps it', async () => {
    const { loadSpotifyOnly, setSpotifyOnly } = await import('../../src/shared/settings');
    await setSpotifyOnly('a'.repeat(22), true);
    expect(await loadSpotifyOnly()).toEqual(['a'.repeat(22)]);
    const { cacheClear } = await import('../../src/background/cache');
    await cacheClear();
    expect(await loadSpotifyOnly()).toEqual(['a'.repeat(22)]);
    await setSpotifyOnly('a'.repeat(22), false);
    expect(await loadSpotifyOnly()).toEqual([]);
  });
});
