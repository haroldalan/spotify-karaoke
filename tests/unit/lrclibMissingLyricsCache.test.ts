import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

// ---------------------------------------------------------------------------
// Caching Synced Original Lyrics Fetched from LRCLIB for a Song with Missing Lyrics
// ---------------------------------------------------------------------------
// Covers: lib/lyricsProviders/lyricsCache.ts → LyricsCache
//
// The MISSING path is distinct from both the UNSYNCED and de-romanized paths:
//
//   UNSYNCED  → Spotify has the song's lyrics but they are plain text only.
//   MISSING   → Spotify has NO lyrics at all (color-lyrics returns 404).
//
// When the interceptor receives a 404 it posts SLY_PREFETCH_REPORT with
// state:'MISSING'. The detector triggers a Layer 2 external fetch.
// LRCLIB is tried in the chain (usually after YTM fails to find synced lyrics).
// If LRCLIB finds synced (LRC-timestamped) lyrics, the result is stored in
// LyricsCache with:
//
//   nativeStatus : 'MISSING'   ← Spotify's original state (no lyrics)
//   prefetchState: 'SYNCED'    ← upgraded by LRCLIB
//   data.isSynced: true
//   data.source  : 'LRCLIB'
//
// When all providers find nothing, the engine returns { ok:false } — a failure
// entry that is also cached to prevent the extension from re-fetching the
// same track on every subsequent visit (important for songs that are
// genuinely lyric-less or geo-restricted).
//
// Scenarios tested:
//   1.  A LRCLIB synced result is stored for a MISSING-tagged track.
//   2.  Cache hit is served without a re-fetch.
//   3.  The isSynced:true flag is preserved through the cache round-trip.
//   4.  prefetchState 'SYNCED' records the upgrade from Spotify's MISSING.
//   5.  nativeStatus 'MISSING' is preserved alongside the synced lyrics.
//   6.  source field is 'LRCLIB', not 'YouTube Music'.
//   7.  A failed result (ok:false, no data) is cached to block re-fetch loops.
//   8.  A cached failure is distinguishable from an unsynced+plain entry.
//   9.  A MISSING-failed entry and a MISSING-synced entry for different tracks
//       coexist without interfering.
//  10.  Cache key normalisation is consistent.
//  11.  Spotify URI keys take priority over title|artist fallback keys.
//  12.  LRU eviction drops the least-recently-used entry at capacity.
//  13.  In-flight deduplication: promise is stored and removed on resolution.
// ---------------------------------------------------------------------------

/** LRCLIB successfully found synced lyrics for a track Spotify reported as MISSING. */
function makeMissingToSyncedResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            syncedLyrics: '[00:02.00]Hello darkness my old friend\n[00:06.00]I\'ve come to talk with you again',
            isSynced: true,
            source: 'LRCLIB',
        },
        prefetchState: 'SYNCED',
        nativeStatus: 'MISSING',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

/** All sources found nothing → engine returns { ok:false }. */
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

/** Unsynced+plain entry (for cross-type distinction tests). */
function makeUnsyncedPlainResult(): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            plainLyrics: 'Some plain lyrics here',
            isSynced: false,
            source: 'LRCLIB',
        },
        prefetchState: 'UNSYNCED',
        nativeStatus: 'UNSYNCED',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
    };
}

