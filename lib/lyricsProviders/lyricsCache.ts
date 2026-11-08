// Port of: lyric-test/modules/background/cache.js

/**
 * Shape of a fetched lyrics result stored in both L1 (memory) and L2 (persistent) caches.
 * Distinct from the existing lib/core/lyricsTypes.ts LyricsCacheEntry,
 * which is for the romanize/translate pipeline.
 */
export interface FetchedLyricsResult {
  ok: boolean;
  error?: string;
  prefetchState?: 'MISSING' | 'UNSYNCED' | 'SYNCED';
  data?: {
    syncedLyrics?: string;
    plainLyrics?: string;
    isSynced: boolean;
    source?: string;
    extractedColor?: string | null;
    /** A native-script copy was looked for when these synced lyrics read romanized (lyricsEngine). */
    nativeChecked?: boolean;
  };
  persistedAt?: number;
  lastCheckedAt?: number;
  lastAccessed?: number;
  /**
   * Set by keepAfterFailedRefresh: good lyrics whose refresh failed count as
   * fresh until this time, then the refresh is retried. persistedAt keeps the
   * real fetch time.
   */
  retryAt?: number;
  nativeStatus?: NativeStatus;
  /** Legacy native-status marker (pre-v3.1.6 stored these in the lyrics LRU). Never usable lyrics. */
  isPlaceholder?: boolean;
  /** Processed (romanized/translated) lines merged from the content script's lc: cache. */
  processed?: any;
}

export type NativeStatus = 'MISSING' | 'UNSYNCED' | 'ROMANIZED' | 'SYNCED' | 'NATIVE_OK';

// ---------------------------------------------------------------------------
// Cache policy (pure helpers, shared by the background handlers)
// ---------------------------------------------------------------------------
const HOUR_MS = 60 * 60 * 1000;
export const TTL_FAILED_MS = 12 * HOUR_MS;
export const TTL_UNSYNCED_MS = 24 * HOUR_MS;
export const TTL_SYNCED_MS = 30 * 24 * HOUR_MS;
/** After a failed refresh of good lyrics, the kept entry is retried after this delay. */
export const FAILED_REFRESH_RETRY_MS = HOUR_MS;

/**
 * TTL from the FETCHED data, not Spotify's native status:
 * failure/placeholder 12h, unsynced 24h, synced 30d.
 */
export function getDynamicTTL(entry: FetchedLyricsResult | null | undefined): number {
  if (!entry) return 0;
  if (entry.isPlaceholder || !entry.ok) return TTL_FAILED_MS;
  if (entry.data?.isSynced) return TTL_SYNCED_MS;
  return TTL_UNSYNCED_MS;
}

/** True when the entry holds real lyrics (not a placeholder or failure). */
export function hasGoodLyrics(entry: FetchedLyricsResult | null | undefined): entry is FetchedLyricsResult {
  return !!entry && !entry.isPlaceholder && entry.ok === true && !!entry.data
    && !!(entry.data.syncedLyrics || entry.data.plainLyrics);
}

/**
 * When the entry must be re-fetched: persistedAt + dynamic TTL, pushed back to
 * retryAt after a failed refresh of good lyrics (never pulled forward by it).
 */
export function getCacheExpiry(entry: FetchedLyricsResult | null | undefined): number {
  if (!entry) return 0;
  return Math.max((entry.persistedAt || 0) + getDynamicTTL(entry), entry.retryAt || 0);
}

/** True once the entry is past its dynamic TTL (or its retry time after a failed refresh). */
export function isCacheEntryExpired(entry: FetchedLyricsResult | null | undefined, now = Date.now()): boolean {
  return now > getCacheExpiry(entry);
}

/**
 * Contract K8: an entry may be reported as a cache hit only when it is not a
 * placeholder, ok === true, and still within its dynamic TTL.
 */
export function isUsableCacheEntry(entry: FetchedLyricsResult | null | undefined, now = Date.now()): boolean {
  if (!entry || entry.isPlaceholder || entry.ok !== true) return false;
  return !isCacheEntryExpired(entry, now);
}

/**
 * A refresh failed but the previous entry had good lyrics: keep it, and retry
 * the refresh after FAILED_REFRESH_RETRY_MS. persistedAt is left alone (it is
 * not back-dated toward any expiry limit); the retry time goes in retryAt, and
 * getCacheExpiry never lets it shorten an entry that is still fresh.
 */
export function keepAfterFailedRefresh(prev: FetchedLyricsResult, now = Date.now()): FetchedLyricsResult {
  return {
    ...prev,
    lastCheckedAt: now,
    retryAt: Math.max(prev.retryAt || 0, now + FAILED_REFRESH_RETRY_MS),
  };
}

export class LyricsCache {
  private cache: Map<string, FetchedLyricsResult>;
  private inFlight: Map<string, Promise<FetchedLyricsResult>>;
  private limit: number;

  constructor(limit = 50) {
    this.cache = new Map();
    this.inFlight = new Map(); // cacheKey -> Promise
    this.limit = limit;
  }

  getCacheKey(title: string, artist: string, uri?: string): string {
    if (uri) return uri; // Prioritize unique Spotify URI
    
    // Normalize: trim, lower, and strip common punctuation/remix markers
    const normalize = (s: string) => (s || '')
      .trim()
      .toLowerCase()
      .replace(/[\(\[\{].*?[\)\]\}]/g, '') // Remove (Remix), [Remaster], etc.
      // V16 Fix: Use Unicode-aware character classes instead of \w (which is [a-zA-Z0-9_]).
      // \w strips ALL CJK, Cyrillic, Devanagari, etc., causing cache key collisions
      // for non-Latin songs (e.g. "夜に駆ける" becomes "").
      .replace(/[^\p{L}\p{N}\s]/gu, '')    // Remove punctuation, keep letters + numbers
      .replace(/\s+/g, ' ')                // Collapse whitespace
      .trim();

    return `${normalize(title)}|${normalize(artist)}`;
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
    promise.finally(() => {
      // Only remove our own entry (a reset may have cleared it and a newer fetch replaced it).
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }).catch(() => {});
  }

  /** Drops every L1 entry and in-flight fetch (popup Reset, contract K7). */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

export const lyricsCache = new LyricsCache();
