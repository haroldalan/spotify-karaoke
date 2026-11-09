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
    expect(switchFor(song(['te quiero tanto'], 'es'), s())).toEqual({ modes: ['original', 'translated'], mode: 'original' });
    expect(switchFor(song(['te quiero tanto'], 'es'), s({ mode: 'translated' }))?.mode).toBe('translated');
  });
  it('nothing for a song already in the language translations go into', () => {
    expect(switchFor(song(['I walk alone'], 'en'), s())).toBeNull();
  });
  it('nothing with all three lines on: every version is on screen already', () => {
    expect(switchFor(song(['보고 싶다'], 'ko'), s({ allLines: true }))).toBeNull();
  });
});

describe('settings', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('default to two lines (the romanization, the original beneath) and the switcher on', async () => {
    const { loadSettings } = await import('../../src/shared/settings');
    expect(await loadSettings()).toMatchObject({ mode: 'romanized', allLines: false, showPill: true });
  });

  it('drop the switches that are now always on, keeping everything else', async () => {
    await chrome.storage.sync.set({ settings: { mode: 'translated', targetLang: 'ta', fillMissing: false, restoreNative: false, showPill: false } });
    const { loadSettings } = await import('../../src/shared/settings');
    expect(await loadSettings()).toEqual({ mode: 'translated', targetLang: 'ta', allLines: false, showPill: false });
  });

  it('turn an earlier build\'s original + romanization + translation into all three lines', async () => {
    await chrome.storage.sync.set({ settings: { mode: 'romanized', targetLang: 'ta', showOriginal: true, showRomanized: false, showTranslation: true } });
    const { loadSettings } = await import('../../src/shared/settings');
    expect((await loadSettings()).allLines).toBe(true);
  });

  it('keep the switcher\'s own setting while all three lines are on', async () => {
    const { loadSettings, saveSettings } = await import('../../src/shared/settings');
    await saveSettings({ showPill: false });
    await saveSettings({ allLines: true });
    await saveSettings({ allLines: false });
    expect((await loadSettings()).showPill).toBe(false);
  });

  it('ignore a stored mode that no longer exists', async () => {
    await chrome.storage.sync.set({ settings: { mode: 'both', targetLang: 'ja' } });
    const { loadSettings } = await import('../../src/shared/settings');
    expect((await loadSettings()).mode).toBe('romanized');
  });

  it('Reset data puts settings and per-song choices back to their defaults', async () => {
    const { loadSettings, saveSettings, setSpotifyOnly, loadSpotifyOnly, resetSettings } = await import('../../src/shared/settings');
    await saveSettings({ mode: 'translated', allLines: true });
    await setSpotifyOnly('b'.repeat(22), true);
    await resetSettings();
    expect(await loadSettings()).toMatchObject({ mode: 'romanized', allLines: false });
    expect(await loadSpotifyOnly()).toEqual([]);
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
