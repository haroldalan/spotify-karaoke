// Port of: lyric-test/modules/background/persistence.js

import type { FetchedLyricsResult } from './lyricsCache';

export class LyricsPersistence {
  constructor() {
    console.log('[LyricsPersistence] Initialized.');
  }

  /**
   * Retrieves lyrics from persistent storage.
   * @param key - Spotify URI or title|artist
   */
  async get(key: string): Promise<FetchedLyricsResult | null> {
    const result = await browser.storage.local.get([key]);
    const entry = result[key] as FetchedLyricsResult | undefined;
    if (entry) {
      const age = Date.now() - (entry.persistedAt || 0);
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      if (age > THIRTY_DAYS) {
        console.log(`[LyricsPersistence] EXPIRED (TTL): ${key}`);
        await browser.storage.local.remove(key);
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
    await browser.storage.local.set(entry);

    // Eviction Logic: Maintain an l2_index to track the 200 most recent fetches
    try {
      const { l2_index } = await browser.storage.local.get({ l2_index: [] });
      let index = (l2_index as string[]).filter(k => k !== key);
      index.push(key);

      if (index.length > 200) {
        const toRemove = index.splice(0, 50);
        await browser.storage.local.remove(toRemove);
      }
      await browser.storage.local.set({ l2_index: index });
    } catch (e) {
      console.warn('[LyricsPersistence] Index update failed:', e);
    }

    console.log(`[LyricsPersistence] SAVED: ${key}`);
  }
}

export const lyricsPersistence = new LyricsPersistence();