describe('Caching Synced Original Lyrics from LRCLIB for a Song with Missing Lyrics', () => {
    let cache: LyricsCache;

    beforeEach(() => {
        cache = new LyricsCache(5);
    });

    // -------------------------------------------------------------------------
    it('stores a LRCLIB synced result for a track Spotify reported as MISSING', () => {
        const key = 'spotify:track:missing-lrclib01';
        cache.set(key, makeMissingToSyncedResult());
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(true);
        expect(hit?.data?.source).toBe('LRCLIB');
        expect(hit?.data?.isSynced).toBe(true);
        expect(hit?.data?.syncedLyrics).toContain('[00:02.00]Hello darkness');
    });

    // -------------------------------------------------------------------------
    it('serves the cached LRCLIB synced result without re-fetching', () => {
        const fetchFn = vi.fn().mockResolvedValue(makeMissingToSyncedResult());
        const key = 'spotify:track:missing-lrclib02';

        cache.set(key, makeMissingToSyncedResult());
        const hit = cache.get(key);
        if (!hit) fetchFn(); // only called on a miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('preserves the isSynced:true flag through the cache round-trip', () => {
        const key = 'spotify:track:missing-lrclib03';
        cache.set(key, makeMissingToSyncedResult());

        expect(cache.get(key)?.data?.isSynced).toBe(true);
        expect(cache.get(key)?.data?.syncedLyrics).toBeDefined();
        expect(cache.get(key)?.data?.plainLyrics).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('preserves the prefetchState SYNCED field recording the upgrade from MISSING', () => {
        const key = 'spotify:track:missing-lrclib04';
        cache.set(key, makeMissingToSyncedResult({ prefetchState: 'SYNCED' }));

        expect(cache.get(key)?.prefetchState).toBe('SYNCED');
    });

    // -------------------------------------------------------------------------
    it('preserves the nativeStatus MISSING marker alongside the LRCLIB synced lyrics', () => {
        const key = 'spotify:track:missing-lrclib05';
        cache.set(key, makeMissingToSyncedResult());
        const hit = cache.get(key);

        // nativeStatus reflects Spotify's original state (no lyrics);
        // isSynced reflects what LRCLIB provided.
        expect(hit?.nativeStatus).toBe('MISSING');
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('identifies the source as LRCLIB, not YouTube Music', () => {
        const key = 'spotify:track:missing-lrclib06';
        cache.set(key, makeMissingToSyncedResult());

        expect(cache.get(key)?.data?.source).toBe('LRCLIB');
        expect(cache.get(key)?.data?.source).not.toBe('YouTube Music');
    });

    // -------------------------------------------------------------------------
    it('caches a failed result (ok:false) when all sources return nothing', () => {
        const key = 'spotify:track:missing-lrclib07';
        cache.set(key, makeFailedResult());
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(false);
        expect(hit?.data).toBeUndefined();
        expect(hit?.nativeStatus).toBe('MISSING');
        expect(hit?.prefetchState).toBe('MISSING');
    });

    // -------------------------------------------------------------------------
    it('serves a cached failure result without re-fetching (blocks re-fetch loops)', () => {
        const fetchFn = vi.fn().mockResolvedValue(makeFailedResult());
        const key = 'spotify:track:missing-lrclib08';

        cache.set(key, makeFailedResult());
        const hit = cache.get(key);
        if (!hit) fetchFn(); // guard — would only be called on a cache miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit?.ok).toBe(false);
    });

    // -------------------------------------------------------------------------
    it('distinguishes a MISSING+failed entry from an UNSYNCED+plain entry', () => {
        const missingKey  = 'spotify:track:missing-lrclib-track';
        const unsyncedKey = 'spotify:track:unsynced-lrclib-track';

        cache.set(missingKey,  makeFailedResult());
        cache.set(unsyncedKey, makeUnsyncedPlainResult());

        const missingHit  = cache.get(missingKey);
        const unsyncedHit = cache.get(unsyncedKey);

        expect(missingHit?.ok).toBe(false);
        expect(missingHit?.nativeStatus).toBe('MISSING');
        expect(missingHit?.data).toBeUndefined();

        expect(unsyncedHit?.ok).toBe(true);
        expect(unsyncedHit?.nativeStatus).toBe('UNSYNCED');
        expect(unsyncedHit?.data?.plainLyrics).toBeDefined();
    });

    // -------------------------------------------------------------------------
    it('keeps a MISSING+failed entry and a MISSING+synced entry independent', () => {
        const failedKey = 'spotify:track:truly-missing-lrclib';
        const savedKey  = 'spotify:track:missing-but-lrclib-found';

        cache.set(failedKey, makeFailedResult());
        cache.set(savedKey,  makeMissingToSyncedResult());

        expect(cache.get(failedKey)?.ok).toBe(false);
        expect(cache.get(failedKey)?.data).toBeUndefined();

        expect(cache.get(savedKey)?.ok).toBe(true);
        expect(cache.get(savedKey)?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('generates consistent cache keys for minor title/artist variations', () => {
        const base   = cache.getCacheKey('The Sound of Silence', 'Simon & Garfunkel');
        const upper  = cache.getCacheKey('THE SOUND OF SILENCE', 'SIMON & GARFUNKEL');
        const remix  = cache.getCacheKey('The Sound of Silence (Remastered)', 'Simon & Garfunkel');
        const puncts = cache.getCacheKey('The Sound of Silence!', 'Simon & Garfunkel...');

        expect(upper).toBe(base);
        expect(remix).toBe(base);
        expect(puncts).toBe(base);
    });

    // -------------------------------------------------------------------------
    it('prefers the Spotify URI key over the title|artist fallback key', () => {
        const uri      = 'spotify:track:uniqueuri777';
        const titleKey = cache.getCacheKey('The Sound of Silence', 'Simon & Garfunkel');
        const uriKey   = cache.getCacheKey('The Sound of Silence', 'Simon & Garfunkel', uri);

        expect(uriKey).toBe(uri);
        expect(uriKey).not.toBe(titleKey);

        cache.set(uriKey, makeMissingToSyncedResult());
        expect(cache.get(uriKey)).not.toBeUndefined();
        expect(cache.get(titleKey)).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('evicts the least-recently-used entry when the cache exceeds its limit', () => {
        vi.useFakeTimers();
        let tick = 6000;

        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(tick);
            cache.set(`spotify:track:song${i}`, makeMissingToSyncedResult());
            tick += 100;
        }
        // song1 → t=6000, song2 → t=6100, …, song5 → t=6400

        // Touch song1 so song2 becomes the LRU.
        vi.setSystemTime(tick);
        cache.get('spotify:track:song1');
        tick += 100;

        // song6 triggers eviction of song2 (lowest lastAccessed).
        vi.setSystemTime(tick);
        cache.set('spotify:track:song6', makeMissingToSyncedResult());

        vi.useRealTimers();

        expect(cache.has('spotify:track:song2')).toBe(false); // evicted
        expect(cache.has('spotify:track:song1')).toBe(true);  // touched, survives
        expect(cache.has('spotify:track:song6')).toBe(true);  // just inserted
    });

    // -------------------------------------------------------------------------
    it('tracks an in-flight promise and removes it once the fetch resolves', async () => {
        const key = 'spotify:track:inflight-missing-lrclib';
        let resolveFetch!: (v: FetchedLyricsResult) => void;
        const promise = new Promise<FetchedLyricsResult>(res => { resolveFetch = res; });

        cache.setInFlight(key, promise);
        expect(cache.getInFlight(key)).toBe(promise);

        resolveFetch(makeMissingToSyncedResult());
        await promise;
        expect(cache.getInFlight(key)).toBeUndefined();
    });
});
