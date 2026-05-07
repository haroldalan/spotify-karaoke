import { handleColorLyrics } from '../lib/colorLyricsInterceptor';

export default defineUnlistedScript(() => {
    /**
     * Headless Musixmatch Client (Remote Bridge)
     * Forwards all requests to the background script to ensure robust headers and caching.
     */
    const mxm = {
        notifyMetadata(trackId: string, name: string, artist: string) {
            window.postMessage({ type: 'SLY_MXM_NOTIFY_METADATA', payload: { trackId, name, artist } }, '*');
        },
        async newInterception(trackId: string): Promise<number> {
            return new Promise((resolve) => {
                const requestId = Math.random().toString(36).slice(2);
                const handler = (event: MessageEvent) => {
                    if (event.data?.type === 'SLY_MXM_NEW_INTERCEPTION_RESPONSE' && event.data.requestId === requestId) {
                        window.removeEventListener('message', handler);
                        resolve(event.data.generation);
                    }
                };
                window.addEventListener('message', handler);
                window.postMessage({ type: 'SLY_MXM_NEW_INTERCEPTION', payload: { trackId }, requestId }, '*');
            });
        },
        async fetchNativeLines(providerLyricsId: string | null, trackId: string, hexGid: string, interceptId: number): Promise<any[] | null> {
            // Safety: Ensure the ID is a number (handles accidental double-promise passing)
            const id = await interceptId;
            return new Promise((resolve) => {
                const requestId = Math.random().toString(36).slice(2);
                const handler = (event: MessageEvent) => {
                    if (event.data?.type === 'SLY_MXM_FETCH_NATIVE_RESPONSE' && event.data.requestId === requestId) {
                        window.removeEventListener('message', handler);
                        resolve(event.data.ok ? event.data.lines : null);
                    }
                };
                window.addEventListener('message', handler);
                window.postMessage({ type: 'SLY_MXM_FETCH_NATIVE', payload: { providerLyricsId, trackId, hexGid, interceptId: id }, requestId }, '*');
            });
        },
        warmup() {
            window.postMessage({ type: 'SLY_MXM_WARMUP' }, '*');
        }
    };

    mxm.warmup();

    const _fetch = window.fetch.bind(window);
    
    // ─── Fetch interceptor ────────────────────────────────────────────────────

    window.fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        try {
            if (url.includes('spclient.wg.spotify.com/metadata/41/track/')) {
                const res = await _fetch(input, init);
                try {
                    const data = await res.clone().json();
                    const id = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1] || data.gid;
                    if (id) {
                        mxm.notifyMetadata(id, data.name, data.artist?.[0]?.name || 'Unknown');
                    }
                } catch (e) { console.warn('[SKaraoke:Interceptor] Metadata error:', e); }
                return res;
            }

            if (!url.includes('spclient.wg.spotify.com/color-lyrics/v2/track/')) {
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
