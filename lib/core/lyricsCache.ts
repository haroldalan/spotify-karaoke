import { isContextValid, safeBrowserCall } from '../utils/browserUtils';
import type { SongCache, LyricsCacheEntry, LyricsIndex } from './lyricsTypes';

const RUNTIME_CACHE_MAX = 50; // BUG-15: Increased from 10
const PERSISTED_CACHE_MAX = 200;

/**
 * Robust string hash (53-bit safe integer).
 * Improved version of DJB2 with better entropy for longer strings.
 * BUG-22 fix.
 */
export function hashString(str: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Retrieves a lyric entry from the runtime cache or persistent storage.
 * BUG-26: Lazy-load from persistent storage if missing from memory.
 */
export async function loadSongCache(
  key: string,
  cache: SongCache,
  runtimeCache: Map<string, LyricsCacheEntry>
): Promise<void> {
  if (!key || !isContextValid()) return;
  try {
    let entry = runtimeCache.get(key);

    if (!entry) {
      const storageKey = `lc:${key}`;
      const data = await safeBrowserCall(() => browser.storage.local.get(storageKey));
      entry = data?.[storageKey] as LyricsCacheEntry | undefined;
      
      if (entry) {
        runtimeCache.set(key, entry);
      }
    }

    if (!entry) return;

    // BUG-22: Improved hash coherence check
    if (cache.original.length > 0) {
      const currentHash = hashString(cache.original.join('|'));
      if (entry.original.length !== cache.original.length || entry.originalHash !== currentHash) {
        return;
      }
    }

    entry.lastAccessed = Date.now();
    // Only update cache if it's currently empty or we are forcing a load
    if (cache.original.length === 0) {
        cache.original = [...entry.original];
    }

    for (const [lang, processed] of Object.entries(entry.processed)) {
        cache.processed.set(lang, processed);
    }

    // Update index timestamp asynchronously
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

/**
 * Saves a lyric entry to both runtime cache and persistent storage.
 */
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
    originalHash: hashString(cache.original.join('|')),
  };

  // Manage runtime cache size
  runtimeCache.set(key, entry);
  // BUG-L FIX: True LRU Eviction
  if (runtimeCache.size > RUNTIME_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [k, v] of runtimeCache.entries()) {
      if (v.lastAccessed < oldestTime) {
        oldestTime = v.lastAccessed;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      console.log(`[sly-cache] LRU Evicting: ${oldestKey} (last accessed: ${new Date(oldestTime).toISOString()})`);
      runtimeCache.delete(oldestKey);
    }
  }

  const storageKey = `lc:${key}`;

  // Manage persistent storage index and eviction
  safeBrowserCall(() => browser.storage.local.get('lc_index')).then(async (d) => {
    const idx = (d?.['lc_index'] ?? {}) as LyricsIndex;
    idx[key] = { lastAccessed: entry.lastAccessed };

    const keys = Object.keys(idx);
    if (keys.length > PERSISTED_CACHE_MAX) {
      const sorted = keys.sort((a, b) => (idx[a].lastAccessed ?? 0) - (idx[b].lastAccessed ?? 0));
      const toEvict = sorted.slice(0, keys.length - PERSISTED_CACHE_MAX);
      for (const k of toEvict) {
        delete idx[k];
        await safeBrowserCall(() => browser.storage.local.remove(`lc:${k}`));
      }
    }

    try {
      await safeBrowserCall(() => browser.storage.local.set({ [storageKey]: entry, lc_index: idx }));
    } catch (err: any) {
      console.warn('[SKaraoke:Content] saveSongCache failed:', err);
    }
  }).catch((err) => { console.warn('[SKaraoke:Content] saveSongCache index get failed:', err); });
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
