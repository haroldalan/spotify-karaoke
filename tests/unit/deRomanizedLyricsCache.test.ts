import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleNativeLyrics } from '../../lib/core/nativeLyricsHandler';
import type { NativeLyricsState } from '../../lib/core/nativeLyricsHandler';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted by Vitest before any imports are resolved.
//
// handleNativeLyrics has two side-effect dependencies we isolate:
//   • lib/dom/domQueries  — we control what track ID is "playing" and what
//     lyric DOM elements are visible.
//   • lib/core/lyricsCache — we stub loadSongCache so no browser.storage
//     I/O takes place.
// ---------------------------------------------------------------------------
vi.mock('../../lib/dom/domQueries', () => ({
    getNowPlayingTrackId: vi.fn(),
    getLyricsLines: vi.fn(),
}));
vi.mock('../../lib/core/lyricsCache', () => ({
    loadSongCache: vi.fn().mockResolvedValue(undefined),
}));
// slyForensics is assigned to window in forensics.ts — we shim it here so the
// module can import cleanly in JSDOM.
vi.mock('../../lib/slyCore/forensics', () => {
    const forensics = {
        nativeRegex: /[\u0B80-\u0BFF\u0900-\u0DFF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F]/g,
        analyzeText(input: unknown) {
            const text = Array.isArray(input) ? (input as string[]).join(' ') : (input as string || '');
            const nativeMatches = text.match(this.nativeRegex);
            const latinMatches  = text.match(/[A-Za-z]/g);
            const nativeCount   = nativeMatches ? nativeMatches.length : 0;
            const latinCount    = latinMatches  ? latinMatches.length  : 0;
            return {
                nativeCount,
                latinCount,
                isActuallyNative: nativeCount > 0 && nativeCount >= (latinCount / 2),
                hasAnyNative: nativeCount > 0,
            };
        },
    };
    (global as any).slyForensics = forensics;
    return { slyForensics: forensics };
});

import { getNowPlayingTrackId, getLyricsLines } from '../../lib/dom/domQueries';
import { loadSongCache } from '../../lib/core/lyricsCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal DOM lyric line element (mirrors [data-testid="lyrics-line"] > div). */
function makeLyricsEl(text = ''): HTMLElement {
    const el = document.createElement('div');
    el.textContent = text;
    return el;
}

