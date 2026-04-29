import { isContextValid, safeBrowserCall } from '../utils/browserUtils';
import type { SongCache, LyricsCacheEntry, LyricsIndex } from './lyricsTypes';

const RUNTIME_CACHE_MAX = 10;

export async function loadSongCache(
  key: string,
  cache: SongCache,
  runtimeCache: Map<string, LyricsCacheEntry>
): Promise<void> {
  if (!key || !isContextValid()) return;
  try {
    let entry: LyricsCacheEntry | undefined;

    const runtimeEntry = runtimeCache.get(key);
    if (runtimeEntry) {
      entry = runtimeEntry;
    } else {
      const storageKey = `lc:${key}`;
      const data = await safeBrowserCall(() => browser.storage.local.get(storageKey));
      entry = data?.[storageKey] as LyricsCacheEntry | undefined;
    }

    if (!entry) return;

    if (entry.original.length !== cache.original.length) {
      return;
    }

    cache.original = [...entry.original];

    for (const [lang, processed] of Object.entries(entry.processed)) {
      if (!cache.processed.has(lang)) {
        cache.processed.set(lang, processed);
      }
    }

    safeBrowserCall(() => browser.storage.local.get('lc_index')).then((d) => {
      const idx = (d?.['lc_index'] ?? {}) as LyricsIndex;
      if (idx[key]) {
        idx[key].lastAccessed = Date.now();
        safeBrowserCall(() => browser.storage.local.set({ lc_index: idx }));
      }
    }).catch(() => { });
  } catch (err) {
    console.warn('[SKaraoke:Content] loadSongCache failed:', err);
  }
}

export async function saveSongCache(
  key: string,
  cache: SongCache,
  runtimeCache: Map<string, LyricsCacheEntry>
): Promise<void> {
  if (!key || cache.original.length === 0 || !isContextValid()) return;

  const processedObj: LyricsCacheEntry['processed'] = {};
  cache.processed.forEach((val, lang) => { processedObj[lang] = val; });

  const entry: LyricsCacheEntry = {
    original: cache.original,
    processed: processedObj,
    lastAccessed: Date.now(),
  };

  runtimeCache.set(key, entry);
  if (runtimeCache.size > RUNTIME_CACHE_MAX) {
    runtimeCache.delete(runtimeCache.keys().next().value!);
  }

  const storageKey = `lc:${key}`;

  safeBrowserCall(() => browser.storage.local.get('lc_index')).then(async (d) => {
    const idx = (d?.['lc_index'] ?? {}) as LyricsIndex;
    idx[key] = { lastAccessed: entry.lastAccessed };

    try {
      await safeBrowserCall(() => browser.storage.local.set({ [storageKey]: entry, lc_index: idx }));
    } catch (err: any) {
      console.warn('[SKaraoke:Content] saveSongCache failed:', err);
    }
  }).catch((err) => console.warn('[SKaraoke:Content] saveSongCache index get failed:', err));
}

export function deleteSongCache(key: string): void {
  if (!key) return;
  safeBrowserCall(() => browser.storage.local.get('lc_index')).then((d) => {
    const idx = (d?.['lc_index'] ?? {}) as LyricsIndex;
    delete idx[key];
    safeBrowserCall(() => browser.storage.local.remove(`lc:${key}`));
    safeBrowserCall(() => browser.storage.local.set({ lc_index: idx }));
  }).catch(() => { });
}
