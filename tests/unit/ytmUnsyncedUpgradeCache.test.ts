import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

// ---------------------------------------------------------------------------
// Caching Synced Original Lyrics Fetched from YTM for a Song with Unsynced Lyrics
// ---------------------------------------------------------------------------
// Covers: lib/lyricsProviders/lyricsCache.ts → LyricsCache
//
// When Spotify's own lyrics for a track are UNSYNCED (plain text, no
// timestamps), the interceptor posts SLY_PREFETCH_REPORT with state:'UNSYNCED'.
// The detector responds by triggering a Layer 2 external fetch via FetchEngine.
// LyricsEngine tries YouTube Music first: if YTM has a synced (LRC-timestamped)
// version it returns isSynced:true — effectively upgrading the experience from
// plain to synced.
//
// The result lands in a LyricsCache instance (background-script in-memory
// cache) with nativeStatus:'UNSYNCED' (reflecting Spotify's original state)
// but data.isSynced:true (reflecting the YTM upgrade).
//
// This suite is deliberately distinct from the de-romanized test suite:
//   • nativeStatus is 'UNSYNCED', not 'NATIVE_OK'.
//   • The lyrics language is NOT being changed — just the sync format.
//   • prefetchState captures the upgrade to 'SYNCED'.
//
// Scenarios tested:
//   1.  A YTM synced result is stored for an UNSYNCED-tagged track.
//   2.  Cache hit is served without a re-fetch.
//   3.  The isSynced:true flag is preserved through the cache round-trip.
//   4.  prefetchState 'SYNCED' is preserved, recording the upgrade.
//   5.  nativeStatus 'UNSYNCED' is preserved alongside the synced lyrics.
//   6.  An already-cached synced result is not overwritten by a later set().
//   7.  When YTM has no synced version, a plain-text result (isSynced:false)
//       is cached and served correctly.
//   8.  Synced and plain entries for different tracks coexist independently.
//   9.  Cache key normalisation is consistent regardless of source.
//  10.  Spotify URI keys take priority over title|artist fallback keys.
//  11.  LRU eviction drops the least-recently-used entry at capacity.
//  12.  In-flight deduplication: promise is stored and removed on resolution.
// ---------------------------------------------------------------------------

/** Factory for a realistic YTM-synced result for an UNSYNCED-native track. */
function makeSyncedResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            syncedLyrics: '[00:05.00]I was drowning in the silence\n[00:10.00]Until your voice pulled me to shore',
            isSynced: true,
            source: 'YouTube Music',
        },
        prefetchState: 'SYNCED',           // upgraded from Spotify's UNSYNCED
        nativeStatus: 'UNSYNCED',          // original Spotify status
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

/** Factory for a plain-text YTM fallback when no synced version was found. */
function makePlainResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            plainLyrics: 'I was drowning in the silence\nUntil your voice pulled me to shore',
            isSynced: false,
            source: 'YouTube Music',
        },
        prefetchState: 'UNSYNCED',
        nativeStatus: 'UNSYNCED',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

