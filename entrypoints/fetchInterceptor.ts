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

export default defineUnlistedScript(() => {
    const INDIAN_LANGUAGE_CODES = new Set([
        'hi', 'mr', 'sa', 'gu', 'pa', 'kn', 'ml', 'ta', 'te', 'bn', 'or', 'si', 'ne', 'as',
    ]);
    const MXM_APP_ID = 'web-desktop-app-v1.0';
    const MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

    // ─── Token state ──────────────────────────────────────────────────────────

    let _tokenCache: string | null = null;
    let _tokenExpiry = 0;
    let _tokenPromise: Promise<string | null> | null = null;

    /** Stash the real fetch before we overwrite it. */
    const _fetch = window.fetch.bind(window);

    // ─── Token management ─────────────────────────────────────────────────────

    /**
     * Returns a valid Musixmatch user token, fetching one if necessary.
     *
     * Deduplication: concurrent callers share a single in-flight request.
     * forceNew=true (used after a 401): clears the stale cache and starts a
     * fresh fetch — but only if no fetch is already in-flight (the in-flight
     * fetch IS the fresh attempt; no need to race it with a second one).
     */
    async function getToken(forceNew = false): Promise<string | null> {
        // If a fresh fetch is already in flight, let it win — even on forceNew.
        // Only clear the stale cache when there is nothing else in flight yet.
        if (forceNew && !_tokenPromise) {
            _tokenCache = null;
            _tokenExpiry = 0;
        }

        if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;
        if (_tokenPromise) return _tokenPromise;

        // Async IIFE avoids the `new Promise(async ...)` anti-pattern, which
        // can silently swallow rejections that occur before the first await.
        _tokenPromise = (async (): Promise<string | null> => {
            try {
                const url = `${MXM_BASE}/token.get?app_id=${MXM_APP_ID}&format=json`;
                const res = await _fetch(url, { credentials: 'omit' });
                const data: unknown = await res.json();
                const token = (data as any)?.message?.body?.user_token as string | undefined;
                if (token && token !== 'UpgradeRequiredUpgradeRequired') {
                    _tokenCache = token;
                    _tokenExpiry = Date.now() + 55 * 60 * 1000;
                    return token;
                }
            } catch { /* ignore */ }
            return null;
        })();

        const result = await _tokenPromise;
        _tokenPromise = null;
        return result;
    }

    // ─── Musixmatch API helpers ───────────────────────────────────────────────

    async function mxmFetch(
        path: string,
        params: Record<string, string | number | undefined>,
    ): Promise<unknown | null> {
        let token = await getToken();
        if (!token) return null;

        const buildUrl = (t: string): string => {
            const url = new URL(`${MXM_BASE}${path}`);
            url.searchParams.set('format', 'json');
            url.searchParams.set('app_id', MXM_APP_ID);
            url.searchParams.set('usertoken', t);
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined) url.searchParams.set(k, String(v));
            }
            return url.toString();
        };

        try {
            let res = await _fetch(buildUrl(token), { credentials: 'omit' });
            let data = await res.json() as any;

            // On 401, force-refresh the token and retry once.
            if (data?.message?.header?.status_code === 401) {
                token = await getToken(true);
                if (!token) return null;
                res = await _fetch(buildUrl(token), { credentials: 'omit' });
                data = await res.json() as any;
            }

            if (data?.message?.header?.status_code === 200) return data;
        } catch { /* ignore */ }

        return null;
    }

    // ─── Subtitle parsing ─────────────────────────────────────────────────────

    interface SubtitleLine {
        id: string;
        startTimeMs: string;
        words: string;
        syllables: never[];
        endTimeMs: string;
    }

    function parseSubtitle(data: unknown): SubtitleLine[] | null {
        const raw = (data as any)?.message?.body?.subtitle?.subtitle_body as string | undefined;
        if (!raw) return null;
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length === 0) return null;

            return (parsed as any[]).map((line, i): SubtitleLine => ({
                id: String(i),
                startTimeMs: String(Math.round((line.time?.total ?? 0) * 1000)),
                words: line.text ?? '',
                syllables: [],
                endTimeMs: '0',
            }));
        } catch { return null; }
    }

    // ─── Fetch strategies ─────────────────────────────────────────────────────

    /** Strategy 1: synced subtitle via commontrack_id (providerLyricsId from Spotify). */
    async function fetchSubtitle(commontrackId: string | null): Promise<SubtitleLine[] | null> {
        if (!commontrackId) return null;
        const data = await mxmFetch('/track.subtitle.get', {
            subtitle_format: 'mxm',
            commontrack_id: commontrackId,
        });
        return parseSubtitle(data);
    }

    /** Strategy 2: look up Musixmatch track_id via Spotify ID, then get subtitle. */
    async function fetchSubtitleViaSpotifyId(spotifyTrackId: string): Promise<SubtitleLine[] | null> {
        const trackData = await mxmFetch('/track.get', { track_spotify_id: spotifyTrackId });
        const trackId = (trackData as any)?.message?.body?.track?.track_id as number | undefined;
        if (!trackId) return null;

        const subtitleData = await mxmFetch('/track.subtitle.get', {
            subtitle_format: 'mxm',
            track_id: trackId,
        });
        return parseSubtitle(subtitleData);
    }

    async function fetchNativeLines(
        providerLyricsId: string | null,
        spotifyTrackId: string,
    ): Promise<SubtitleLine[] | null> {
        const fromId = await fetchSubtitle(providerLyricsId);
        if (fromId && fromId.length > 0) return fromId;
        return fetchSubtitleViaSpotifyId(spotifyTrackId);
    }

    // ─── Fetch interceptor ────────────────────────────────────────────────────

    window.fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        const url =
            typeof input === 'string' ? input
                : input instanceof URL ? input.href
                    : (input as Request).url;

        // Fast-path: ignore non-lyrics requests.
        if (!url.includes('spclient.wg.spotify.com/color-lyrics/v2/track/')) {
            return _fetch(input, init);
        }

        const response = await _fetch(input, init);
        let data: any;
        try { data = await response.clone().json(); } catch { return response; }

        const language: string | undefined = data?.lyrics?.language;
        const isDenseTypeface: boolean | undefined = data?.lyrics?.isDenseTypeface;
        const providerLyricsId: string | null = data?.lyrics?.providerLyricsId ?? null;
        const spotifyTrackId: string | null = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1] ?? null;

        // Intercept only Indian-language tracks that received a romanized fallback.
        // Even if providerLyricsId is absent, we proceed — Strategy 2 uses the Spotify ID directly.
        if (!INDIAN_LANGUAGE_CODES.has(language!) || isDenseTypeface !== false || !spotifyTrackId) {
            return response;
        }

        const nativeLines = await fetchNativeLines(providerLyricsId, spotifyTrackId);
        if (!nativeLines) {
            window.postMessage({ type: 'SKL_NATIVE_FETCH_FAILED', trackId: spotifyTrackId }, '*');
            return response;
        }

        window.postMessage({
            type: 'SKL_NATIVE_LYRICS',
            trackId: spotifyTrackId,
            nativeLines: nativeLines.map((l) => l.words),
        }, '*');

        const modified = {
            ...data,
            lyrics: { ...data.lyrics, isDenseTypeface: true, lines: nativeLines },
        };

        const headers = new Headers(response.headers);
        headers.delete('content-encoding');
        headers.set('content-type', 'application/json');

        return new Response(JSON.stringify(modified), {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    };
});
