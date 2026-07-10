import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

// ---------------------------------------------------------------------------
// Caching Synced Original Lyrics Fetched from LRCLIB for a Song with Unsynced Lyrics
// ---------------------------------------------------------------------------
// Covers: lib/lyricsProviders/lyricsCache.ts → LyricsCache
//
// Engine priority:  Synced YTM  →  Synced LRCLIB  →  Plain YTM  →  Plain LRCLIB
//
// This path is reached when:
//   • Spotify's own lyrics for the track are UNSYNCED (plain text, no timestamps).
//   • The fetch interceptor posts SLY_PREFETCH_REPORT with state:'UNSYNCED'.
//   • LyricsEngine tries YTM first — YTM either fails or returns plain lyrics only.
//   • LRCLIB is consulted next; it finds a synced (LRC-timestamped) version.
//
// The result is stored in the shared LyricsCache (background-script in-memory
// cache) with:
//   nativeStatus : 'UNSYNCED'    ← Spotify's original state
//   prefetchState: 'SYNCED'      ← upgraded by LRCLIB
//   data.isSynced: true          ← LRCLIB provided timestamps
//   data.source  : 'LRCLIB'      ← identifying the winning provider
//
// This suite is distinct from the YTM unsynced-upgrade suite in two ways:
//   1. source is 'LRCLIB' rather than 'YouTube Music'.
//   2. LRCLIB only contributes when YTM synced is absent — the test documents
//      the coexistence of a plain-YTM entry and a synced-LRCLIB entry for
//      *different* tracks, confirming they share the cache independently.
//
// Scenarios tested:
//   1.  A LRCLIB synced result is stored for an UNSYNCED-tagged track.
//   2.  Cache hit is served without a re-fetch.
//   3.  The isSynced:true flag is preserved through the cache round-trip.
//   4.  prefetchState 'SYNCED' records the upgrade from Spotify's UNSYNCED.
//   5.  nativeStatus 'UNSYNCED' is preserved alongside the synced lyrics.
//   6.  source field is 'LRCLIB', not 'YouTube Music'.
//   7.  A plain-LRCLIB fallback (isSynced:false) is cached and served correctly.
//   8.  A plain-YTM entry and a synced-LRCLIB entry coexist for different tracks.
//   9.  Cache key normalisation is consistent regardless of source.
//  10.  Spotify URI keys take priority over title|artist fallback keys.
//  11.  LRU eviction drops the least-recently-used entry at capacity.
//  12.  In-flight deduplication: promise is stored and removed on resolution.
// ---------------------------------------------------------------------------

/** Factory for a LRCLIB-synced result for a track Spotify marked UNSYNCED. */
function makeLrclibSyncedResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            syncedLyrics: '[00:04.00]Take me to the river\n[00:08.50]Drop me in the water',
            isSynced: true,
            source: 'LRCLIB',
        },
        prefetchState: 'SYNCED',
        nativeStatus: 'UNSYNCED',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

/** Factory for a plain-LRCLIB fallback when no synced version was found. */
function makeLrclibPlainResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            plainLyrics: 'Take me to the river\nDrop me in the water',
            isSynced: false,
            source: 'LRCLIB',
        },
        prefetchState: 'UNSYNCED',
        nativeStatus: 'UNSYNCED',
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        ...override,
    };
}

/** Factory for a plain-YTM entry (the sibling that lost the race to LRCLIB synced). */
function makeYtmPlainResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            plainLyrics: 'Take me to the river\nDrop me in the water',
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

