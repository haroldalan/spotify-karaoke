(function () {
    const INDIAN_LANGUAGE_CODES = new Set(['hi', 'mr', 'sa', 'gu', 'pa', 'kn', 'ml', 'ta', 'te', 'bn']);
    const MXM_APP_ID = 'web-desktop-app-v1.0';
    const MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

    let _tokenCache = null;
    let _tokenExpiry = 0;

    const _fetch = window.fetch.bind(window);

    async function getToken() {
        if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;
        try {
            const url = `${MXM_BASE}/token.get?app_id=${MXM_APP_ID}&format=json`;
            const res = await _fetch(url, { credentials: 'omit' });
            const data = await res.json();
            const token = data?.message?.body?.user_token;
            if (token && token !== 'UpgradeRequiredUpgradeRequired') {
                _tokenCache = token;
                _tokenExpiry = Date.now() + 10 * 60 * 1000;
                return token;
            }
        } catch { /* ignore */ }
        return null;
    }

    function checkTokenStatus(data) {
        const statusCode = data?.message?.header?.status_code;
        if (statusCode === 401 || statusCode === 402) {
            _tokenCache = null;
            return false;
        }
        return true;
    }

    // Strategy 1: Synced subtitle via commontrack_id (providerLyricsId from Spotify)
    async function fetchSubtitle(commontrackId, token) {
        const url = new URL(`${MXM_BASE}/track.subtitle.get`);
        url.searchParams.set('format', 'json');
        url.searchParams.set('subtitle_format', 'mxm');
        url.searchParams.set('app_id', MXM_APP_ID);
        url.searchParams.set('usertoken', token);
        url.searchParams.set('commontrack_id', String(commontrackId));
        try {
            const res = await _fetch(url.toString(), { credentials: 'omit' });
            const data = await res.json();
            if (!checkTokenStatus(data)) return null;
            const raw = data?.message?.body?.subtitle?.subtitle_body;
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed.map((line, i) => ({
                id: String(i),
                startTimeMs: String(Math.round((line.time?.total ?? 0) * 1000)),
                words: line.text || '♪',
                syllables: [],
                endTimeMs: '0',
            }));
        } catch { return null; }
    }

    // Strategy 2: Look up Musixmatch track_id via Spotify ID, then get subtitle
    async function fetchSubtitleViaSpotifyId(spotifyTrackId, token) {
        const lookupUrl = new URL(`${MXM_BASE}/track.get`);
        lookupUrl.searchParams.set('format', 'json');
        lookupUrl.searchParams.set('app_id', MXM_APP_ID);
        lookupUrl.searchParams.set('usertoken', token);
        lookupUrl.searchParams.set('track_spotify_id', spotifyTrackId);
        try {
            const res = await _fetch(lookupUrl.toString(), { credentials: 'omit' });
            const data = await res.json();
            if (!checkTokenStatus(data)) return null;
            const trackId = data?.message?.body?.track?.track_id;
            if (!trackId) return null;
            const subtitleUrl = new URL(`${MXM_BASE}/track.subtitle.get`);
            subtitleUrl.searchParams.set('format', 'json');
            subtitleUrl.searchParams.set('subtitle_format', 'mxm');
            subtitleUrl.searchParams.set('app_id', MXM_APP_ID);
            subtitleUrl.searchParams.set('usertoken', token);
            subtitleUrl.searchParams.set('track_id', String(trackId));
            const sRes = await _fetch(subtitleUrl.toString(), { credentials: 'omit' });
            const sData = await sRes.json();
            const raw = sData?.message?.body?.subtitle?.subtitle_body;
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed.map((line, i) => ({
                id: String(i),
                startTimeMs: String(Math.round((line.time?.total ?? 0) * 1000)),
                words: line.text || '♪',
                syllables: [],
                endTimeMs: '0',
            }));
        } catch { return null; }
    }

    // Strategy 3: Unsynced lyrics fallback (no timing, but native script)
    async function fetchUnsyncedLyrics(commontrackId, token) {
        const url = new URL(`${MXM_BASE}/track.lyrics.get`);
        url.searchParams.set('format', 'json');
        url.searchParams.set('app_id', MXM_APP_ID);
        url.searchParams.set('usertoken', token);
        url.searchParams.set('commontrack_id', String(commontrackId));
        try {
            const res = await _fetch(url.toString(), { credentials: 'omit' });
            const data = await res.json();
            if (!checkTokenStatus(data)) return null;
            const lyricsBody = data?.message?.body?.lyrics?.lyrics_body;
            if (!lyricsBody) return null;
            return lyricsBody
                .split('\n')
                .filter(l => l.trim() && !l.startsWith('****'))
                .map((text, i) => ({
                    id: String(i),
                    startTimeMs: '0',
                    words: text,
                    syllables: [],
                    endTimeMs: '0',
                }));
        } catch { return null; }
    }

    async function fetchNativeLines(providerLyricsId, spotifyTrackId, token) {
        const lines = await fetchSubtitle(providerLyricsId, token)
            ?? await fetchSubtitleViaSpotifyId(spotifyTrackId, token)
            ?? await fetchUnsyncedLyrics(providerLyricsId, token);
        return lines;
    }

    window.fetch = async function (input, init) {
        const url =
            typeof input === 'string' ? input
                : input instanceof URL ? input.href
                    : input.url;

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

        // isDenseTypeface: false = Spotify serving romanized fallback for a native-script song
        if (!INDIAN_LANGUAGE_CODES.has(language) || isDenseTypeface !== false
            || !providerLyricsId || !spotifyTrackId) {
            return response;
        }

        const token = await getToken();
        if (!token) return response;

        const nativeLines = await fetchNativeLines(providerLyricsId, spotifyTrackId, token);
        if (!nativeLines) return response;

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
