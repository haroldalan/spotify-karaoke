import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

// ---------------------------------------------------------------------------
// Caching Missing Lyrics State After Failed Fetch from LRCLIB for a Song with Missing Lyrics
// ---------------------------------------------------------------------------
// Covers: lib/lyricsProviders/lyricsCache.ts → LyricsCache
//
// The MISSING path is distinct from the UNSYNCED and de-romanized paths:
//
//   UNSYNCED  → Spotify has the song's lyrics but they are plain text only.
//   MISSING   → Spotify has NO lyrics at all (color-lyrics returns 404).
//
// When the interceptor receives a 404 it posts SLY_PREFETCH_REPORT with
// state:'MISSING'. The detector triggers a Layer 2 external fetch.
// If LRCLIB is queried (usually after YTM fails) but also has no lyrics (or fails),
// the engine stores a failure result in LyricsCache to prevent repeated/redundant
// network requests.
//
// The cached failure entry has:
//   ok           : false
//   nativeStatus : 'MISSING'   ← Spotify's original state (no lyrics)
//   prefetchState: 'MISSING'   ← still missing after attempting LRCLIB fetch
//   data         : undefined   ← no lyrics data present
//
// Scenarios tested:
//   1.  A failed LRCLIB fetch result (ok:false) is stored for a MISSING-tagged track.
//   2.  A cached failure is served on subsequent requests, blocking re-fetch loops.
//   3.  Properties (ok:false, prefetchState:'MISSING', nativeStatus:'MISSING', data:undefined) are preserved.
//   4.  Distinguishes a MISSING+failed entry from a MISSING+synced LRCLIB entry.
//   5.  Distinguishes a MISSING+failed entry from a MISSING+unsynced LRCLIB entry.
//   6.  A MISSING+failed entry and a successful entry coexist without interfering.
//   7.  Cache key normalisation is consistent.
//   8.  Spotify URI keys take priority over title|artist fallback keys.
//   9.  LRU eviction drops the least-recently-used entry at capacity.
//  10.  In-flight deduplication: promise is stored and removed on resolution.
// ---------------------------------------------------------------------------

/** LRCLIB (and all other sources) found nothing → engine returns { ok:false }. */
function makeFailedResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: false,
        prefetchState: 'MISSING',
        nativeStatus: 'MISSING',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

/** LRCLIB successfully found synced (LRC) lyrics for a track Spotify reported as MISSING. */
function makeMissingToSyncedResult(): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            syncedLyrics: '[00:04.00]Take me to the river\n[00:08.50]Drop me in the water',
            isSynced: true,
            source: 'LRCLIB',
        },
        prefetchState: 'SYNCED',
        nativeStatus: 'MISSING',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
    };
}

/** LRCLIB successfully found unsynced (plain) lyrics for a track Spotify reported as MISSING. */
function makeMissingToUnsyncedResult(): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            plainLyrics: 'Take me to the river\nDrop me in the water',
            isSynced: false,
            source: 'LRCLIB',
        },
        prefetchState: 'UNSYNCED',
        nativeStatus: 'MISSING',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
    };
}

