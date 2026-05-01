// Port of: lyric-test/modules/background/cache.js

/**
 * Shape of a fetched lyrics result stored in both L1 (memory) and L2 (persistent) caches.
 * Distinct from the existing lib/core/lyricsTypes.ts LyricsCacheEntry,
 * which is for the romanize/translate pipeline.
 */
export interface FetchedLyricsResult {
  ok: boolean;
  error?: string;
  data?: {
    syncedLyrics?: string;
    plainLyrics?: string;
    isSynced: boolean;
    source?: string;
    extractedColor?: string | null;
  };
  persistedAt?: number;
  lastCheckedAt?: number;
  lastAccessed?: number;
}

export class LyricsCache {
  private cache: Map<string, FetchedLyricsResult>;
  private inFlight: Map<string, Promise<FetchedLyricsResult>>;
  private limit: number;

  constructor(limit = 10) {
    this.cache = new Map();
    this.inFlight = new Map(); // cacheKey -> Promise
    this.limit = limit;
  }

  getCacheKey(title: string, artist: string, uri?: string): string {
    if (uri) return uri; // Prioritize unique Spotify URI
    return `${(title || '').trim().toLowerCase()}|${(artist || '').trim().toLowerCase()}`;
  }

  get(key: string): FetchedLyricsResult | undefined {
    const item = this.cache.get(key);
    if (item) item.lastAccessed = Date.now();
    return item;
  }

  set(key: string, val: FetchedLyricsResult): void {
    val.lastAccessed = Date.now();
    this.cache.set(key, val);
    if (this.cache.size > this.limit) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache.entries()) {
        const t = v.lastAccessed ?? 0;
        if (t < oldestTime) {
          oldestTime = t;
          oldestKey = k;
        }
      }
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  getInFlight(key: string): Promise<FetchedLyricsResult> | undefined {
    return this.inFlight.get(key);
  }

  setInFlight(key: string, promise: Promise<FetchedLyricsResult>): void {
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
  }
}

export const lyricsCache = new LyricsCache();
