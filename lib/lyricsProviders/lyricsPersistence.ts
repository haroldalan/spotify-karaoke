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
    if (result[key]) {
      console.log(`[LyricsPersistence] HIT: ${key}`);
      return result[key] as FetchedLyricsResult;
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
    console.log(`[LyricsPersistence] SAVED: ${key}`);
  }
}

export const lyricsPersistence = new LyricsPersistence();
