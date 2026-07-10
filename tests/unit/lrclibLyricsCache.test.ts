import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LyricsCache } from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

// ---------------------------------------------------------------------------
// Caching De-Romanized Original Lyrics Fetched from LRCLIB
// ---------------------------------------------------------------------------
// Covers: lib/lyricsProviders/lyricsCache.ts → LyricsCache
//
// LRCLIB is Layer 2 Source 2 in the engine priority chain
// (after YTM synced, before plain YTM / plain LRCLIB).  When Spotify serves
// romanized fallback lyrics and both the MXM interceptor and YTM synced path
// fail to produce native-script output, LRCLIB is consulted.  Its result —
// whether synced (LRC) or plain — lands in a LyricsCache instance that acts
// as the shared background-script cache for all providers.
//
// This suite verifies that LRCLIB results are correctly stored, retrieved,
// and managed in that shared cache, exercising:
//   1. A LRCLIB fetch result is stored and returned from the in-memory cache.
//   2. A cache hit is served without re-fetching (no network call).
//   3. Synced (LRC) and plain-text LRCLIB variants are each cached correctly.
//   4. LRCLIB results are distinguished from YTM results via the source field.
//   5. Cache keys normalise title/artist consistently regardless of source.
//   6. Spotify URI keys take priority over title|artist fallback keys.
//   7. LRU eviction drops the least-recently-used entry when capacity is full.
//   8. An in-flight promise is stored and auto-removed once it resolves.
// ---------------------------------------------------------------------------

