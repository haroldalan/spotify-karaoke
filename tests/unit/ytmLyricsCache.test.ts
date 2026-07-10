import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

// ---------------------------------------------------------------------------
// Caching De-Romanized Original Lyrics Fetched from YouTube Music (YTM)
// ---------------------------------------------------------------------------
// Covers: lib/lyricsProviders/lyricsCache.ts → LyricsCache
//
// When Spotify's romanized fallback lyrics are insufficient and the MXM
// upgrade path returns nothing, the extension falls back to YouTube Music
// (Layer 2 in the engine priority chain).  YTM returns the native-script
// lyrics (e.g. Tamil, Hindi, Korean) in either synced-LRC or plain format.
//
// Those lyrics land in a LyricsCache instance that sits between the network
// and every downstream consumer.  This suite verifies:
//   1. A YTM fetch result is stored in and retrieved from the in-memory cache.
//   2. A cache hit is served without re-fetching (no network call).
//   3. Synced (LRC) and plain-text variants are cached independently.
//   4. Cache keys are normalised so minor title/artist variations hit the
//      same entry (parenthetical stripping, case folding, punctuation).
//   5. Spotify URI keys take priority over title|artist keys.
//   6. The LRU eviction policy drops the least-recently-used entry when the
//      cache reaches capacity.
// ---------------------------------------------------------------------------

// Lightweight factory to build a realistic YTM FetchedLyricsResult for a
// native-script song without touching any real I/O.
function makeYtmResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            syncedLyrics: '[00:01.00]நான் உன்னை நேசிக்கிறேன்\n[00:05.00]என் இதயம் உன்னுடையது',
            isSynced: true,
            source: 'YouTube Music',
        },
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        nativeStatus: 'NATIVE_OK',
        ...override,
    };
}

