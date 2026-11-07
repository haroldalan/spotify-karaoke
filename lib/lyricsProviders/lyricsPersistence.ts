// Port of: lyric-test/modules/background/persistence.js

import type { FetchedLyricsResult, NativeStatus } from './lyricsCache';
import { hasGoodLyrics } from './lyricsCache';

import { enqueueStorageOperation } from '../core/storageManager';
import { safeBrowserCall } from '../utils/browserUtils';

/** Garbage-collection limit for entries WITHOUT good lyrics (failures, placeholders). */
const HARD_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export const NATIVE_STATUS_KEY = 'sly_native_status';
const NATIVE_STATUS_MAX = 1000;
const NATIVE_STATUS_EVICT_BATCH = 100;
/** An unchanged status only re-stamps its eviction age this often (C8/C3). */
export const NATIVE_STATUS_REFRESH_MS = 60 * 60 * 1000;

type NativeStatusMap = Record<string, { s: NativeStatus; t: number }>;

async function readNativeStatusMap(): Promise<NativeStatusMap> {
  const d = (await safeBrowserCall(() => browser.storage.local.get([NATIVE_STATUS_KEY]))) as Record<string, unknown> | null;
  const map = d?.[NATIVE_STATUS_KEY];
  return map && typeof map === 'object' ? { ...(map as NativeStatusMap) } : {};
}

export class LyricsPersistence {
  constructor() {
    console.log('[LyricsPersistence] Initialized.');
  }

  /**
   * Retrieves lyrics from persistent storage.
   * @param key - Spotify URI or title|artist
   * @param fallbackKey - Optional fallback key (e.g. title|artist if key is URI)
   */
  async get(key: string, fallbackKey?: string): Promise<FetchedLyricsResult | null> {
    return enqueueStorageOperation(async () => {
      const result = await safeBrowserCall(() => browser.storage.local.get([key]));
      let entry = result?.[key] as FetchedLyricsResult | undefined;

      if (!entry && fallbackKey && key !== fallbackKey) {
        const fallbackResult = await safeBrowserCall(() => browser.storage.local.get([fallbackKey]));
        entry = fallbackResult?.[fallbackKey] as FetchedLyricsResult | undefined;
        
        if (entry) {
          // Migration logic (BUG-C3): Upgrade legacy title|artist key to URI
          console.log(`[LyricsPersistence] MIGRATING legacy entry: ${fallbackKey} -> ${key}`);
          // Note: we can't call this.set() here as it would double-enqueue.
          // Instead, we manually perform the storage logic for the migration.
          const entryRecord: Record<string, FetchedLyricsResult> = {
            [key]: {
              ...entry,
              persistedAt: entry.persistedAt || Date.now(),
              lastCheckedAt: Date.now(),
            }
          };
          await safeBrowserCall(() => browser.storage.local.set(entryRecord));
          await safeBrowserCall(() => browser.storage.local.remove(fallbackKey));
        }
      }

      if (entry) {
        const age = Date.now() - (entry.persistedAt || 0);
        // Hard expiry only collects failures and legacy placeholders. Good lyrics
        // are never deleted on read: this limit equals the 30d synced TTL, so
        // deleting them here dropped synced lyrics before a failed re-fetch could
        // keep them. Their dynamic TTL (getCacheExpiry) triggers the re-fetch, a
        // failed re-fetch keeps them, and the 200-entry l2_index bounds storage.
        if (!hasGoodLyrics(entry) && age > HARD_EXPIRY_MS) {
          console.log(`[LyricsPersistence] EXPIRED (TTL): ${key}`);
          await safeBrowserCall(() => browser.storage.local.remove(key));
          
          const d = await safeBrowserCall(() => browser.storage.local.get({ l2_index: [] }));
          const l2_index = (d?.l2_index ?? []) as string[];
          const idx = l2_index.indexOf(key);
          // V5 Fix: Only splice if the key is actually in the index.
          // splice(-1, 1) removes the LAST element when indexOf returns -1,
          // silently corrupting the index and evicting the wrong song.
          if (idx !== -1) {
            l2_index.splice(idx, 1);
            await safeBrowserCall(() => browser.storage.local.set({ l2_index }));
          }

          return null;
        }
        console.log(`[LyricsPersistence] HIT: ${key}`);
        return entry;
      }
      console.log(`[LyricsPersistence] MISS: ${key}`);
      return null;
    });
  }

  /**
   * Stores lyrics in persistent storage.
   * @param key - Spotify URI or title|artist
   * @param data - The lyrics data object
   */
  async set(key: string, data: FetchedLyricsResult): Promise<void> {
    const entry: Record<string, FetchedLyricsResult> = {};
    entry[key] = {
      ...data,
      persistedAt: data.persistedAt || Date.now(),
      lastCheckedAt: Date.now(),
    };

    // Serialize all storage writes via the central storageManager
    return enqueueStorageOperation(async () => {
      try {
        await safeBrowserCall(() => browser.storage.local.set(entry));

        // Eviction Logic: Maintain an l2_index to track the 200 most recent fetches
        const d = await safeBrowserCall(() => browser.storage.local.get({ l2_index: [] }));
        const l2_index = (d?.l2_index ?? []) as string[];
        
        // BUG-13 Fix: Use indexOf + splice instead of O(n) filter for uniqueness.
        const idx = l2_index.indexOf(key);
        if (idx !== -1) l2_index.splice(idx, 1);
        l2_index.push(key);
        const index = l2_index;

        if (index.length > 200) {
          const toRemove = index.splice(0, 50);
          await safeBrowserCall(() => browser.storage.local.remove(toRemove));
        }
        await safeBrowserCall(() => browser.storage.local.set({ l2_index: index }));
        console.log(`[LyricsPersistence] SAVED: ${key}`);
      } catch (e) {
        console.warn('[LyricsPersistence] Index update failed:', e);
        throw e; // Propagate to caller
      }
    });
  }

  /**
   * Spotify's native lyrics status for tracks that have no fetched lyrics.
   * Kept in its own capped map so these markers never occupy (or evict from)
   * the 200-entry lyrics index above.
   */
  async getNativeStatus(key: string): Promise<NativeStatus | null> {
    return enqueueStorageOperation(async () => {
      const map = await readNativeStatusMap();
      return map[key]?.s ?? null;
    });
  }

  async setNativeStatus(key: string, status: NativeStatus): Promise<void> {
    return enqueueStorageOperation(async () => {
      const map = await readNativeStatusMap();
      const now = Date.now();
      // C8/C3: the content script repeats the same report every poll tick. An
      // unchanged status must not rewrite the whole map (and broadcast
      // storage.onChanged); only refresh its age for eviction, at most hourly.
      const prev = map[key];
      if (prev?.s === status && now - (prev.t ?? 0) < NATIVE_STATUS_REFRESH_MS) return;
      map[key] = { s: status, t: now };
      const keys = Object.keys(map);
      if (keys.length > NATIVE_STATUS_MAX) {
        keys
          .sort((a, b) => (map[a].t ?? 0) - (map[b].t ?? 0))
          .slice(0, keys.length - NATIVE_STATUS_MAX + NATIVE_STATUS_EVICT_BATCH)
          .forEach((k) => { delete map[k]; });
      }
      await safeBrowserCall(() => browser.storage.local.set({ [NATIVE_STATUS_KEY]: map }));
    });
  }
}

export const lyricsPersistence = new LyricsPersistence();
