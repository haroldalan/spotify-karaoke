import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Fetch Interceptor (window.fetch Hijack)', () => {
    let originalFetch: any;
    
    beforeEach(() => {
        originalFetch = window.fetch;

        // Mock base fetch to simulate Spotify's response
        window.fetch = vi.fn().mockImplementation(async (url: any) => {
            const urlStr = typeof url === 'string' ? url : (url.href || url.url || String(url));
            console.log('MOCK FETCH CALLED WITH:', urlStr);
            if (urlStr.includes('musixmatch')) {
                if (urlStr.includes('token.get')) {
                    return { json: async () => ({ message: { body: { user_token: 'test_token' } } }) };
                }
                if (urlStr.includes('subtitle.get')) {
                    // Well-formed subtitle_body with >10 native (Japanese) chars to pass forensic check
                    const subtitleBody = JSON.stringify([
                        { time: { total: 1.5 }, text: 'こんにちは世界、今日は良い天気ですね' },
                        { time: { total: 5.0 }, text: 'さくらの花が咲いている' },
                    ]);
                    return {
                        json: async () => ({
                            message: { header: { status_code: 200 }, body: {
                                subtitle: { subtitle_body: subtitleBody }
                            }}
                        })
                    };
                }
                // Fallback: unsynced lyrics with >10 native chars
                return {
                    json: async () => ({
                        message: { header: { status_code: 200 }, body: {
                            lyrics: { lyrics_body: 'こんにちは世界、今日は良い天気ですね\nさくらの花が咲いている' }
                        }}
                    })
                };
            }
            return {
                ok: true,
                clone: function() { return this; },
                json: async () => {
                    if (url.includes('123')) {
                        return { lyrics: { language: 'en', providerLyricsId: 'p123' } };
                    }
                    return {
                        lyrics: {
                            language: 'hi',
                            isDenseTypeface: false,
                            providerLyricsId: 'p123'
                        }
                    };
                }
            };
        });

        vi.spyOn(window, 'postMessage').mockImplementation(() => {});
        vi.resetModules();
    });

    afterEach(() => {
        window.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('intercepts /color-lyrics/v2/ HTTP calls for supported languages', async () => {
        await import('../../entrypoints/fetchInterceptor');

        // Fire the intercepted fetch with a supported language ('hi')
        await window.fetch('https://spclient.wg.spotify.com/color-lyrics/v2/track/4cOdK2wGLETKBW3PvgPWqT');

        // wait an event loop tick for async Musixmatch API mocks
        await new Promise(r => setTimeout(r, 50));

        // Fix (Issue 3): target origin is now window.location.origin, not '*'
        expect(window.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SKL_NATIVE_LYRICS',
                trackId: '4cOdK2wGLETKBW3PvgPWqT'
            }),
            expect.any(String)
        );
    });

    it('ignores unsupported languages to save processing', async () => {
        await import('../../entrypoints/fetchInterceptor');

        // 123 returns 'en' (Latin) — the interceptor should fire lifecycle signals
        // (SLY_FETCH_START, SLY_PREFETCH_REPORT, SLY_FETCH_END) so the DOM engine
        // stays in sync, but must NOT fire upgrade signals (SLY_INTERCEPT_START,
        // SKL_NATIVE_LYRICS) since no MXM upgrade is attempted for Latin tracks.
        await window.fetch('https://spclient.wg.spotify.com/color-lyrics/v2/track/123');
        await new Promise(r => setTimeout(r, 50));

        // Lifecycle signals fire for all tracks (pre-fetch registry populated)
        expect(window.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SLY_FETCH_START', trackId: '123' }), '*'
        );
        expect(window.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SLY_FETCH_END', trackId: '123' }), '*'
        );

        // Upgrade signals must NOT fire for Latin-script tracks
        const allCalls = (window.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        const types = allCalls.map((c: any[]) => c[0]?.type);
        expect(types).not.toContain('SLY_INTERCEPT_START');
        expect(types).not.toContain('SKL_NATIVE_LYRICS');
    });
});
