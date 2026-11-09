import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await chrome.storage.sync.get(KEY);
    return { ...DEFAULT_SETTINGS, ...(got[KEY] as Partial<Settings> | undefined) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(fn: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) fn({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
  });
}