describe('Caching De-Romanized Original Lyrics from YTM', () => {
    let cache: LyricsCache;

    beforeEach(() => {
        cache = new LyricsCache(5); // Small limit so LRU eviction is easy to trigger
    });

    // -------------------------------------------------------------------------
    it('stores a YTM result and returns it on the next lookup', () => {
        const key = 'spotify:track:tamillove123';
        const result = makeYtmResult();

        cache.set(key, result);
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(true);
        expect(hit?.data?.source).toBe('YouTube Music');
        expect(hit?.data?.isSynced).toBe(true);
        expect(hit?.data?.syncedLyrics).toContain('நான்');
    });

    // -------------------------------------------------------------------------
    it('returns undefined for a key that has never been cached', () => {
        expect(cache.get('spotify:track:notcached')).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('serves the cached result without requiring a network fetch', () => {
        // Simulate the fetch function that would hit the YTM API
        const fetchFn = vi.fn().mockResolvedValue(makeYtmResult());

        const key = 'spotify:track:tamillove123';
        cache.set(key, makeYtmResult());

        // Consumer checks cache before fetching
        const hit = cache.get(key);
        if (!hit) fetchFn(); // would only be called on a miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit).not.toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('caches synced (LRC-format) native lyrics and returns them intact', () => {
        const key = 'spotify:track:koreansong456';
        const syncedResult = makeYtmResult({
            data: {
                syncedLyrics: '[00:02.00]사랑해\n[00:06.00]보고싶어',
                isSynced: true,
                source: 'YouTube Music',
            },
        });

        cache.set(key, syncedResult);
        const hit = cache.get(key);

        expect(hit?.data?.syncedLyrics).toContain('[00:02.00]사랑해');
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('caches plain-text native lyrics (YTM fallback) and returns them intact', () => {
        const key = 'spotify:track:hindisong789';
        const plainResult = makeYtmResult({
            data: {
                plainLyrics: 'तुम्हारे बिना\nमेरा दिल रोता है',
                isSynced: false,
                source: 'YouTube Music',
            },
        });

        cache.set(key, plainResult);
        const hit = cache.get(key);

        expect(hit?.data?.plainLyrics).toContain('तुम्हारे बिना');
        expect(hit?.data?.isSynced).toBe(false);
        expect(hit?.data?.syncedLyrics).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('generates consistent cache keys for minor title/artist variations', () => {
        // The getCacheKey normaliser strips parentheticals, folds case, and removes punctuation.
        // These three variants should all produce the same key and therefore the same cache hit.
        const base    = cache.getCacheKey('Ennai Konjam', 'Sid Sriram');
        const upper   = cache.getCacheKey('ENNAI KONJAM', 'SID SRIRAM');
        const remix   = cache.getCacheKey('Ennai Konjam (Tamil Version)', 'Sid Sriram');
        const puncts  = cache.getCacheKey('Ennai Konjam!', 'Sid Sriram...');

        expect(upper).toBe(base);
        expect(remix).toBe(base);
        expect(puncts).toBe(base);
    });

    // -------------------------------------------------------------------------
    it('prefers the Spotify URI key over the title|artist key', () => {
        const uri       = 'spotify:track:uniqueuri999';
        const titleKey  = cache.getCacheKey('Ennai Konjam', 'Sid Sriram');
        const uriKey    = cache.getCacheKey('Ennai Konjam', 'Sid Sriram', uri);

        // URI-keyed entry should be distinct from the title|artist entry
        expect(uriKey).toBe(uri);
        expect(uriKey).not.toBe(titleKey);

        // Only the URI entry is stored
        cache.set(uriKey, makeYtmResult());
        expect(cache.get(uriKey)).not.toBeUndefined();
        expect(cache.get(titleKey)).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('evicts the least-recently-used entry when the cache exceeds its limit', () => {
        // The eviction policy picks the entry with the smallest `lastAccessed`
        // timestamp.  We use fake timers so each set() call gets a unique,
        // deterministic millisecond value — otherwise all calls in the same
        // event-loop tick share the same Date.now() and eviction is undefined.
        vi.useFakeTimers();
        let tick = 1000;

        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(tick);
            cache.set(`spotify:track:song${i}`, makeYtmResult());
            tick += 100;
        }
        // song1 → t=1000, song2 → t=1100, …, song5 → t=1400

        // Touch song1 at a later time so it is no longer the oldest entry.
        // After this, song2 (t=1100) becomes the LRU.
        vi.setSystemTime(tick);
        cache.get('spotify:track:song1');
        tick += 100;

        // Inserting song6 pushes the cache over the 5-entry limit.
        // The eviction scan must remove song2 (lowest lastAccessed = t=1100).
        vi.setSystemTime(tick);
        cache.set('spotify:track:song6', makeYtmResult());

        vi.useRealTimers();

        expect(cache.has('spotify:track:song2')).toBe(false); // evicted (oldest)
        expect(cache.has('spotify:track:song1')).toBe(true);  // touched, survives
        expect(cache.has('spotify:track:song6')).toBe(true);  // just inserted
    });

    // -------------------------------------------------------------------------
    it('reflects the nativeStatus flag set by the YTM pipeline', () => {
        const key = 'spotify:track:nativeok';
        cache.set(key, makeYtmResult({ nativeStatus: 'NATIVE_OK' }));

        expect(cache.get(key)?.nativeStatus).toBe('NATIVE_OK');
    });

    // -------------------------------------------------------------------------
    it('tracks an in-flight promise and removes it once the fetch resolves', async () => {
        const key = 'spotify:track:inflight';
        let resolveFetch!: (v: FetchedLyricsResult) => void;
        const promise = new Promise<FetchedLyricsResult>(res => { resolveFetch = res; });

        cache.setInFlight(key, promise);
        expect(cache.getInFlight(key)).toBe(promise);

        resolveFetch(makeYtmResult());
        await promise;
        // After resolution, the inFlight entry is automatically removed.
        expect(cache.getInFlight(key)).toBeUndefined();
    });
});
