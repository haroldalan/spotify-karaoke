import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

// ---------------------------------------------------------------------------
// Caching Unsynced Original Lyrics Fetched from YTM for a Song with Missing Lyrics
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
// YouTube Music is tried: if it finds unsynced (plain text) lyrics, the result
// is stored in LyricsCache with:
//
//   nativeStatus : 'MISSING'       ← Spotify's original state (no lyrics)
//   prefetchState: 'UNSYNCED'      ← upgraded by YTM (from MISSING to UNSYNCED)
//   data.isSynced: false           ← YTM only provided plain lyrics
//   data.source  : 'YouTube Music'
//
// Scenarios tested:
//   1.  A YTM unsynced result is stored for a MISSING-tagged track.
//   2.  Cache hit is served without a re-fetch.
//   3.  The isSynced:false flag is preserved through the cache round-trip.
//   4.  prefetchState 'UNSYNCED' records the upgrade from Spotify's MISSING.
//   5.  nativeStatus 'MISSING' is preserved alongside the unsynced lyrics.
//   6.  source field is 'YouTube Music', not 'LRCLIB'.
//   7.  A failed result (ok:false, no data) is cached to block re-fetch loops.
//   8.  A cached failure is distinguishable from a MISSING+unsynced entry.
//   9.  A MISSING+unsynced entry and a MISSING+synced entry for different tracks
//       coexist without interfering.
//  10.  Cache key normalisation is consistent.
//  11.  Spotify URI keys take priority over title|artist fallback keys.
//  12.  LRU eviction drops the least-recently-used entry at capacity.
//  13.  In-flight deduplication: promise is stored and removed on resolution.
// ---------------------------------------------------------------------------

/** YTM successfully found unsynced (plain) lyrics for a track Spotify reported as MISSING. */
function makeMissingToUnsyncedResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            plainLyrics: 'Take me to the river\nDrop me in the water',
            isSynced: false,
            source: 'YouTube Music',
        },
        prefetchState: 'UNSYNCED',
        nativeStatus: 'MISSING',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

/** YTM successfully found synced (LRC) lyrics for a track Spotify reported as MISSING. */
function makeMissingToSyncedResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            syncedLyrics: '[00:04.00]Take me to the river\n[00:08.50]Drop me in the water',
            isSynced: true,
            source: 'YouTube Music',
        },
        prefetchState: 'SYNCED',
        nativeStatus: 'MISSING',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

/** YTM (and all other sources) found nothing → engine returns { ok:false }. */
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

