/**
 * fetchInterceptor.js
 *
 * Plain-JS IIFE — no imports, no exports, no TypeScript.
 * Injected into the page's MAIN world as a <script src> tag by
 * spotify-inject.content.ts before Spotify's React bundle loads.
 */
(function () {
    const INDIAN_LANGUAGE_CODES = new Set(['hi', 'mr', 'sa', 'gu', 'pa', 'kn', 'ml', 'ta', 'te', 'bn', 'or', 'si', 'ne', 'as']);
    const MXM_APP_ID = 'web-desktop-app-v1.0';
    const MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

    let _tokenCache = null;
    let _tokenExpiry = 0;
    let _tokenPromise = null;

    const _fetch = window.fetch.bind(window);

    async function getToken(forceNew = false) {
        if (forceNew) {
            _tokenCache = null;
            _tokenExpiry = 0;
        }
        if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;
        if (_tokenPromise) return _tokenPromise;

        _tokenPromise = new Promise(async (resolve) => {
            try {
                const url = `${MXM_BASE}/token.get?app_id=${MXM_APP_ID}&format=json`;
                const res = await _fetch(url, { credentials: 'omit' });
                const data = await res.json();
                const token = data?.message?.body?.user_token;
                if (token && token !== 'UpgradeRequiredUpgradeRequired') {
                    _tokenCache = token;
                    _tokenExpiry = Date.now() + 55 * 60 * 1000;
                    resolve(token);
                    return;
                }
            } catch { /* ignore */ }
            resolve(null);
        });

        const result = await _tokenPromise;
        _tokenPromise = null;
        return result;
    }

    async function mxmFetch(path, params) {
        let token = await getToken();
        if (!token) return null;

        const buildUrl = (t) => {
            const url = new URL(`${MXM_BASE}${path}`);
            url.searchParams.set('format', 'json');
            url.searchParams.set('app_id', MXM_APP_ID);
            url.searchParams.set('usertoken', t);
            for (const [k, v] of Object.entries(params)) {
                if (v) url.searchParams.set(k, v);
            }
            return url.toString();
        };

        try {
            let res = await _fetch(buildUrl(token), { credentials: 'omit' });
            let data = await res.json();

            // Handle token invalidation smoothly
            if (data?.message?.header?.status_code === 401) {
                token = await getToken(true);
                if (!token) return null;
                res = await _fetch(buildUrl(token), { credentials: 'omit' });
                data = await res.json();
            }

            // We only return data if the status code is exactly 200
            if (data?.message?.header?.status_code === 200) {
                return data;
            }
        } catch { /* ignore */ }
        
        return null;
    }

    function parseSubtitle(data) {
        const raw = data?.message?.body?.subtitle?.subtitle_body;
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length === 0) return null;
            
            return parsed.map((line, i) => ({
                id: String(i),
                startTimeMs: String(Math.round((line.time?.total ?? 0) * 1000)),
                words: line.text ?? '',
                syllables: [],
                endTimeMs: '0',
            }));
        } catch { return null; }
    }

    // Strategy 1: Synced subtitle via commontrack_id (providerLyricsId from Spotify)
    async function fetchSubtitle(commontrackId) {
        if (!commontrackId) return null;
        const data = await mxmFetch('/track.subtitle.get', {
            subtitle_format: 'mxm',
            commontrack_id: String(commontrackId)
        });
        return parseSubtitle(data);
    }

    // Strategy 2: Look up Musixmatch track_id via Spotify ID, then get subtitle
    async function fetchSubtitleViaSpotifyId(spotifyTrackId) {
        if (!spotifyTrackId) return null;
        const trackData = await mxmFetch('/track.get', {
            track_spotify_id: spotifyTrackId
        });
        const trackId = trackData?.message?.body?.track?.track_id;
        if (!trackId) return null;

        const subtitleData = await mxmFetch('/track.subtitle.get', {
            subtitle_format: 'mxm',
            track_id: String(trackId)
        });
        return parseSubtitle(subtitleData);
    }

    async function fetchNativeLines(providerLyricsId, spotifyTrackId) {
        return (
            await fetchSubtitle(providerLyricsId) ??
            await fetchSubtitleViaSpotifyId(spotifyTrackId)
        );
    }

    window.fetch = async function (input, init) {
        const url =
            typeof input === 'string' ? input
                : input instanceof URL ? input.href
                    : input.url;

        // Fast-path ignore non-lyrics requests
        if (!url.includes('spclient.wg.spotify.com/color-lyrics/v2/track/')) {
            return _fetch(input, init);
        }

        const response = await _fetch(input, init);
        let data;
        try { data = await response.clone().json(); } catch { return response; }

        const language = data?.lyrics?.language;
        const isDenseTypeface = data?.lyrics?.isDenseTypeface;
        const providerLyricsId = data?.lyrics?.providerLyricsId;
        const spotifyTrackId = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1] ?? null;

        // Intercept ONLY if it's an Indian language that received a romanized fallback.
        // Even if providerLyricsId is null, we proceed (fallback directly to Strategy 2 via Spotify ID).
        if (!INDIAN_LANGUAGE_CODES.has(language) || isDenseTypeface !== false || !spotifyTrackId) {
            return response;
        }

        const nativeLines = await fetchNativeLines(providerLyricsId, spotifyTrackId);
        if (!nativeLines) {
            // All Musixmatch strategies exhausted or token failed
            window.postMessage({ type: 'SKL_NATIVE_FETCH_FAILED', trackId: spotifyTrackId }, '*');
            return response;
        }

        // Notify the content-script world to apply native lines immediately
        window.postMessage({
            type: 'SKL_NATIVE_LYRICS',
            trackId: spotifyTrackId,
            nativeLines: nativeLines.map(l => l.words),
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
})();
