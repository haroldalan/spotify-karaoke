import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProcessed } from '../../lib/core/fetchProcessed';

// ---------------------------------------------------------------------------
// Module-level mocks — must be at top level so Vitest can hoist them correctly.
// fetchProcessed has two side-effect imports we isolate here.
// ---------------------------------------------------------------------------
vi.mock('../../lib/core/lyricsCache', () => ({
    saveSongCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/dom/toast', () => ({
    showToast: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Caching Translated Lyrics
// ---------------------------------------------------------------------------
// Covers: lib/core/fetchProcessed.ts  →  the `.translated` field of ProcessedCache
//
// fetchProcessed is the single entry-point that decides whether processed
// (translated + romanized) lyrics must be fetched from the background script
// or can be served directly from the in-memory processed cache.
//
// This suite exercises only the *translated* slice of that cache.
// ---------------------------------------------------------------------------

describe('Caching Translated Lyrics', () => {
    let sendMessageSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        sendMessageSpy = vi.fn().mockResolvedValue({
            translated: ['Translated Line 1', 'Translated Line 2'],
            romanized: ['Romanized Line 1', 'Romanized Line 2'],
        });
        (global as any).browser.runtime.sendMessage = sendMessageSpy;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    it('fetches translated lyrics from background on first call and stores them in cache', async () => {
        const cache = { original: ['Line 1', 'Line 2'], processed: new Map() };
        const runtimeCache = new Map<string, any>();
        const genRef = { value: 0 };

        const result = await fetchProcessed(
            cache.original,
            'en',
            cache,
            'test-song-key',
            runtimeCache,
            genRef
        );

        // Background was contacted exactly once.
        expect(sendMessageSpy).toHaveBeenCalledTimes(1);
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'PROCESS', targetLang: 'en' })
        );

        // The translated array returned is the one the background provided.
        expect(result?.translated).toEqual(['Translated Line 1', 'Translated Line 2']);

        // The result has been written into the in-memory processed cache.
        expect(cache.processed.has('en')).toBe(true);
        expect(cache.processed.get('en')?.translated).toEqual(['Translated Line 1', 'Translated Line 2']);
    });

    // -------------------------------------------------------------------------
    it('serves translated lyrics from cache on second call without contacting the background', async () => {
        const cache = { original: ['Line 1', 'Line 2'], processed: new Map() };
        const runtimeCache = new Map<string, any>();
        const genRef = { value: 0 };

        // First call — populates the cache.
        await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);

        // Reset spy so the second call's activity is unambiguous.
        sendMessageSpy.mockClear();

        // Second call — must be served from the in-memory cache.
        const cached = await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);

        // Background must NOT be contacted again.
        expect(sendMessageSpy).not.toHaveBeenCalled();

        // Returned value still carries the correct translated lines.
        expect(cached?.translated).toEqual(['Translated Line 1', 'Translated Line 2']);
    });

    // -------------------------------------------------------------------------
    it('fetches translated lyrics again for a different target language even when one language is already cached', async () => {
        const cache = { original: ['Line 1', 'Line 2'], processed: new Map() };
        const runtimeCache = new Map<string, any>();
        const genRef = { value: 0 };

        // Populate cache for English.
        await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);
        sendMessageSpy.mockClear();

        // Switch mock to return Japanese translations.
        sendMessageSpy.mockResolvedValue({
            translated: ['日本語翻訳1', '日本語翻訳2'],
            romanized: ['Nihongo 1', 'Nihongo 2'],
        });

        const jaResult = await fetchProcessed(cache.original, 'ja', cache, 'test-song-key', runtimeCache, genRef);

        // Background called once for the new language.
        expect(sendMessageSpy).toHaveBeenCalledTimes(1);
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'PROCESS', targetLang: 'ja' })
        );

        // Both language entries coexist in the cache with their respective translations.
        expect(cache.processed.get('en')?.translated).toEqual(['Translated Line 1', 'Translated Line 2']);
        expect(jaResult?.translated).toEqual(['日本語翻訳1', '日本語翻訳2']);
    });

    // -------------------------------------------------------------------------
    it('returns null and does not cache when the background returns no translated array', async () => {
        const cache = { original: ['Line 1', 'Line 2'], processed: new Map() };
        const runtimeCache = new Map<string, any>();
        const genRef = { value: 0 };

        // Simulate a background failure / malformed response.
        sendMessageSpy.mockResolvedValue(null);

        const result = await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);

        // Nothing should be cached for this language.
        expect(result).toBeNull();
        expect(cache.processed.has('en')).toBe(false);
    });

    // -------------------------------------------------------------------------
    it('does not contact the background when all original lines are empty', async () => {
        const cache = { original: ['', '   ', ''], processed: new Map() };
        const runtimeCache = new Map<string, any>();
        const genRef = { value: 0 };

        const result = await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);

        // Guard in fetchProcessed should have returned early.
        expect(result).toBeNull();
        expect(sendMessageSpy).not.toHaveBeenCalled();
    });
});
