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

/** Stored settings over the defaults; keys from older versions (the removed switches) are dropped. */
function settingsFrom(stored: unknown): Settings {
  const d = defaults();
  const s = (stored ?? {}) as Partial<Settings>;
  const mode = s.mode === 'original' || s.mode === 'romanized' || s.mode === 'translated' ? s.mode : d.mode;
  const targetLang = typeof s.targetLang === 'string' && s.targetLang ? s.targetLang : d.targetLang;
  return { mode, targetLang };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await chrome.storage.sync.get(KEY);
    return settingsFrom(got[KEY]);
  } catch {
    return defaults();
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(fn: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) fn(settingsFrom(changes[KEY].newValue));
  });
}