describe('Caching Synced Original Lyrics from LRCLIB for a Song with Unsynced Lyrics', () => {
    let cache: LyricsCache;

    beforeEach(() => {
        cache = new LyricsCache(5);
    });

    // -------------------------------------------------------------------------
    it('stores a LRCLIB synced result for a track Spotify marked as UNSYNCED', () => {
        const key = 'spotify:track:lrclib-unsynced01';
        cache.set(key, makeLrclibSyncedResult());
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(true);
        expect(hit?.data?.source).toBe('LRCLIB');
        expect(hit?.data?.isSynced).toBe(true);
        expect(hit?.data?.syncedLyrics).toContain('[00:04.00]Take me to the river');
    });

    // -------------------------------------------------------------------------
    it('serves the cached LRCLIB synced result without re-fetching', () => {
        const fetchFn = vi.fn().mockResolvedValue(makeLrclibSyncedResult());
        const key = 'spotify:track:lrclib-unsynced02';

        cache.set(key, makeLrclibSyncedResult());
        const hit = cache.get(key);
        if (!hit) fetchFn(); // only called on a miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('preserves the isSynced:true flag through the cache round-trip', () => {
        const key = 'spotify:track:lrclib-unsynced03';
        cache.set(key, makeLrclibSyncedResult());

        expect(cache.get(key)?.data?.isSynced).toBe(true);
        expect(cache.get(key)?.data?.syncedLyrics).toBeDefined();
        expect(cache.get(key)?.data?.plainLyrics).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('preserves the prefetchState SYNCED field that records the upgrade from UNSYNCED', () => {
        const key = 'spotify:track:lrclib-unsynced04';
        cache.set(key, makeLrclibSyncedResult({ prefetchState: 'SYNCED' }));

        expect(cache.get(key)?.prefetchState).toBe('SYNCED');
    });

    // -------------------------------------------------------------------------
    it('preserves the nativeStatus UNSYNCED marker alongside the LRCLIB synced lyrics', () => {
        const key = 'spotify:track:lrclib-unsynced05';
        cache.set(key, makeLrclibSyncedResult());
        const hit = cache.get(key);

        // nativeStatus reflects Spotify's original state; isSynced reflects LRCLIB's contribution.
        expect(hit?.nativeStatus).toBe('UNSYNCED');
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('identifies the source as LRCLIB, not YouTube Music', () => {
        const key = 'spotify:track:lrclib-unsynced06';
        cache.set(key, makeLrclibSyncedResult());

        expect(cache.get(key)?.data?.source).toBe('LRCLIB');
        expect(cache.get(key)?.data?.source).not.toBe('YouTube Music');
    });

    // -------------------------------------------------------------------------
    it('caches a plain-LRCLIB result when no synced version was found', () => {
        const key = 'spotify:track:lrclib-plain07';
        cache.set(key, makeLrclibPlainResult());
        const hit = cache.get(key);

        expect(hit?.data?.isSynced).toBe(false);
        expect(hit?.data?.plainLyrics).toContain('Take me to the river');
        expect(hit?.data?.syncedLyrics).toBeUndefined();
        expect(hit?.prefetchState).toBe('UNSYNCED');
        expect(hit?.data?.source).toBe('LRCLIB');
    });

    // -------------------------------------------------------------------------
    it('keeps a plain-YTM entry and a synced-LRCLIB entry independent in the cache', () => {
        // Scenario: track A got only plain lyrics from YTM; track B got synced from LRCLIB.
        const ytmPlainKey    = 'spotify:track:ytm-plain-track';
        const lrclibSyncKey  = 'spotify:track:lrclib-sync-track';

        cache.set(ytmPlainKey,   makeYtmPlainResult());
        cache.set(lrclibSyncKey, makeLrclibSyncedResult());

        expect(cache.get(ytmPlainKey)?.data?.isSynced).toBe(false);
        expect(cache.get(ytmPlainKey)?.data?.source).toBe('YouTube Music');

        expect(cache.get(lrclibSyncKey)?.data?.isSynced).toBe(true);
        expect(cache.get(lrclibSyncKey)?.data?.source).toBe('LRCLIB');
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
        const uri      = 'spotify:track:uniqueuri555';
        const titleKey = cache.getCacheKey('Take Me to the River', 'Talking Heads');
        const uriKey   = cache.getCacheKey('Take Me to the River', 'Talking Heads', uri);

        expect(uriKey).toBe(uri);
        expect(uriKey).not.toBe(titleKey);

        cache.set(uriKey, makeLrclibSyncedResult());
        expect(cache.get(uriKey)).not.toBeUndefined();
        expect(cache.get(titleKey)).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('evicts the least-recently-used entry when the cache exceeds its limit', () => {
        vi.useFakeTimers();
        let tick = 4000;

        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(tick);
            cache.set(`spotify:track:song${i}`, makeLrclibSyncedResult());
            tick += 100;
        }
        // song1 → t=4000, song2 → t=4100, …, song5 → t=4400

        // Touch song1 so song2 becomes the LRU.
        vi.setSystemTime(tick);
        cache.get('spotify:track:song1');
        tick += 100;

        // song6 triggers eviction of song2 (lowest lastAccessed).
        vi.setSystemTime(tick);
        cache.set('spotify:track:song6', makeLrclibSyncedResult());

        vi.useRealTimers();

        expect(cache.has('spotify:track:song2')).toBe(false); // evicted
        expect(cache.has('spotify:track:song1')).toBe(true);  // touched, survives
        expect(cache.has('spotify:track:song6')).toBe(true);  // just inserted
    });

    // -------------------------------------------------------------------------
    it('tracks an in-flight promise and removes it once the fetch resolves', async () => {
        const key = 'spotify:track:inflight-lrclib';
        let resolveFetch!: (v: FetchedLyricsResult) => void;
        const promise = new Promise<FetchedLyricsResult>(res => { resolveFetch = res; });

        cache.setInFlight(key, promise);
        expect(cache.getInFlight(key)).toBe(promise);

        resolveFetch(makeLrclibSyncedResult());
        await promise;
        expect(cache.getInFlight(key)).toBeUndefined();
    });
});
