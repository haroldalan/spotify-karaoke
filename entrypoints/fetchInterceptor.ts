import { handleColorLyrics, isColorLyricsUrl } from '../lib/colorLyricsInterceptor';

export default defineUnlistedScript(() => {
    /**
     * Headless Musixmatch Client (Remote Bridge)
     * Forwards all requests to the background script to ensure robust headers and caching.
     */
    const mxm = {
        notifyMetadata(trackId: string, name: string, artist: string) {
            window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_MXM_NOTIFY_METADATA', payload: { trackId, name, artist } } }, '*');
        },
        async newInterception(trackId: string): Promise<number> {
            return new Promise((resolve) => {
                const requestId = Math.random().toString(36).slice(2);
                const timeoutId = setTimeout(() => {
                    window.removeEventListener('message', handler);
                    console.warn('[SKaraoke:Interceptor] newInterception timed out after 15s. Resolving with fallback generation 0.');
                    resolve(0);
                }, 15000);
                const handler = (event: MessageEvent) => {
                    if (event.data?.source === 'SLY_ACTION_GATEWAY' && event.data.action?.type === 'SLY_MXM_NEW_INTERCEPTION_RESPONSE' && event.data.action.requestId === requestId) {
                        clearTimeout(timeoutId);
                        window.removeEventListener('message', handler);
                        resolve(event.data.action.generation);
                    }
                };
                window.addEventListener('message', handler);
                window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_MXM_NEW_INTERCEPTION', payload: { trackId }, requestId } }, '*');
            });
        },
        async fetchNativeLines(providerLyricsId: string | null, trackId: string, hexGid: string, interceptId: number): Promise<any[] | null> {
            // Safety: Ensure the ID is a number
            const id = interceptId;
            return new Promise((resolve) => {
                const requestId = Math.random().toString(36).slice(2);
                const timeoutId = setTimeout(() => {
                    window.removeEventListener('message', handler);
                    console.warn('[SKaraoke:Interceptor] fetchNativeLines timed out after 30s. Resolving with null.');
                    resolve(null);
                }, 30000);
                const handler = (event: MessageEvent) => {
                    if (event.data?.source === 'SLY_ACTION_GATEWAY' && event.data.action?.type === 'SLY_MXM_FETCH_NATIVE_RESPONSE' && event.data.action.requestId === requestId) {
                        clearTimeout(timeoutId);
                        window.removeEventListener('message', handler);
                        resolve(event.data.action.ok ? event.data.action.lines : null);
                    }
                };
                window.addEventListener('message', handler);
                window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_MXM_FETCH_NATIVE', payload: { providerLyricsId, trackId, hexGid, interceptId: id }, requestId } }, '*');
            });
        },
        warmup() {
            window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_MXM_WARMUP' } }, '*');
        }
    };

    mxm.warmup();

    // Listen for handshake pings from the isolated content script (BUG-B11 race condition)
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.source === 'SLY_ACTION_GATEWAY' && event.data.action?.type === 'SLY_PING_INTERCEPTOR') {
            window.postMessage({ type: 'SLY_INTERCEPTOR_READY' }, '*');
            window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_INTERCEPTOR_READY' } }, '*');
        }
    });

    // Signal that the interceptor is ready (BUG-B11)
    window.postMessage({ type: 'SLY_INTERCEPTOR_READY' }, '*');
    window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_INTERCEPTOR_READY' } }, '*');

    const _fetch = window.fetch.bind(window);
    
    // ─── Fetch interceptor ────────────────────────────────────────────────────

    if ((window.fetch as any).__sly_intercepted__) {
        console.warn('[SKaraoke:Interceptor] window.fetch is already intercepted. Skipping.');
        return;
    }

    (window.fetch as any).__sly_intercepted__ = true;

    window.fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        try {
            // Track metadata reaches the background via the bridge's
            // SLY_MXM_NOTIFY_METADATA (slyBridge.ts); no metadata endpoint is sniffed here.
            // Any *.spotify.com host (spclient.wg, gae2-spclient, …) with a
            // /color-lyrics/v2/track/ path is intercepted.
            if (!isColorLyricsUrl(url)) {
                return _fetch(input, init);
            }

            const originalResponse = await _fetch(input, init);
            const fallbackResponse = originalResponse.clone();
            
            return await handleColorLyrics(originalResponse, fallbackResponse, url, mxm as any);
        } catch (e) {
            console.error('[SKaraoke:Interceptor] Critical Fetch Intercept Failure:', e);
            return _fetch(input, init);
        }
    };
});