describe('Caching Unsynced Original Lyrics from YTM for a Song with Missing Lyrics', () => {
    let cache: LyricsCache;

    beforeEach(() => {
        cache = new LyricsCache(5);
    });

    // -------------------------------------------------------------------------
    it('stores a YTM unsynced result for a track Spotify reported as MISSING', () => {
        const key = 'spotify:track:missing-unsynced-ytm01';
        cache.set(key, makeMissingToUnsyncedResult());
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(true);
        expect(hit?.data?.source).toBe('YouTube Music');
        expect(hit?.data?.isSynced).toBe(false);
        expect(hit?.data?.plainLyrics).toContain('Take me to the river');
    });

    // -------------------------------------------------------------------------
    it('serves the cached YTM unsynced result without re-fetching', () => {
        const fetchFn = vi.fn().mockResolvedValue(makeMissingToUnsyncedResult());
        const key = 'spotify:track:missing-unsynced-ytm02';

        cache.set(key, makeMissingToUnsyncedResult());
        const hit = cache.get(key);
        if (!hit) fetchFn(); // only called on a miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit?.data?.isSynced).toBe(false);
    });

    // -------------------------------------------------------------------------
    it('preserves the isSynced:false flag through the cache round-trip', () => {
        const key = 'spotify:track:missing-unsynced-ytm03';
        cache.set(key, makeMissingToUnsyncedResult());

        const hit = cache.get(key);
        expect(hit?.data?.isSynced).toBe(false);
        expect(hit?.data?.plainLyrics).toBeDefined();
        expect(hit?.data?.syncedLyrics).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('preserves the prefetchState UNSYNCED field recording the upgrade from MISSING', () => {
        const key = 'spotify:track:missing-unsynced-ytm04';
        cache.set(key, makeMissingToUnsyncedResult({ prefetchState: 'UNSYNCED' }));

        expect(cache.get(key)?.prefetchState).toBe('UNSYNCED');
    });

    // -------------------------------------------------------------------------
    it('preserves the nativeStatus MISSING marker alongside the YTM unsynced lyrics', () => {
        const key = 'spotify:track:missing-unsynced-ytm05';
        cache.set(key, makeMissingToUnsyncedResult());
        const hit = cache.get(key);

        // nativeStatus reflects Spotify's original state (no lyrics);
        // isSynced reflects what YTM provided.
        expect(hit?.nativeStatus).toBe('MISSING');
        expect(hit?.data?.isSynced).toBe(false);
    });

    // -------------------------------------------------------------------------
    it('identifies the source as YouTube Music, not LRCLIB', () => {
        const key = 'spotify:track:missing-unsynced-ytm06';
        cache.set(key, makeMissingToUnsyncedResult());

        expect(cache.get(key)?.data?.source).toBe('YouTube Music');
        expect(cache.get(key)?.data?.source).not.toBe('LRCLIB');
    });

    // -------------------------------------------------------------------------
    it('caches a failed result (ok:false) when YTM finds nothing', () => {
        const key = 'spotify:track:missing-unsynced-ytm07';
        cache.set(key, makeFailedResult());
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(false);
        expect(hit?.data).toBeUndefined();
        expect(hit?.nativeStatus).toBe('MISSING');
        expect(hit?.prefetchState).toBe('MISSING');
    });

    // -------------------------------------------------------------------------
    it('distinguishes a MISSING+unsynced entry from a MISSING+failed entry', () => {
        const unsyncedKey = 'spotify:track:missing-unsynced-track';
        const failedKey   = 'spotify:track:missing-failed-track';

        cache.set(unsyncedKey, makeMissingToUnsyncedResult());
        cache.set(failedKey,   makeFailedResult());

        const unsyncedHit = cache.get(unsyncedKey);
        const failedHit   = cache.get(failedKey);

        expect(unsyncedHit?.ok).toBe(true);
        expect(unsyncedHit?.data?.isSynced).toBe(false);
        expect(unsyncedHit?.nativeStatus).toBe('MISSING');

        expect(failedHit?.ok).toBe(false);
        expect(failedHit?.data).toBeUndefined();
        expect(failedHit?.nativeStatus).toBe('MISSING');
    });

    // -------------------------------------------------------------------------
    it('keeps a MISSING+unsynced entry and a MISSING+synced entry independent', () => {
        const unsyncedKey = 'spotify:track:missing-unsynced-track-ab';
        const syncedKey   = 'spotify:track:missing-synced-track-ab';

        cache.set(unsyncedKey, makeMissingToUnsyncedResult());
        cache.set(syncedKey,   makeMissingToSyncedResult());

        expect(cache.get(unsyncedKey)?.data?.isSynced).toBe(false);
        expect(cache.get(syncedKey)?.data?.isSynced).toBe(true);
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
        const uri      = 'spotify:track:uniqueuri888';
        const titleKey = cache.getCacheKey('Take Me to the River', 'Talking Heads');
        const uriKey   = cache.getCacheKey('Take Me to the River', 'Talking Heads', uri);

        expect(uriKey).toBe(uri);
        expect(uriKey).not.toBe(titleKey);

        cache.set(uriKey, makeMissingToUnsyncedResult());
        expect(cache.get(uriKey)).not.toBeUndefined();
        expect(cache.get(titleKey)).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('evicts the least-recently-used entry when the cache exceeds its limit', () => {
        vi.useFakeTimers();
        let tick = 7000;

        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(tick);
            cache.set(`spotify:track:song${i}`, makeMissingToUnsyncedResult());
            tick += 100;
        }
        // song1 → t=7000, song2 → t=7100, …, song5 → t=7400

        // Touch song1 so song2 becomes the LRU.
        vi.setSystemTime(tick);
        cache.get('spotify:track:song1');
        tick += 100;

        // song6 triggers eviction of song2 (lowest lastAccessed).
        vi.setSystemTime(tick);
        cache.set('spotify:track:song6', makeMissingToUnsyncedResult());

        vi.useRealTimers();

        expect(cache.has('spotify:track:song2')).toBe(false); // evicted
        expect(cache.has('spotify:track:song1')).toBe(true);  // touched, survives
        expect(cache.has('spotify:track:song6')).toBe(true);  // just inserted
    });

    // -------------------------------------------------------------------------
    it('tracks an in-flight promise and removes it once the fetch resolves', async () => {
        const key = 'spotify:track:inflight-missing-unsynced-ytm';
        let resolveFetch!: (v: FetchedLyricsResult) => void;
        const promise = new Promise<FetchedLyricsResult>(res => { resolveFetch = res; });

        cache.setInFlight(key, promise);
        expect(cache.getInFlight(key)).toBe(promise);

        resolveFetch(makeMissingToUnsyncedResult());
        await promise;
        expect(cache.getInFlight(key)).toBeUndefined();
    });
});
