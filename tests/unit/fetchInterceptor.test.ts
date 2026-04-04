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
                // Mock Musixmatch API response for native lyrics
                return {
                    json: async () => ({
                        message: { header: { status_code: 200 }, body: {
                            lyrics: { lyrics_body: 'こんにちは\n\n世界' }
                        }}
                    })
                };
            }
            return {
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

        expect(window.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SKL_NATIVE_LYRICS',
                trackId: '4cOdK2wGLETKBW3PvgPWqT'
            }),
            '*'
        );
    });

    it('ignores unsupported languages to save processing', async () => {
        await import('../../entrypoints/fetchInterceptor');

        // 123 returns 'en'
        await window.fetch('https://spclient.wg.spotify.com/color-lyrics/v2/track/123');
        await new Promise(r => setTimeout(r, 50));

        expect(window.postMessage).not.toHaveBeenCalled();
    });
});
