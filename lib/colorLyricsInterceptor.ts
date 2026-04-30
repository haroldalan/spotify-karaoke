import { LATIN_LIKE_LANGS, base62ToHex } from './utils/spotifyUtils';
import type { MxmClient } from './mxmClient';

/**
 * Convenience wrapper: posts a SLY_* message to the content-script world.
 * Uses '*' as the target origin — consistent with lyric-test/modules/bridge/interceptor.js.
 * (SKL_NATIVE_LYRICS uses window.location.origin separately for security.)
 */
function slyPost(type: string, trackId?: string, extra?: Record<string, unknown>): void {
    window.postMessage(
        { type, ...(trackId ? { trackId } : {}), ...(extra ?? {}) },
        '*',
    );
}

export async function handleColorLyrics(
    originalResponse: Response,
    fallbackResponse: Response,
    url: string,
    mxm: MxmClient,
): Promise<Response> {
    let data: any = null;

    // Extract the track ID once — needed for all signals.
    const spotifyTrackId = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1];

    // ── Signal 1: SLY_FETCH_START ─────────────────────────────────────────────
    // Tells the DOM engine that Spotify's color-lyrics response is being processed.
    // Sets slyInternalState.isSpotifyFetching = true so the poll loop pauses.
    // Port of: lyric-test/modules/bridge/interceptor.js lines 25-27
    if (spotifyTrackId) slyPost('SLY_FETCH_START', spotifyTrackId);

    // Guard: non-2xx responses (401, 404, 429, 503, 304, …) won't contain usable JSON.
    // A 404 specifically means Spotify has no lyrics at all → MISSING.
    if (!originalResponse.ok) {
        if (spotifyTrackId && originalResponse.status === 404) {
            // Port of: lyric-test/modules/bridge/interceptor.js lines 32-33
            slyPost('SLY_PREFETCH_REPORT', spotifyTrackId, { state: 'MISSING' });
        }
        if (spotifyTrackId) slyPost('SLY_FETCH_END', spotifyTrackId);
        return fallbackResponse;
    }

    // Tracks whether SLY_INTERCEPT_START has been sent. Used by the catch block
    // to guarantee SLY_INTERCEPT_END is always paired — prevents the DOM engine
    // from being stuck with interceptorActive = true on an unexpected exception.
    let interceptStarted = false;

    try {
        data = await originalResponse.json() as any;

        const language      = data.lyrics?.language as string | undefined;
        const isDenseTypeface = data.lyrics?.isDenseTypeface as boolean | undefined;
        const providerLyricsId = data.lyrics?.providerLyricsId as string | undefined;
        const syncType      = data.lyrics?.syncType as string | undefined;
        const lines         = data.lyrics?.lines as unknown[] | undefined;
        const hexGid        = spotifyTrackId ? base62ToHex(spotifyTrackId) : null;

        // ── Signal 2/3: SLY_PREFETCH_REPORT ──────────────────────────────────
        // Report the track's lyric state to the content-script's preFetch registry
        // BEFORE deciding whether to attempt a native upgrade. This ensures the
        // detector's §4 check is informed even for Latin-script or dense tracks
        // that we won't try to upgrade.
        // Port of: lyric-test/modules/bridge/interceptor.js lines 52-63
        if (spotifyTrackId) {
            if (!data?.lyrics || !lines || lines.length === 0) {
                slyPost('SLY_PREFETCH_REPORT', spotifyTrackId, { state: 'MISSING' });
            } else if (syncType === 'UNSYNCED') {
                slyPost('SLY_PREFETCH_REPORT', spotifyTrackId, { state: 'UNSYNCED' });
            }
        }

        // Early-exit: no upgrade needed (Latin / already dense / no IDs).
        if (isDenseTypeface !== false || LATIN_LIKE_LANGS.has(language!) || !spotifyTrackId || !hexGid) {
            if (!hexGid && spotifyTrackId) {
                console.warn('[SKaraoke:Interceptor] Base62 conversion failed for track ID:', spotifyTrackId);
            }
            const headers = new Headers(fallbackResponse.headers);
            headers.delete('content-encoding');
            headers.set('content-type', 'application/json');
            if (spotifyTrackId) slyPost('SLY_FETCH_END', spotifyTrackId);
            return new Response(JSON.stringify(data), {
                status: fallbackResponse.status,
                statusText: fallbackResponse.statusText,
                headers,
            });
        }

        // Increment generation only for real intercepts.
        const interceptId = mxm.newInterception(spotifyTrackId);

        // ── Signal 4: SLY_INTERCEPT_START ─────────────────────────────────────
        // Tells the DOM engine to suspend decisions while the MXM upgrade is in
        // progress. The DOM engine will not make any injection decisions until
        // SLY_INTERCEPT_END is received.
        // Port of: lyric-test/modules/bridge/interceptor.js line 91
        slyPost('SLY_INTERCEPT_START', spotifyTrackId);
        interceptStarted = true;

        const nativeLines = await mxm.fetchNativeLines(providerLyricsId ?? null, spotifyTrackId, hexGid, interceptId);

        if (!nativeLines || nativeLines.length === 0) {
            console.warn('[SKaraoke:Interceptor] Native restoration failed or returned no lines.');

            // ── Signals 5 + 6 + 7 (failure path) ────────────────────────────
            // Port of: lyric-test/modules/bridge/interceptor.js lines 95-99
            slyPost('SLY_INTERCEPT_END', spotifyTrackId);
            interceptStarted = false;
            slyPost('SLY_FORCE_FALLBACK', spotifyTrackId);   // → forces Layer 2 (YTM/LRCLIB)
            slyPost('SLY_FETCH_END', spotifyTrackId);

            const headers = new Headers(fallbackResponse.headers);
            headers.delete('content-encoding');
            headers.set('content-type', 'application/json');
            return new Response(JSON.stringify(data), {
                status: fallbackResponse.status,
                statusText: fallbackResponse.statusText,
                headers,
            });
        }

        // ── Success path ──────────────────────────────────────────────────────
        // Notify the content script that Layer 1 upgraded successfully.
        // Uses window.location.origin (not '*') — SKL_NATIVE_LYRICS carries line
        // content so we restrict it to the same origin for safety.
        window.postMessage({
            type: 'SKL_NATIVE_LYRICS',
            trackId: spotifyTrackId,
            nativeLines: nativeLines.map((l: any) => l.words),
        }, window.location.origin);

        // ── Signals 5 + 7 (success path) ─────────────────────────────────────
        // Port of: lyric-test/modules/bridge/interceptor.js lines 119-120
        slyPost('SLY_INTERCEPT_END', spotifyTrackId);
        interceptStarted = false;
        slyPost('SLY_FETCH_END', spotifyTrackId);

        const modified = {
            ...data,
            lyrics: { ...data.lyrics, isDenseTypeface: true, lines: nativeLines },
        };

        const headers = new Headers(fallbackResponse.headers);
        headers.delete('content-encoding');
        headers.set('content-type', 'application/json');

        return new Response(JSON.stringify(modified), {
            status: fallbackResponse.status,
            statusText: fallbackResponse.statusText,
            headers,
        });

    } catch (e) {
        console.error('[SKaraoke:Interceptor] Interceptor block error:', e);

        // Defensive cleanup: if SLY_INTERCEPT_START was sent but an exception
        // interrupted the flow before SLY_INTERCEPT_END, send it now.
        if (interceptStarted && spotifyTrackId) {
            slyPost('SLY_INTERCEPT_END', spotifyTrackId);
        }
        if (spotifyTrackId) slyPost('SLY_FETCH_END', spotifyTrackId);

        if (data === null) return fallbackResponse;
        const headers = new Headers(fallbackResponse.headers);
        headers.delete('content-encoding');
        headers.set('content-type', 'application/json');
        return new Response(JSON.stringify(data), {
            status: fallbackResponse.status,
            statusText: fallbackResponse.statusText,
            headers,
        });
    }
}
