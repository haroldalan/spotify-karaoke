// Port of: lyric-test/modules/background/persistence.js

import type { FetchedLyricsResult } from './lyricsCache';

import { enqueueStorageOperation } from '../core/storageManager';
import { safeBrowserCall } from '../utils/browserUtils';

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
    const result = await safeBrowserCall(() => browser.storage.local.get([key]));
    let entry = result?.[key] as FetchedLyricsResult | undefined;

    if (!entry && fallbackKey && key !== fallbackKey) {
      const fallbackResult = await safeBrowserCall(() => browser.storage.local.get([fallbackKey]));
      entry = fallbackResult?.[fallbackKey] as FetchedLyricsResult | undefined;
      
      if (entry) {
        // Migration logic (BUG-C3): Upgrade legacy title|artist key to URI
        console.log(`[LyricsPersistence] MIGRATING legacy entry: ${fallbackKey} -> ${key}`);
        await this.set(key, entry);
        await safeBrowserCall(() => browser.storage.local.remove(fallbackKey));
      }
    }

    if (entry) {
      const age = Date.now() - (entry.persistedAt || 0);
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      if (age > THIRTY_DAYS) {
        console.log(`[LyricsPersistence] EXPIRED (TTL): ${key}`);
        await safeBrowserCall(() => browser.storage.local.remove(key));
        return null;
      }
      console.log(`[LyricsPersistence] HIT: ${key}`);
      return entry;
    }
    console.log(`[LyricsPersistence] MISS: ${key}`);
    return null;
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
        let index = l2_index.filter(k => k !== key);
        index.push(key);

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
}

export const lyricsPersistence = new LyricsPersistence();