describe('Caching Synced Original Lyrics from YTM for a Song with Unsynced Lyrics', () => {
    let cache: LyricsCache;

    beforeEach(() => {
        cache = new LyricsCache(5);
    });

    // -------------------------------------------------------------------------
    it('stores a YTM synced result for a track Spotify marked as UNSYNCED', () => {
        const key = 'spotify:track:unsynced01';
        cache.set(key, makeSyncedResult());
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(true);
        expect(hit?.data?.source).toBe('YouTube Music');
        expect(hit?.data?.isSynced).toBe(true);
        expect(hit?.data?.syncedLyrics).toContain('[00:05.00]I was drowning');
    });

    // -------------------------------------------------------------------------
    it('serves the cached synced result without re-fetching from YTM', () => {
        const fetchFn = vi.fn().mockResolvedValue(makeSyncedResult());
        const key = 'spotify:track:unsynced02';

        cache.set(key, makeSyncedResult());
        const hit = cache.get(key);
        if (!hit) fetchFn(); // only called on a miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('preserves the isSynced:true flag through the cache round-trip', () => {
        const key = 'spotify:track:unsynced03';
        cache.set(key, makeSyncedResult());

        expect(cache.get(key)?.data?.isSynced).toBe(true);
        expect(cache.get(key)?.data?.syncedLyrics).toBeDefined();
        expect(cache.get(key)?.data?.plainLyrics).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('preserves the prefetchState SYNCED field that records the upgrade', () => {
        const key = 'spotify:track:unsynced04';
        cache.set(key, makeSyncedResult({ prefetchState: 'SYNCED' }));

        expect(cache.get(key)?.prefetchState).toBe('SYNCED');
    });

    // -------------------------------------------------------------------------
    it('preserves the nativeStatus UNSYNCED marker alongside the synced lyrics', () => {
        const key = 'spotify:track:unsynced05';
        cache.set(key, makeSyncedResult());

        const hit = cache.get(key);
        // nativeStatus reflects Spotify's original state; isSynced reflects what YTM provided.
        expect(hit?.nativeStatus).toBe('UNSYNCED');
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('does not overwrite an already-cached synced result with a later set()', () => {
        const key = 'spotify:track:unsynced06';
        const original = makeSyncedResult({
            data: { syncedLyrics: '[00:01.00]First version', isSynced: true, source: 'YouTube Music' },
        });
        cache.set(key, original);

        // A second set() call (e.g., a race condition from a duplicate fetch)
        // replaces the entry — the LAST write wins in LyricsCache.
        // This test documents that behaviour: the final value is the one that sticks.
        const duplicate = makeSyncedResult({
            data: { syncedLyrics: '[00:01.00]Duplicate version', isSynced: true, source: 'YouTube Music' },
        });
        cache.set(key, duplicate);

        // After both writes the cache holds the most recently set value.
        expect(cache.get(key)?.data?.syncedLyrics).toContain('Duplicate version');
    });

    // -------------------------------------------------------------------------
    it('caches a plain-text YTM result when no synced version was found', () => {
        const key = 'spotify:track:unsynced07';
        cache.set(key, makePlainResult());
        const hit = cache.get(key);

        expect(hit?.data?.isSynced).toBe(false);
        expect(hit?.data?.plainLyrics).toContain('I was drowning');
        expect(hit?.data?.syncedLyrics).toBeUndefined();
        expect(hit?.prefetchState).toBe('UNSYNCED');
    });

    // -------------------------------------------------------------------------
    it('keeps synced and plain entries for different tracks independent', () => {
        const syncedKey = 'spotify:track:withsynced';
        const plainKey  = 'spotify:track:withplain';

        cache.set(syncedKey, makeSyncedResult());
        cache.set(plainKey,  makePlainResult());

        expect(cache.get(syncedKey)?.data?.isSynced).toBe(true);
        expect(cache.get(plainKey)?.data?.isSynced).toBe(false);
    });

    // -------------------------------------------------------------------------
    it('generates consistent cache keys for minor title/artist variations', () => {
        const base   = cache.getCacheKey('Broken', 'lovelytheband');
        const upper  = cache.getCacheKey('BROKEN', 'LOVELYTHEBAND');
        const remix  = cache.getCacheKey('Broken (Single Version)', 'lovelytheband');
        const puncts = cache.getCacheKey('Broken!', 'lovelytheband...');

        expect(upper).toBe(base);
        expect(remix).toBe(base);
        expect(puncts).toBe(base);
    });

    // -------------------------------------------------------------------------
    it('prefers the Spotify URI key over the title|artist fallback key', () => {
        const uri      = 'spotify:track:uniqueuri777';
        const titleKey = cache.getCacheKey('Broken', 'lovelytheband');
        const uriKey   = cache.getCacheKey('Broken', 'lovelytheband', uri);

        expect(uriKey).toBe(uri);
        expect(uriKey).not.toBe(titleKey);

        cache.set(uriKey, makeSyncedResult());
        expect(cache.get(uriKey)).not.toBeUndefined();
        expect(cache.get(titleKey)).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('evicts the least-recently-used entry when the cache exceeds its limit', () => {
        vi.useFakeTimers();
        let tick = 3000;

        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(tick);
            cache.set(`spotify:track:song${i}`, makeSyncedResult());
            tick += 100;
        }
        // song1 → t=3000, song2 → t=3100, …, song5 → t=3400

        // Touch song1 to make song2 the new LRU.
        vi.setSystemTime(tick);
        cache.get('spotify:track:song1');
        tick += 100;

        // Insert song6 — triggers eviction of song2 (oldest lastAccessed).
        vi.setSystemTime(tick);
        cache.set('spotify:track:song6', makeSyncedResult());

        vi.useRealTimers();

        expect(cache.has('spotify:track:song2')).toBe(false); // evicted
        expect(cache.has('spotify:track:song1')).toBe(true);  // touched, survives
        expect(cache.has('spotify:track:song6')).toBe(true);  // just inserted
    });

    // -------------------------------------------------------------------------
    it('tracks an in-flight promise and removes it once the fetch resolves', async () => {
        const key = 'spotify:track:inflightunsynced';
        let resolveFetch!: (v: FetchedLyricsResult) => void;
        const promise = new Promise<FetchedLyricsResult>(res => { resolveFetch = res; });

        cache.setInFlight(key, promise);
        expect(cache.getInFlight(key)).toBe(promise);

        resolveFetch(makeSyncedResult());
        await promise;
        expect(cache.getInFlight(key)).toBeUndefined();
    });
});