// Lightweight factory for a realistic LRCLIB FetchedLyricsResult.
// Defaults to a synced Tamil entry; callers can override any field.
function makeLrclibResult(override: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult {
    return {
        ok: true,
        data: {
            syncedLyrics: '[00:03.00]நான் உன்னை நேசிக்கிறேன்\n[00:07.50]என் இதயம் உன்னுடையது',
            isSynced: true,
            source: 'LRCLIB',
        },
        persistedAt: Date.now(),
        lastCheckedAt: Date.now(),
        nativeStatus: 'NATIVE_OK',
        ...override,
    };
}

describe('Caching De-Romanized Original Lyrics from LRCLIB', () => {
    let cache: LyricsCache;

    beforeEach(() => {
        cache = new LyricsCache(5); // Small limit so LRU eviction is easy to trigger
    });

    // -------------------------------------------------------------------------
    it('stores a LRCLIB result and returns it on the next lookup', () => {
        const key = 'spotify:track:tamillrclib01';
        const result = makeLrclibResult();

        cache.set(key, result);
        const hit = cache.get(key);

        expect(hit).not.toBeUndefined();
        expect(hit?.ok).toBe(true);
        expect(hit?.data?.source).toBe('LRCLIB');
        expect(hit?.data?.isSynced).toBe(true);
        expect(hit?.data?.syncedLyrics).toContain('நான்');
    });

    // -------------------------------------------------------------------------
    it('returns undefined for a key that has never been cached', () => {
        expect(cache.get('spotify:track:notcached')).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('serves the cached LRCLIB result without requiring a network fetch', () => {
        const fetchFn = vi.fn().mockResolvedValue(makeLrclibResult());

        const key = 'spotify:track:tamillrclib01';
        cache.set(key, makeLrclibResult());

        const hit = cache.get(key);
        if (!hit) fetchFn(); // only called on a cache miss

        expect(fetchFn).not.toHaveBeenCalled();
        expect(hit).not.toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('caches synced (LRC-format) native lyrics from LRCLIB and returns them intact', () => {
        const key = 'spotify:track:koreanlrclib02';
        const syncedResult = makeLrclibResult({
            data: {
                syncedLyrics: '[00:02.50]사랑해\n[00:06.00]보고싶어',
                isSynced: true,
                source: 'LRCLIB',
            },
        });

        cache.set(key, syncedResult);
        const hit = cache.get(key);

        expect(hit?.data?.syncedLyrics).toContain('[00:02.50]사랑해');
        expect(hit?.data?.isSynced).toBe(true);
    });

    // -------------------------------------------------------------------------
    it('caches plain-text native lyrics from LRCLIB (engine plain-fallback path)', () => {
        const key = 'spotify:track:hindilrclib03';
        const plainResult = makeLrclibResult({
            data: {
                plainLyrics: 'तुम्हारे बिना\nमेरा दिल रोता है',
                isSynced: false,
                source: 'LRCLIB',
            },
        });

        cache.set(key, plainResult);
        const hit = cache.get(key);

        expect(hit?.data?.plainLyrics).toContain('तुम्हारे बिना');
        expect(hit?.data?.isSynced).toBe(false);
        expect(hit?.data?.syncedLyrics).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('distinguishes LRCLIB results from YTM results via the source field', () => {
        const lrclibKey = 'spotify:track:lrclib04';
        const ytmKey    = 'spotify:track:ytm04';

        cache.set(lrclibKey, makeLrclibResult({ data: { syncedLyrics: '[00:01.00]안녕', isSynced: true, source: 'LRCLIB' } }));
        cache.set(ytmKey,    makeLrclibResult({ data: { syncedLyrics: '[00:01.00]안녕', isSynced: true, source: 'YouTube Music' } }));

        expect(cache.get(lrclibKey)?.data?.source).toBe('LRCLIB');
        expect(cache.get(ytmKey)?.data?.source).toBe('YouTube Music');
    });

    // -------------------------------------------------------------------------
    it('generates consistent cache keys for minor title/artist variations', () => {
        const base   = cache.getCacheKey('Nee Partha Vizhigal', 'Sid Sriram');
        const upper  = cache.getCacheKey('NEE PARTHA VIZHIGAL', 'SID SRIRAM');
        const remix  = cache.getCacheKey('Nee Partha Vizhigal (Official Version)', 'Sid Sriram');
        const puncts = cache.getCacheKey('Nee Partha Vizhigal!', 'Sid Sriram...');

        expect(upper).toBe(base);
        expect(remix).toBe(base);
        expect(puncts).toBe(base);
    });

    // -------------------------------------------------------------------------
    it('prefers the Spotify URI key over the title|artist key', () => {
        const uri      = 'spotify:track:uniqueuri888';
        const titleKey = cache.getCacheKey('Nee Partha Vizhigal', 'Sid Sriram');
        const uriKey   = cache.getCacheKey('Nee Partha Vizhigal', 'Sid Sriram', uri);

        expect(uriKey).toBe(uri);
        expect(uriKey).not.toBe(titleKey);

        cache.set(uriKey, makeLrclibResult());
        expect(cache.get(uriKey)).not.toBeUndefined();
        expect(cache.get(titleKey)).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('evicts the least-recently-used entry when the cache exceeds its limit', () => {
        // Use fake timers so every set() lands on a distinct millisecond,
        // making the LRU (lowest lastAccessed) deterministic.
        vi.useFakeTimers();
        let tick = 2000;

        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(tick);
            cache.set(`spotify:track:song${i}`, makeLrclibResult());
            tick += 100;
        }
        // song1 → t=2000, song2 → t=2100, …, song5 → t=2400

        // Touch song1 to refresh its lastAccessed — song2 becomes the LRU.
        vi.setSystemTime(tick);
        cache.get('spotify:track:song1');
        tick += 100;

        // Inserting song6 triggers eviction of song2 (lowest lastAccessed).
        vi.setSystemTime(tick);
        cache.set('spotify:track:song6', makeLrclibResult());

        vi.useRealTimers();

        expect(cache.has('spotify:track:song2')).toBe(false); // evicted (oldest)
        expect(cache.has('spotify:track:song1')).toBe(true);  // touched, survives
        expect(cache.has('spotify:track:song6')).toBe(true);  // just inserted
    });

    // -------------------------------------------------------------------------
    it('reflects the nativeStatus flag carried by the LRCLIB result', () => {
        const key = 'spotify:track:nativelrclib';
        cache.set(key, makeLrclibResult({ nativeStatus: 'NATIVE_OK' }));

        expect(cache.get(key)?.nativeStatus).toBe('NATIVE_OK');
    });

    // -------------------------------------------------------------------------
    it('tracks an in-flight promise and removes it once the fetch resolves', async () => {
        const key = 'spotify:track:inflightlrclib';
        let resolveFetch!: (v: FetchedLyricsResult) => void;
        const promise = new Promise<FetchedLyricsResult>(res => { resolveFetch = res; });

        cache.setInFlight(key, promise);
        expect(cache.getInFlight(key)).toBe(promise);

        resolveFetch(makeLrclibResult());
        await promise;
        // After resolution the inFlight slot is automatically cleaned up.
        expect(cache.getInFlight(key)).toBeUndefined();
    });
});