describe('Caching Missing Lyrics State After Failed Fetch from LRCLIB for a Song with Missing Lyrics', () => {
    let cache: LyricsCache;

    beforeEach(() => {
        cache = new LyricsCache(5);
    });

    // -------------------------------------------------------------------------
    it('stores a failed fetch result (ok:false) when LRCLIB has no lyrics for a track missing on Spotify', () => {
        const key = 'spotify:track:failed-lrclib-missing01';
        cache.set(key, makeFailedResult());
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(false);
        expect(hit?.data).toBeUndefined();
        expect(hit?.nativeStatus).toBe('MISSING');
        expect(hit?.prefetchState).toBe('MISSING');
    });

    // -------------------------------------------------------------------------
    it('serves the cached failure result on subsequent requests, blocking re-fetch loops', () => {
        const fetchFn = vi.fn().mockResolvedValue(makeFailedResult());
        const key = 'spotify:track:failed-lrclib-missing02';

        cache.set(key, makeFailedResult());
        const hit = cache.get(key);
        if (!hit) fetchFn(); // only called on a miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit?.ok).toBe(false);
    });

    // -------------------------------------------------------------------------
    it('preserves properties (ok:false, prefetchState, nativeStatus, data:undefined) through the cache round-trip', () => {
        const key = 'spotify:track:failed-lrclib-missing03';
        cache.set(key, makeFailedResult());

        const hit = cache.get(key);
        expect(hit?.ok).toBe(false);
        expect(hit?.prefetchState).toBe('MISSING');
        expect(hit?.nativeStatus).toBe('MISSING');
        expect(hit?.data).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('distinguishes a MISSING+failed entry from a MISSING+synced LRCLIB entry', () => {
        const failedKey = 'spotify:track:failed-lrclib-track';
        const syncedKey = 'spotify:track:synced-lrclib-track';

        cache.set(failedKey, makeFailedResult());
        cache.set(syncedKey, makeMissingToSyncedResult());

        expect(cache.get(failedKey)?.ok).toBe(false);
        expect(cache.get(syncedKey)?.ok).toBe(true);
        expect(cache.get(syncedKey)?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('distinguishes a MISSING+failed entry from a MISSING+unsynced LRCLIB entry', () => {
        const failedKey   = 'spotify:track:failed-lrclib-track-2';
        const unsyncedKey = 'spotify:track:unsynced-lrclib-track-2';

        cache.set(failedKey,   makeFailedResult());
        cache.set(unsyncedKey, makeMissingToUnsyncedResult());

        expect(cache.get(failedKey)?.ok).toBe(false);
        expect(cache.get(unsyncedKey)?.ok).toBe(true);
        expect(cache.get(unsyncedKey)?.data?.isSynced).toBe(false);
    });

    // -------------------------------------------------------------------------
    it('keeps a MISSING+failed entry and a successful entry independent in the cache', () => {
        const failedKey = 'spotify:track:failed-lrclib-track-coexist';
        const savedKey  = 'spotify:track:synced-lrclib-track-coexist';

        cache.set(failedKey, makeFailedResult());
        cache.set(savedKey,  makeMissingToSyncedResult());

        expect(cache.get(failedKey)?.ok).toBe(false);
        expect(cache.get(failedKey)?.data).toBeUndefined();

        expect(cache.get(savedKey)?.ok).toBe(true);
        expect(cache.get(savedKey)?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('generates consistent cache keys for minor title/artist variations', () => {
        const base   = cache.getCacheKey('Take Me to the River', 'Talking Heads');
        const upper  = cache.getCacheKey('TAKE ME TO THE RIVER', 'TALKING HEADS');
        const remix  = cache.getCacheKey('Take Me to the River (Live)', 'Talking Heads');
        const puncts = cache.getCacheKey('Take Me to the River!', 'Talking Heads...');

        expect(upper).toBe(base);
        expect(remix).toBe(base);
        expect(puncts).toBe(base);
    });

    // -------------------------------------------------------------------------
    it('prefers the Spotify URI key over the title|artist fallback key', () => {
        const uri      = 'spotify:track:uniqueurifailed-lrclib';
        const titleKey = cache.getCacheKey('Take Me to the River', 'Talking Heads');
        const uriKey   = cache.getCacheKey('Take Me to the River', 'Talking Heads', uri);

        expect(uriKey).toBe(uri);
        expect(uriKey).not.toBe(titleKey);

        cache.set(uriKey, makeFailedResult());
        expect(cache.get(uriKey)).not.toBeUndefined();
        expect(cache.get(titleKey)).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('evicts the least-recently-used entry when the cache exceeds its limit', () => {
        vi.useFakeTimers();
        let tick = 9500;

        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(tick);
            cache.set(`spotify:track:song${i}`, makeFailedResult());
            tick += 100;
        }
        // song1 → t=9500, song2 → t=9600, …, song5 → t=9900

        // Touch song1 so song2 becomes the LRU.
        vi.setSystemTime(tick);
        cache.get('spotify:track:song1');
        tick += 100;

        // song6 triggers eviction of song2 (lowest lastAccessed).
        vi.setSystemTime(tick);
        cache.set('spotify:track:song6', makeFailedResult());

        vi.useRealTimers();

        expect(cache.has('spotify:track:song2')).toBe(false); // evicted
        expect(cache.has('spotify:track:song1')).toBe(true);  // touched, survives
        expect(cache.has('spotify:track:song6')).toBe(true);  // just inserted
    });

    // -------------------------------------------------------------------------
    it('tracks an in-flight promise and removes it once the fetch resolves', async () => {
        const key = 'spotify:track:inflight-failed-lrclib';
        let resolveFetch!: (v: FetchedLyricsResult) => void;
        const promise = new Promise<FetchedLyricsResult>(res => { resolveFetch = res; });

        cache.setInFlight(key, promise);
        expect(cache.getInFlight(key)).toBe(promise);

        resolveFetch(makeFailedResult());
        await promise;
        expect(cache.getInFlight(key)).toBeUndefined();
    });
});
