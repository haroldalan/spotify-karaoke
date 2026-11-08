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
                    if (url.includes('NATIVE')) {
                        // Already native script: must never be "upgraded".
                        return {
                            lyrics: {
                                language: 'hi',
                                isDenseTypeface: false,
                                providerLyricsId: 'p123',
                                lines: [
                                    { words: 'यह केवल परीक्षण की पंक्ति है' },
                                    { words: 'यह दूसरी परीक्षण पंक्ति है' }
                                ]
                            }
                        };
                    }
                    // Romanized fallback (invented text, not song lyrics).
                    return {
                        lyrics: {
                            language: 'hi',
                            isDenseTypeface: false,
                            providerLyricsId: 'p123',
                            lines: [
                                { words: 'Mera dil tera hai, tu kahan hai yaar' },
                                { words: 'Kya hua jo tum saath nahin ho aaj' }
                            ]
                        }
                    };
                }
            };
        });

        const originalPostMessage = window.postMessage.bind(window);
        vi.spyOn(window, 'postMessage').mockImplementation(((message: any, targetOrigin?: any, transfer?: any) => {
            originalPostMessage(message, targetOrigin || '*', transfer);
        }) as any);

        window.addEventListener('message', (event) => {
            if (event.data?.source === 'SLY_ACTION_GATEWAY') {
                const action = event.data.action;
                if (action?.type === 'SLY_NATIVE_NEW_INTERCEPTION') {
                    window.postMessage({
                        source: 'SLY_ACTION_GATEWAY',
                        action: {
                            type: 'SLY_NATIVE_NEW_INTERCEPTION_RESPONSE',
                            requestId: action.requestId,
                            generation: 1
                        }
                    }, '*');
                } else if (action?.type === 'SLY_NATIVE_FETCH') {
                    window.postMessage({
                        source: 'SLY_ACTION_GATEWAY',
                        action: {
                            type: 'SLY_NATIVE_FETCH_RESPONSE',
                            requestId: action.requestId,
                            ok: true,
                            lines: [
                                { words: 'こんにちは世界、今日は良い天気ですね' },
                                { words: 'さくらの花が咲いている' }
                            ]
                        }
                    }, '*');
                }
            }
        });

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
                source: 'SLY_ACTION_GATEWAY',
                action: expect.objectContaining({
                    type: 'SKL_NATIVE_LYRICS',
                    trackId: '4cOdK2wGLETKBW3PvgPWqT'
                })
            }),
            expect.any(String)
        );
    });

    it('does not upgrade lyrics that are already in native script', async () => {
        await import('../../entrypoints/fetchInterceptor');

        await window.fetch('https://spclient.wg.spotify.com/color-lyrics/v2/track/NATIVE4cOdK2wGLETKBW3P');
        await new Promise(r => setTimeout(r, 50));

        const allCalls = (window.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        const actions = allCalls.map((c: any[]) => c[0]?.action).filter(Boolean);
        expect(actions.map((a: any) => a.type)).toContain('SLY_FETCH_END');
        expect(actions.some((a: any) => a.type === 'SLY_INTERCEPT_START' && a.trackId === 'NATIVE4cOdK2wGLETKBW3P')).toBe(false);
        expect(actions.some((a: any) => a.type === 'SKL_NATIVE_LYRICS' && a.trackId === 'NATIVE4cOdK2wGLETKBW3P')).toBe(false);
        expect(actions.some((a: any) => a.type === 'SLY_PREFETCH_REPORT' && a.state === 'ROMANIZED' && a.trackId === 'NATIVE4cOdK2wGLETKBW3P')).toBe(false);
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
            expect.objectContaining({
                source: 'SLY_ACTION_GATEWAY',
                action: expect.objectContaining({ type: 'SLY_FETCH_START', trackId: '123' })
            }), '*'
        );
        expect(window.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'SLY_ACTION_GATEWAY',
                action: expect.objectContaining({ type: 'SLY_FETCH_END', trackId: '123' })
            }), '*'
        );

        // Upgrade signals must NOT fire for Latin-script tracks
        const allCalls = (window.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        const types = allCalls.map((c: any[]) => c[0]?.action?.type || c[0]?.type);
        expect(types).not.toContain('SLY_INTERCEPT_START');
        expect(types).not.toContain('SKL_NATIVE_LYRICS');
    });
});
