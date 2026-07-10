import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectScript } from '../../lib/lyrics/scriptDetector';
import { chunkByCharCount } from '../../lib/translateClient';
import { fetchProcessed } from '../../lib/core/fetchProcessed';

// ---------------------------------------------------------------------------
// Module-level mocks — must be at top level so Vitest can hoist them correctly.
// These cover the side-effect imports of fetchProcessed.
// ---------------------------------------------------------------------------
vi.mock('../../lib/core/lyricsCache', () => ({
    saveSongCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/dom/toast', () => ({
    showToast: vi.fn(),
}));

// In WXT/Vitest, wxt sets up a mock browser environment automatically.

describe('Background Script - detectScript', () => {
    it('correctly identifies Japanese (mixed Kanji and Kana)', () => {
        expect(detectScript(['春はあけぼの', 'やうやう白くなりゆく際'])).toBe('japanese');
    });

    it('correctly identifies Japanese (Kana only)', () => {
        expect(detectScript(['ありがとう'])).toBe('japanese');
    });

    it('correctly identifies Chinese (Hanzi only)', () => {
        expect(detectScript(['你好，世界', '这是一个测试'])).toBe('chinese');
    });

    it('correctly identifies Korean (Hangul)', () => {
        expect(detectScript(['안녕하세요', '세상아'])).toBe('korean');
    });

    it('correctly identifies Latin scripts (English, Spanish, etc.)', () => {
        expect(detectScript(['Hello world', 'This is a test'])).toBe('latin');
        expect(detectScript(['Hola mundo', 'Ésta es una prueba'])).toBe('latin');
        expect(detectScript(['Café au lait'])).toBe('latin');
    });

    it('correctly identifies Tamil', () => {
        expect(detectScript(['வணக்கம்', 'உலகம்'])).toBe('tamil');
    });

    it('correctly identifies Devanagari (Hindi)', () => {
        expect(detectScript(['नमस्ते', 'दुनिया'])).toBe('devanagari');
    });

    it('correctly identifies Cyrillic', () => {
        expect(detectScript(['Привет', 'мир'])).toBe('cyrillic');
    });

    it('correctly identifies Thai', () => {
        expect(detectScript(['สวัสดี', 'ชาวโลก'])).toBe('thai');
    });

    it('returns "other" for purely symbolic/numeric text', () => {
        expect(detectScript(['123', '??? !!!'])).toBe('other');
        expect(detectScript(['♪♪♪'])).toBe('other');
    });
});

describe('Background Script - chunkByCharCount', () => {
    it('chunks lines perfectly without exceeding maxChars', () => {
        const lines = ['123', '456', '789', '012'];
        // maxChars of 8 means '123\n456' is 7 chars. (123 + 456 + \n).
        const result = chunkByCharCount(lines, 8);
        expect(result.chunks).toEqual([['123', '456'], ['789', '012']]);
        expect(result.wasTruncated).toBe(false);
    });

    it('handles a single line extending beyond maxChars gracefully (truncates to maintain index alignment)', () => {
        const lines = ['1234567890', '123'];
        const result = chunkByCharCount(lines, 5);
        // Fix (Issue 9): truncation now always appends '…' — '12345' → '12345…'
        // The slice is to maxChars chars, then '…' replaces the last char so total stays ≤ maxChars+1
        expect(result.chunks).toEqual([['12345…'], ['123']]);
        expect(result.wasTruncated).toBe(true);
    });

    it('handles empty arrays', () => {
        const result = chunkByCharCount([], 10);
        expect(result.chunks).toEqual([]);
        expect(result.wasTruncated).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Caching Romanized Lyrics
// ---------------------------------------------------------------------------
// Covers: lib/core/fetchProcessed.ts
//
// fetchProcessed is the gatekeeper that decides whether romanized (and
// translated) lyrics need to be fetched from the background or can be served
// directly from the in-memory processed cache.  This suite verifies **only**
// the romanized-caching path, in isolation from everything else.
// ---------------------------------------------------------------------------

describe('Caching Romanized Lyrics', () => {

    // Use a stable reference to the sendMessage spy so we can inspect call counts.
    let sendMessageSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Reset the global browser mock's sendMessage before every test.
        sendMessageSpy = vi.fn().mockResolvedValue({
            translated: ['Translation Line 1', 'Translation Line 2'],
            romanized: ['Romanized Line 1', 'Romanized Line 2'],
        });
        (global as any).browser.runtime.sendMessage = sendMessageSpy;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('fetches romanized lyrics from background on first call and stores them in cache', async () => {

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

        // Background was called exactly once.
        expect(sendMessageSpy).toHaveBeenCalledTimes(1);
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'PROCESS', targetLang: 'en' })
        );

        // The romanized array returned is the one the background provided.
        expect(result?.romanized).toEqual(['Romanized Line 1', 'Romanized Line 2']);

        // The result has been written into the in-memory processed cache.
        expect(cache.processed.has('en')).toBe(true);
        expect(cache.processed.get('en')?.romanized).toEqual(['Romanized Line 1', 'Romanized Line 2']);
    });

    it('serves romanized lyrics from cache on second call without contacting the background', async () => {

        const cache = { original: ['Line 1', 'Line 2'], processed: new Map() };
        const runtimeCache = new Map<string, any>();
        const genRef = { value: 0 };

        // First call — populates the cache.
        await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);

        // Reset spy so the second call's activity is unambiguous.
        sendMessageSpy.mockClear();

        // Second call — should hit the in-memory cache.
        const cached = await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);

        // Background must NOT be contacted again.
        expect(sendMessageSpy).not.toHaveBeenCalled();

        // Returned value still carries the correct romanized lines.
        expect(cached?.romanized).toEqual(['Romanized Line 1', 'Romanized Line 2']);
    });

    it('fetches again for a different target language even when one language is already cached', async () => {

        const cache = { original: ['Line 1', 'Line 2'], processed: new Map() };
        const runtimeCache = new Map<string, any>();
        const genRef = { value: 0 };

        // Populate cache for 'en'.
        await fetchProcessed(cache.original, 'en', cache, 'test-song-key', runtimeCache, genRef);
        sendMessageSpy.mockClear();

        // Requesting 'ja' — not in cache yet.
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

        // Both 'en' and 'ja' romanized data are independently cached.
        expect(cache.processed.get('en')?.romanized).toEqual(['Romanized Line 1', 'Romanized Line 2']);
        expect(jaResult?.romanized).toEqual(['Nihongo 1', 'Nihongo 2']);
    });
});
