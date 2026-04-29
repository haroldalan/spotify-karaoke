/**
 * fetchInterceptor.ts
 *
 * WXT unlisted script — compiled to a plain fetchInterceptor.js by Vite.
 * Injected into the page's MAIN world as a <script src> tag by
 * spotify-inject.content.ts before Spotify's React bundle loads.
 *
 * No WXT/browser extension APIs are available here — this runs in the
 * page's main world and is entirely self-contained.
 */

import { createMxmClient } from '../lib/mxmClient';
import { handleColorLyrics } from '../lib/colorLyricsInterceptor';

export default defineUnlistedScript(() => {
    const _fetch = window.fetch.bind(window);
    const mxm = createMxmClient(_fetch);
    mxm.warmup();

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
            
            return await handleColorLyrics(originalResponse, fallbackResponse, url, mxm);
        } catch (e) {
            console.error('[SKaraoke:Interceptor] Critical Fetch Intercept Failure:', e);
            return _fetch(input, init);
        }
    };
});
