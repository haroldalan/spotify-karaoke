import { isContextValid, safeBrowserCall } from '../utils/browserUtils';
import { hashString } from '../utils/hashUtils';
import type { SongCache, LyricsCacheEntry, LyricsIndex, UnifiedSongCacheEntry } from './lyricsTypes';
import { isUnifiedSongCacheEntry } from './lyricsTypes';

const RUNTIME_CACHE_MAX = 50; // BUG-15: Increased from 10
const PERSISTED_CACHE_MAX = 200;

// ---------------------------------------------------------------------------
// Session-storage mirror
// ---------------------------------------------------------------------------
// Writes the processed cache to sessionStorage so it survives within-tab reloads
// (Ctrl+Shift+R) without requiring an async browser.storage.local read.
// sessionStorage is cleared when the tab is closed, so this is purely a
// performance optimisation — not a source of truth.

const SESSION_KEY = (songKey: string) => `sly_proc:${songKey}`;

function writeSessionCache(songKey: string, entry: LyricsCacheEntry): void {
  if (!songKey || !Object.keys(entry.processed).length) return;
  try {
    sessionStorage.setItem(SESSION_KEY(songKey), JSON.stringify(entry));
  } catch {
    // sessionStorage quota exceeded or unavailable (private browsing edge cases) — ignore.
  }
}

/**
 * Synchronously hydrates runtimeCache from sessionStorage for a given song key.
 *
 * Call this at the top of onSongChange, before the hasHotCache check, so that
 * cache hits from a within-tab reload (Ctrl+Shift+R) resolve to hasHotCache=true
 * and the existing hot-cache fast path applies processed lyrics without any
 * async storage read.
 *
 * @returns true if the session cache was found and runtimeCache was hydrated.
 */