/** Builds a minimal NativeLyricsState for each test. */
function makeState(overrides: Partial<NativeLyricsState> = {}): NativeLyricsState {
    return {
        cache: { original: [], processed: new Map() },
        pendingNativeLines: new Map(),
        songKey: 'test-song-key',
        mode: 'original',
        currentActiveLang: 'en',
        runtimeCache: new Map(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Caching De-Romanized Original Lyrics Fetched from MusixMatch
// ---------------------------------------------------------------------------
// Covers: lib/core/nativeLyricsHandler.ts → handleNativeLyrics()
//
// When Spotify serves romanized fallback lyrics (e.g. "namaste duniya" instead
// of "नमस्ते दुनिया") and MusixMatch supplies the native-script version, the
// extension must:
//   1. Replace cache.original with the native lines.
//   2. Clear cache.processed so stale romanized/translated data is discarded.
//   3. Write the native text into the live DOM elements.
//   4. Re-trigger mode switching if the user is not in 'original' mode.
//
// Conversely it must not overwrite an already-native cache (idempotency guard).
// ---------------------------------------------------------------------------

describe('Caching De-Romanized Original Lyrics from MusixMatch', () => {
    const TRACK_ID = 'testTrack123';

    beforeEach(() => {
        // Default: the widget reports the expected track as currently playing.
        (getNowPlayingTrackId as ReturnType<typeof vi.fn>).mockReturnValue(TRACK_ID);
        // Default: no visible lyric DOM elements.
        (getLyricsLines as ReturnType<typeof vi.fn>).mockReturnValue([]);
        (loadSongCache as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        // Expose forensics on window so the module can reference it.
        (global as any).window = global;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    it('replaces cache.original with native lines fetched from MusixMatch', async () => {
        const romanizedLines  = ['namaste duniya', 'teri yaadein'];
        const nativeLines     = ['नमस्ते दुनिया', 'तेरी यादें'];

        const state = makeState({ cache: { original: romanizedLines, processed: new Map() } });

        await handleNativeLyrics(
            TRACK_ID,
            nativeLines,
            state,
            vi.fn(),     // onCancelInflight
            vi.fn(),     // onModeSwitch
        );

        expect(state.cache.original).toEqual(nativeLines);
    });

    // -------------------------------------------------------------------------
    it('clears the processed cache so stale romanized/translated data is discarded', async () => {
        const romanizedLines = ['namaste duniya'];
        const nativeLines    = ['नमस्ते दुनिया'];

        // Pre-populate the processed cache with stale romanized data.
        const staleProcessed = new Map([
            ['en', { translated: ['Hello world'], romanized: ['namaste duniya'] }],
        ]);
        const state = makeState({ cache: { original: romanizedLines, processed: staleProcessed } });

        await handleNativeLyrics(TRACK_ID, nativeLines, state, vi.fn(), vi.fn());

        expect(state.cache.processed.size).toBe(0);
    });

    // -------------------------------------------------------------------------
    it('writes native text into live DOM lyric elements when mode is "original"', async () => {
        const romanizedLines = ['namaste duniya', 'teri yaadein'];
        const nativeLines    = ['नमस्ते दुनिया', 'तेरी यादें'];

        const el0 = makeLyricsEl('namaste duniya');
        const el1 = makeLyricsEl('teri yaadein');
        (getLyricsLines as ReturnType<typeof vi.fn>).mockReturnValue([el0, el1]);

        const state = makeState({
            mode: 'original',
            cache: { original: romanizedLines, processed: new Map() },
        });

        await handleNativeLyrics(TRACK_ID, nativeLines, state, vi.fn(), vi.fn());

        expect(el0.textContent).toBe('नमस्ते दुनिया');
        expect(el1.textContent).toBe('तेरी यादें');
        expect(el0.getAttribute('data-sly-original')).toBe('नमस्ते दुनिया');
        expect(el1.getAttribute('data-sly-original')).toBe('तेरी यादें');
    });

    // -------------------------------------------------------------------------
    it('calls onModeSwitch (not DOM write) when mode is not "original"', async () => {
        const romanizedLines = ['namaste duniya'];
        const nativeLines    = ['नमस्ते दुनिया'];

        const onModeSwitch = vi.fn().mockResolvedValue(undefined);
        const state = makeState({
            mode: 'romanized',
            currentActiveLang: 'en',
            cache: { original: romanizedLines, processed: new Map() },
        });

        await handleNativeLyrics(TRACK_ID, nativeLines, state, vi.fn(), onModeSwitch);

        // View refresh must be requested for the current mode.
        expect(onModeSwitch).toHaveBeenCalledWith('romanized', 'en');
        // DOM write path (getLyricsLines) must NOT have been called for content.
        expect(getLyricsLines).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    it('does not overwrite cache when the same native lines are already present (idempotency guard)', async () => {
        const nativeLines = ['नमस्ते दुनिया', 'तेरी यादें'];

        // Cache already holds the exact native lines.
        const state = makeState({ cache: { original: [...nativeLines], processed: new Map() } });

        const onCancelInflight = vi.fn();
        const onModeSwitch     = vi.fn();

        await handleNativeLyrics(TRACK_ID, nativeLines, state, onCancelInflight, onModeSwitch);

        // Neither a mode switch nor an inflight cancel should occur.
        expect(onCancelInflight).not.toHaveBeenCalled();
        expect(onModeSwitch).not.toHaveBeenCalled();
        // Cache remains unchanged.
        expect(state.cache.original).toEqual(nativeLines);
    });

    // -------------------------------------------------------------------------
    it('does nothing when the reported track ID does not match the playing track', async () => {
        const nativeLines = ['नमस्ते दुनिया'];

        // The widget says a *different* track is playing.
        (getNowPlayingTrackId as ReturnType<typeof vi.fn>).mockReturnValue('differentTrack');

        const onCancelInflight = vi.fn();
        const state = makeState({ cache: { original: ['namaste duniya'], processed: new Map() } });

        await handleNativeLyrics(TRACK_ID, nativeLines, state, onCancelInflight, vi.fn());

        // No upgrade should happen; the cached romanized lines are untouched.
        expect(state.cache.original).toEqual(['namaste duniya']);
        expect(onCancelInflight).not.toHaveBeenCalled();
    });
});
