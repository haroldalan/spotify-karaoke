import { DEFAULT_SETTINGS, type Settings } from './types';
import { LANGUAGES } from './languages';

const KEY = 'settings';

/** The browser's language as a Google Translate target (zh-TW stays zh-TW, he is iw), or English. */
export function browserTargetLanguage(lang = typeof navigator !== 'undefined' ? navigator.language : 'en'): string {
  const codes = new Set(LANGUAGES.map(([c]) => c));
  const tag = (lang || 'en').replace('_', '-');
  const base = tag.split('-')[0].toLowerCase();
  if (base === 'zh') return /TW|HK|MO|Hant/i.test(tag) ? 'zh-TW' : 'zh-CN';
  const alias: Record<string, string> = { he: 'iw', jv: 'jw', nb: 'no', nn: 'no', fil: 'fil', mni: 'mni-Mtei' };
  const code = alias[base] ?? base;
  return codes.has(code) ? code : 'en';
}

/** Settings for someone who hasn't changed any: the target language follows the browser. */
export function defaults(): Settings {
  return { ...DEFAULT_SETTINGS, targetLang: browserTargetLanguage() };
}

/**
 * Stored settings over the defaults. Keys older builds stored are dropped (fillMissing,
 * restoreNative) or folded in: original, romanization and translation all switched on
 * beneath the main line becomes "all three lines".
 */
export function settingsFrom(stored: unknown): Settings {
  const d = defaults();
  const s = (stored ?? {}) as Record<string, unknown>;
  const mode = s.mode === 'original' || s.mode === 'romanized' || s.mode === 'translated' ? s.mode : d.mode;
  let allLines = typeof s.allLines === 'boolean' ? s.allLines : d.allLines;
  if (typeof s.allLines !== 'boolean' && ['showOriginal', 'showRomanized', 'showTranslation'].some((k) => k in s)) {
    const on = { original: s.showOriginal === true, romanized: s.showRomanized === true, translated: s.showTranslation === true };
    on[mode] = true;
    allLines = on.original && on.romanized && on.translated;
  }
  return {
    mode,
    targetLang: typeof s.targetLang === 'string' && s.targetLang ? s.targetLang : d.targetLang,
    allLines,
    showPill: typeof s.showPill === 'boolean' ? s.showPill : d.showPill,
  };
}

/** The top-level keys 3.1.6 kept its preferences under. */
const LEGACY = ['targetLang', 'preferredMode', 'showPill'] as const;

/**
 * Settings 3.1.6 saved, as 4.x settings: the language, the mode and the switcher carry
 * over. (3.1.6's "dual lyrics" was the original beneath the main line, which is now always
 * on; the three-line view is new and starts off.) null: no 3.1.6 settings were saved.
 */
export function settingsFromLegacy(got: Record<string, unknown>): Settings | null {
  if (!LEGACY.some((k) => got[k] !== undefined)) return null;
  // 3.1.6 wrote Javanese as 'jv'; Google Translate says 'jw'.
  const lang = got.targetLang === 'jv' ? 'jw' : got.targetLang;
  return settingsFrom({ mode: got.preferredMode, targetLang: lang, showPill: got.showPill });
}

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await chrome.storage.sync.get([KEY, ...LEGACY]);
    if (got[KEY] === undefined) {
      // First run after an update from 3.1.6: its choices, written once as ours.
      const migrated = settingsFromLegacy(got);
      if (migrated) {
        await chrome.storage.sync.set({ [KEY]: migrated }).catch(() => {});
        return migrated;
      }
    }
    return settingsFrom(got[KEY]);
  } catch {
    return defaults();
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsFrom({ ...(await loadSettings()), ...patch });
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(fn: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) fn(settingsFrom(changes[KEY].newValue));
  });
}

// Songs whose lyrics the listener sent back to Spotify ("Not this song"): a per-song choice
// kept with the settings (Clear cache doesn't touch it), following the listener's devices.
const SPOTIFY_ONLY = 'spotifyOnly';
const SPOTIFY_ONLY_MAX = 250;

export async function loadSpotifyOnly(): Promise<string[]> {
  try {
    const got = await chrome.storage.sync.get(SPOTIFY_ONLY);
    const v = got[SPOTIFY_ONLY];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Sends a song's lyrics back to Spotify (on), or lets the extension help with it again (off). */
export async function setSpotifyOnly(id: string, on: boolean): Promise<string[]> {
  const ids = (await loadSpotifyOnly()).filter((x) => x !== id);
  if (on) ids.push(id);
  const next = ids.slice(-SPOTIFY_ONLY_MAX);
  await chrome.storage.sync.set({ [SPOTIFY_ONLY]: next });
  return next;
}

export function onSpotifyOnlyChanged(fn: (ids: string[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SPOTIFY_ONLY]) fn((changes[SPOTIFY_ONLY].newValue as string[] | undefined) ?? []);
  });
}

/** "Reset data": settings and per-song choices back to their defaults (the caller clears the cache). */
export async function resetSettings(): Promise<void> {
  await chrome.storage.sync.remove([KEY, SPOTIFY_ONLY]);
}