export function warmRuntimeCacheFromSession(
  songKey: string,
  runtimeCache: Map<string, LyricsCacheEntry | UnifiedSongCacheEntry>
): boolean {
  if (!songKey || runtimeCache.has(songKey)) return false;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(songKey));
    if (!raw) return false;
    const entry = JSON.parse(raw) as LyricsCacheEntry | UnifiedSongCacheEntry;
    if (!entry.original?.length || !entry.processed) return false;
    // Apply 30-day TTL check to be consistent with loadSongCache.
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (entry.persistedAt && (Date.now() - entry.persistedAt) > THIRTY_DAYS) {
      sessionStorage.removeItem(SESSION_KEY(songKey));
      return false;
    }
    runtimeCache.set(songKey, entry);
    console.log(`[sly-cache] ⚡ Session cache hit for "${songKey}" — runtimeCache hydrated synchronously.`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pre-warms the runtime cache by bulk-loading indexed entries from persistent storage.
 * This makes already-cached songs synchronous after a new content-script session.
 */
export async function prewarmRuntimeCache(runtimeCache: Map<string, LyricsCacheEntry | UnifiedSongCacheEntry>): Promise<void> {
  if (!isContextValid()) return;
  try {
    const d = await safeBrowserCall(() => browser.storage.local.get('lc_index'));
    const idx = (d?.['lc_index'] ?? {}) as Record<string, { lastAccessed: number }>;

    const keys = Object.keys(idx);
    if (keys.length === 0) return;

    const storageKeys = keys
      .sort((a, b) => (idx[b].lastAccessed || 0) - (idx[a].lastAccessed || 0))
      .map(k => `lc:${k}`);

    const data = await safeBrowserCall(() => browser.storage.local.get(storageKeys));
    if (!data) return;

    for (const [storageKey, entry] of Object.entries(data)) {
      const songKey = storageKey.replace(/^lc:/, '');
      if (entry && !runtimeCache.has(songKey)) {
        runtimeCache.set(songKey, entry as LyricsCacheEntry | UnifiedSongCacheEntry);
      }
    }

    console.log(`[sly-cache] Prewarmed ${runtimeCache.size} entries into runtime cache.`);
  } catch (err) {
    console.warn('[sly-cache] Prewarm failed:', err);
  }
}

// SLY FIX: Expose the runtimeCache to window so FetchEngine can bridge to it
if (typeof window !== 'undefined') {
  (window as any).slyRuntimeCache = new Map();
}
export const runtimeCache: Map<string, LyricsCacheEntry | UnifiedSongCacheEntry> = (window as any).slyRuntimeCache;

/**
 * Retrieves a lyric entry from the runtime cache or persistent storage.
 * BUG-26: Lazy-load from persistent storage if missing from memory.
 */
export async function loadSongCache(
  key: string,
  cache: SongCache,
  runtimeCache: Map<string, LyricsCacheEntry | UnifiedSongCacheEntry>
): Promise<void> {
  if (!key || !isContextValid()) return;
  try {
    let entry = runtimeCache.get(key);

    if (!entry) {
      const storageKey = `lc:${key}`;
      const data = await safeBrowserCall(() => browser.storage.local.get(storageKey));
      entry = data?.[storageKey] as LyricsCacheEntry | UnifiedSongCacheEntry | undefined;
      
      if (entry) {
        runtimeCache.delete(key); // BUG-C2: Refresh position in Map for LRU
        runtimeCache.set(key, entry);
      }
    }

    if (!entry) return;

    // BUG-2 Fix: 30-day TTL check on processed-lyrics cache entries.
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (entry.persistedAt && (Date.now() - entry.persistedAt) > THIRTY_DAYS) {
      console.warn('[SKaraoke:Content] loadSongCache: Entry expired (30-day TTL). Deleting:', key);
      runtimeCache.delete(key);
      try { sessionStorage.removeItem(SESSION_KEY(key)); } catch {}
      browser.runtime.sendMessage({ type: 'SLY_DELETE_L0_CACHE', payload: { key } }).catch(() => {});
      return;
    }

    // BUG-1 Fix: Hash coherence check — discard + delete stale entry on mismatch.
    if (cache.original.length > 0) {
      const currentHash = hashString(cache.original.join('|'));
      const sameLines = Array.isArray(entry.original) && entry.original.length === cache.original.length &&
        entry.original.every((line: string, idx: number) => line.trim() === cache.original[idx].trim());

      if (entry.original.length !== cache.original.length || entry.originalHash !== currentHash || !sameLines) {
        console.warn('[SKaraoke:Content] loadSongCache: Line mismatch or hash mismatch — discarding stale processed cache for key:', key);
        runtimeCache.delete(key);
        try { sessionStorage.removeItem(SESSION_KEY(key)); } catch {}
        browser.runtime.sendMessage({ type: 'SLY_DELETE_L0_CACHE', payload: { key } }).catch(() => {});
        return;
      }
    }

    entry.lastAccessed = Date.now();
    // Only update cache if it's currently empty or we are forcing a load
    if (cache.original.length === 0) {
        cache.original = [...entry.original];
    }

    for (const [lang, processed] of Object.entries(entry.processed)) {
        cache.processed.set(lang, processed as any);
    }

    // Update index timestamp via background to prevent races (BUG-A3)
    browser.runtime.sendMessage({
      type: 'SLY_UPDATE_L0_INDEX',
      payload: { key }
    }).catch(() => {});

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
  runtimeCache: Map<string, LyricsCacheEntry | UnifiedSongCacheEntry>
): Promise<void> {
  if (!key || cache.original.length === 0 || !isContextValid()) return;

  const existingEntry = runtimeCache.get(key);
  let entry: UnifiedSongCacheEntry;

  const processedObj: Record<string, any> = {};
  cache.processed.forEach((val, lang) => { processedObj[lang] = val; });

  const currentHash = hashString(cache.original.join('|'));

  if (existingEntry && isUnifiedSongCacheEntry(existingEntry)) {
    entry = {
      ...existingEntry,
      original: cache.original,
      processed: processedObj,
      originalHash: currentHash,
      metadata: {
        ...existingEntry.metadata,
        lastAccessed: Date.now(),
        persistedAt: Date.now(),
      },
      // compatibility fields
      lastAccessed: Date.now(),
      persistedAt: Date.now(),
    };
  } else {
    // Generate a backward-compatible UnifiedSongCacheEntry from scratch
    entry = {
      uri: key.startsWith('spotify:track:') ? key : `spotify:track:unknown:${key}`,
      title: key.split('|')[0] || 'Unknown',
      artist: key.split('|')[1] || 'Unknown',
      status: 'SYNCED',
      lyrics: {
        plainLyrics: cache.original.join('\n'),
        source: 'SPOTIFY',
      },
      processed: processedObj,
      metadata: {
        persistedAt: Date.now(),
        lastAccessed: Date.now(),
      },
      // backward compatibility properties
      original: cache.original,
      originalHash: currentHash,
      lastAccessed: Date.now(),
      persistedAt: Date.now(),
    };
  }

  // Manage runtime cache size (BUG-C2: True LRU via delete-before-set)
  runtimeCache.delete(key);
  runtimeCache.set(key, entry);
  if (runtimeCache.size > RUNTIME_CACHE_MAX) {
    const oldestKey = runtimeCache.keys().next().value;
    if (oldestKey) runtimeCache.delete(oldestKey);
  }

  // Also mirror to sessionStorage so within-tab reloads (Ctrl+Shift+R) can
  // hydrate runtimeCache synchronously, bypassing the async storage.local read
  // and eliminating the original-lyrics flash on reload.
  writeSessionCache(key, entry as any);

  // Delegate persistent storage write to background queue (BUG-A3)
  browser.runtime.sendMessage({
    type: 'SLY_SAVE_L0_CACHE',
    payload: { key, entry, PERSISTED_CACHE_MAX }
  }).then((resp) => {
    if (resp && resp.ok === false) {
      console.warn('[SKaraoke:Content] saveSongCache: background reported storage failure (quota exceeded?). Data lives in memory only for this session.', resp.error);
    }
  }).catch((err) => {
    console.warn('[SKaraoke:Content] saveSongCache: message send failed (background unavailable?):', err);
  });
}

export function deleteSongCache(key: string, runtimeCache: Map<string, any>): void {
  if (!key) return;
  
  runtimeCache.delete(key);
  try { sessionStorage.removeItem(SESSION_KEY(key)); } catch {}

  // Delegate deletion to background queue (BUG-A3)
  browser.runtime.sendMessage({
    type: 'SLY_DELETE_L0_CACHE',
    payload: { key }
  }).catch(() => {});
}
