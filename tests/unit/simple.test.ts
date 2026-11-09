// "It just works": one setting that matters (the mode), one language, everything else decided.
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
});

describe('settings', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorage();
  });

  it('drop the switches older versions stored, keeping the mode and language', async () => {
    await chrome.storage.sync.set({ settings: { mode: 'translated', targetLang: 'ta', showOriginal: true, showTranslation: true, fillMissing: false, showPill: false } });
    const { loadSettings } = await import('../../src/shared/settings');
    expect(await loadSettings()).toEqual({ mode: 'translated', targetLang: 'ta' });
  });

  it('ignore a stored mode that no longer exists', async () => {
    await chrome.storage.sync.set({ settings: { mode: 'both', targetLang: 'ja' } });
    const { loadSettings } = await import('../../src/shared/settings');
    expect((await loadSettings()).mode).toBe('romanized');
  });
});
