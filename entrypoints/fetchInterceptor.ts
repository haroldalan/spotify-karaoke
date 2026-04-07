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
    /** Languages that typically don't need native script restoration as they are Latin-based. */
    const LATIN_LIKE_LANGS = new Set([
      'en', 'es', 'pt', 'it', 'fr', 'de', 'nl', 'sv', 'da', 'no', 'nb', 'fi', 
      'pl', 'tr', 'id', 'ro', 'cs', 'hu', 'sk', 'hr', 'ca', 'eu', 'gl',
      'et', 'lv', 'lt', 'sl', 'bs', 'sq', 'af', 'ms', 'cy', 'ga', 'sw'
    ]);

    /** Convert Spotify Base62 Track ID to Hex GID */
    function base62ToHex(id: string): string | null {
        const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        try {
            let n = BigInt(0);
            for (const c of id) {
                const idx = CHARS.indexOf(c);
                if (idx === -1) return null; // Error
                n = n * 62n + BigInt(idx);
            }
            return n.toString(16).padStart(32, '0');
        } catch { return null; }
    }

    const MXM_APP_ID = 'web-desktop-app-v1.0';
    const MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

    const _fetch = window.fetch.bind(window);

    // ─── Token state ──────────────────────────────────────────────────────────
    let _tokenCache: string | null = null;
    let _tokenExpiry = 0;
    let _tokenPromise: Promise<string | null> | null = null;

    (function hydrateTokenFromStorage() {
        try {
            const t = localStorage.getItem('skl_mxm_token');
            const exp = Number(localStorage.getItem('skl_mxm_token_expiry') ?? '0');
            if (t && Date.now() < exp) {
                _tokenCache = t;
                _tokenExpiry = exp;
                // console.log('[SKaraoke:Interceptor] Token restored from storage, expires in', Math.round((exp - Date.now()) / 60000), 'min');
            }
        } catch { /* ignore */ }
    })();

    getToken(); // Module-level warmup

    interface TrackMetadata {
        name: string;
        artist: string;
    }
    const _metadataCache = new Map<string, TrackMetadata>();
    const _pendingMetaCallbacks = new Map<string, Array<(m: TrackMetadata) => void>>();
    const _currentInterceptGeneration = new Map<string, number>();

    function onMetadataReady(hexGid: string, callback: (m: TrackMetadata) => void) {
        const existing = _pendingMetaCallbacks.get(hexGid) ?? [];
        existing.push(callback);
        _pendingMetaCallbacks.set(hexGid, existing);
    }

    // ─── Token management ─────────────────────────────────────────────────────

    /**
     * Returns a valid Musixmatch user token, fetching one if necessary.
     */
    async function getToken(forceNew = false): Promise<string | null> {
        if (forceNew && !_tokenPromise) {
            _tokenCache = null;
            _tokenExpiry = 0;
        }

        if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;
        if (_tokenPromise) return _tokenPromise;

        _tokenPromise = (async (): Promise<string | null> => {
            try {
                const url = `${MXM_BASE}/token.get?app_id=${MXM_APP_ID}&format=json`;
                const res = await _fetch(url, { credentials: 'omit' });
                const data: unknown = await res.json();
                const token = (data as any)?.message?.body?.user_token as string | undefined;
                
                if (token && token !== 'UpgradeRequiredUpgradeRequired' && !token.startsWith('UpgradeRequired')) {
                    _tokenCache = token;
                    _tokenExpiry = Date.now() + 55 * 60 * 1000;
                    try {
                        localStorage.setItem('skl_mxm_token', token);
                        localStorage.setItem('skl_mxm_token_expiry', String(_tokenExpiry));
                    } catch { /* ignore */ }
                    return token;
                } else {
                    console.error('[SKaraoke:Interceptor] Token rejected. API response:', data);
                    console.warn('[SKaraoke:Interceptor] Token rejected details:', token?.startsWith('Upgrade') ? 'Rate limited (UpgradeRequired)' : `Unexpected value: ${token}`);
                }
            } catch (e) { console.error('[SKaraoke:Interceptor] Token acquisition failed:', e); }
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

            if (res.status === 429 || data?.message?.header?.status_code === 429) {
                await new Promise(r => setTimeout(r, 1500));
                res = await _fetch(buildUrl(token), { credentials: 'omit' });
                data = await res.json() as any;
            }

            if (data?.message?.header?.status_code === 401 || data?.message?.header?.status_code === 402) {
                token = await getToken(true);
                if (!token) return null;
                res = await _fetch(buildUrl(token), { credentials: 'omit' });
                data = await res.json() as any;
            }

            if (data?.message?.header?.status_code === 200) return data;
        } catch (e) {
            console.warn('[SKaraoke:Interceptor] mxmFetch failed:', path, e);
        }
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

    async function fetchSubtitle(commontrackId: string | null): Promise<SubtitleLine[] | null> {
        if (!commontrackId) return null;
        const data = await mxmFetch('/track.subtitle.get', {
            subtitle_format: 'mxm',
            commontrack_id: commontrackId,
        });
        const lines = parseSubtitle(data);
        if (!lines) return null;
        return lines.map(line => ({
            ...line,
            words: line.words || '♪',
        }));
    }

    async function fetchSubtitleByTrackId(trackId: number | string): Promise<SubtitleLine[] | null> {
        const data = await mxmFetch('/track.subtitle.get', {
            subtitle_format: 'mxm',
            track_id: trackId,
        });
        const lines = parseSubtitle(data);
        if (!lines) return null;
        return lines.map(line => ({
            ...line,
            words: line.words || '♪',
        }));
    }

    async function fetchSubtitleBySearch(name: string, artist: string): Promise<SubtitleLine[] | null> {
        const searchData = await mxmFetch('/track.search', {
            q_track: name,
            q_artist: artist,
            f_has_lyrics: 1,
            s_track_rating: 'desc',
            page_size: 1,
        });
        const list = (searchData as any)?.message?.body?.track_list as any[] | undefined;
        if (!list || list.length === 0) {
            console.warn('[SKaraoke:Interceptor] Search failed for:', name, artist);
            return null;
        }
        const commontrackId = list[0].track.commontrack_id;
        return await fetchSubtitle(commontrackId) || await fetchUnsyncedLyrics(commontrackId);
    }

    async function fetchUnsyncedLyrics(commontrackId: string | null): Promise<SubtitleLine[] | null> {
        if (!commontrackId) return null;
        const data = await mxmFetch('/track.lyrics.get', { commontrack_id: commontrackId });
        const lyricsBody = (data as any)?.message?.body?.lyrics?.lyrics_body as string | undefined;
        if (!lyricsBody) return null;
        return lyricsBody
            .split('\n')
            .filter(l => l.trim() && !l.startsWith('****'))
            .map((text, i) => ({
                id: String(i),
                startTimeMs: '0',
                words: text.trim() || '♪',
                syllables: [],
                endTimeMs: '0',
            }));
    }

    async function fetchNativeLines(
        providerLyricsId: string | null,
        spotifyTrackId: string,
        hexGid: string,
        interceptId: number,
    ): Promise<SubtitleLine[] | null> {
        const isStale = () => (_currentInterceptGeneration.get(spotifyTrackId) ?? 0) !== interceptId;
        if (isStale()) return null;

        const fromId = await fetchSubtitle(providerLyricsId);
        if (isStale()) return null;
        if (fromId && fromId.length > 0) return fromId;

        const trackData = await mxmFetch('/track.get', { track_spotify_id: spotifyTrackId });
        if (isStale()) return null;
        const body = (trackData as any)?.message?.body?.track;
        if (body) {
            const trackName = (body.track_name ?? '').toLowerCase();
            if (!trackName.includes('(english version)') && 
                !trackName.includes('(international version)') && 
                !trackName.includes('english ver.')) {
                
                const fromTrackId = await fetchSubtitleByTrackId(body.track_id);
                if (isStale()) return null;
                if (fromTrackId && fromTrackId.length > 0) return fromTrackId;
            }
        }

        let meta = _metadataCache.get(hexGid);
        if (!meta) {
            meta = await new Promise<TrackMetadata | null>(resolve => {
                const cb = (m: TrackMetadata) => { clearTimeout(timer); resolve(m); };
                const timer = setTimeout(() => {
                    const existing = _pendingMetaCallbacks.get(hexGid) || [];
                    const filtered = existing.filter(c => c !== cb);
                    if (filtered.length === 0) _pendingMetaCallbacks.delete(hexGid);
                    else _pendingMetaCallbacks.set(hexGid, filtered);
                    resolve(null);
                }, 3000);
                onMetadataReady(hexGid, cb);
            }) || undefined;
        }

        if (isStale()) return null;

        if (meta) {
            const fromSearch = await fetchSubtitleBySearch(meta.name, meta.artist);
            if (isStale()) return null;
            if (fromSearch && fromSearch.length > 0) return fromSearch;
        }

        const unsynced = await fetchUnsyncedLyrics(providerLyricsId);
        if (isStale()) return null;
        return unsynced;
    }

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
                        const meta = { name: data.name, artist: data.artist?.[0]?.name || 'Unknown' };
                        _metadataCache.set(id, meta);
                        const callbacks = _pendingMetaCallbacks.get(id);
                        if (callbacks) {
                            callbacks.forEach(cb => cb(meta));
                            _pendingMetaCallbacks.delete(id);
                        }
                    }
                } catch (e) { console.warn('[SKaraoke:Interceptor] Metadata error:', e); }
                return res;
            }

            if (!url.includes('spclient.wg.spotify.com/color-lyrics/v2/track/')) {
                return _fetch(input, init);
            }

            const originalResponse = await _fetch(input, init);
            const fallbackResponse = originalResponse.clone();
            let data: any = null;

            try {
                data = await originalResponse.json() as any;
                const language = data.lyrics?.language;
                const isDenseTypeface = data.lyrics?.isDenseTypeface;
                const providerLyricsId = data.lyrics?.providerLyricsId;
                const spotifyTrackId = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1];
                const hexGid = spotifyTrackId ? base62ToHex(spotifyTrackId) : null;

                if (isDenseTypeface !== false || LATIN_LIKE_LANGS.has(language!) || !spotifyTrackId || !hexGid) {
                    if (!hexGid && spotifyTrackId) {
                        console.warn('[SKaraoke:Interceptor] Base62 conversion failed for track ID:', spotifyTrackId);
                    }
                    const headers = new Headers(fallbackResponse.headers);
                    headers.delete('content-encoding');
                    headers.set('content-type', 'application/json');
                    return new Response(JSON.stringify(data), { 
                        status: fallbackResponse.status,
                        statusText: fallbackResponse.statusText,
                        headers 
                    });
                }

                // Increment generation only for real intercepts
                const nextGen = (_currentInterceptGeneration.get(spotifyTrackId) ?? 0) + 1;
                _currentInterceptGeneration.set(spotifyTrackId, nextGen);
                const interceptId = nextGen;

                const nativeLines = await fetchNativeLines(providerLyricsId, spotifyTrackId, hexGid, interceptId);
                if (!nativeLines || nativeLines.length === 0) {
                    console.warn('[SKaraoke:Interceptor] Native restoration failed or returned no lines.');
                    const headers = new Headers(fallbackResponse.headers);
                    headers.delete('content-encoding');
                    headers.set('content-type', 'application/json');
                    return new Response(JSON.stringify(data), { 
                        status: fallbackResponse.status,
                        statusText: fallbackResponse.statusText,
                        headers 
                    });
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
        } catch (e) {
            console.error('[SKaraoke:Interceptor] Critical Fetch Intercept Failure:', e);
            return _fetch(input, init);
        }
    };
});
