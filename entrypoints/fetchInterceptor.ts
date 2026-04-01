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
    const LATIN_LIKE_LANGS = new Set(['en', 'es', 'pt', 'it', 'fr', 'de', 'nl']);

    /** Convert Spotify Base62 Track ID to Hex GID */
    function base62ToHex(id: string): string {
        const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        try {
            let n = BigInt(0);
            for (const c of id) {
                const idx = CHARS.indexOf(c);
                if (idx === -1) return id; // Fallback
                n = n * 62n + BigInt(idx);
            }
            return n.toString(16).padStart(32, '0');
        } catch { return id; }
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
                // console.log('[SKL] Token restored from storage, expires in', Math.round((exp - Date.now()) / 60000), 'min');
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

    function onMetadataReady(hexGid: string, callback: (m: TrackMetadata) => void) {
        const existing = _pendingMetaCallbacks.get(hexGid) ?? [];
        existing.push(callback);
        _pendingMetaCallbacks.set(hexGid, existing);
    }

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
                
                if (token && token !== 'UpgradeRequiredUpgradeRequired' && !token.startsWith('UpgradeRequired')) {
                    _tokenCache = token;
                    _tokenExpiry = Date.now() + 55 * 60 * 1000;
                    try {
                        localStorage.setItem('skl_mxm_token', token);
                        localStorage.setItem('skl_mxm_token_expiry', String(_tokenExpiry));
                    } catch { /* ignore */ }
                    return token;
                } else {
                    console.warn('[SKL] Token rejected:', token?.startsWith('Upgrade') ? 'Rate limited (UpgradeRequired)' : `Unexpected value: ${token}`);
                }
            } catch (e) { console.warn('[SKL] Token catch error:', e); }
            return null;
        })();

        const result = await _tokenPromise;
        // if (result) console.log('[SKL] Musixmatch Token Acquired');
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

            // Handle 429: Too Many Requests (Rate limit)
            if (res.status === 429 || data?.message?.header?.status_code === 429) {
                // Wait 1.5s and retry once.
                await new Promise(r => setTimeout(r, 1500));
                res = await _fetch(buildUrl(token), { credentials: 'omit' });
                data = await res.json() as any;
            }

            // Handle 401: Unauthorized (Stale token)
            if (data?.message?.header?.status_code === 401 || data?.message?.header?.status_code === 402) {
                token = await getToken(true);
                if (!token) return null;
                res = await _fetch(buildUrl(token), { credentials: 'omit' });
                data = await res.json() as any;
            }

            if (data?.message?.header?.status_code === 200) return data;
        } catch (e) {
            console.warn('[SKL] mxmFetch failed:', path, e);
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

    /** Strategy 1: synced subtitle via commontrack_id (providerLyricsId from Spotify). */
    async function fetchSubtitle(commontrackId: string | null): Promise<SubtitleLine[] | null> {
        if (!commontrackId) return null;
        const data = await mxmFetch('/track.subtitle.get', {
            subtitle_format: 'mxm',
            commontrack_id: commontrackId,
        });
        const lines = parseSubtitle(data);
        if (!lines) return null;

        // Ensure instrumental breaks have the music symbol
        return lines.map(line => ({
            ...line,
            words: line.words || '♪',
        }));
    }

    /** Strategy 1.5: synced lyrics via track_id. */
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

    /** Strategy 4: text-based search fallback (Artist + Track). */
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
            console.warn('[SKL] Search failed for:', name, artist);
            return null;
        }

        const commontrackId = list[0].track.commontrack_id;
        // Try synced first, then unsynced fallback
        return await fetchSubtitle(commontrackId) || await fetchUnsyncedLyrics(commontrackId);
    }

    /** Strategy 3: unsynced lyrics fallback (no timing, but native script). */
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
    ): Promise<SubtitleLine[] | null> {
        // console.log('[SKL] Starting Native Restoration for:', spotifyTrackId);

        // Strategy 1: Linked SubtitleID (Fastest)
        const fromId = await fetchSubtitle(providerLyricsId);
        if (fromId && fromId.length > 0) {
            // console.log('[SKL] Strategy 1 (Linked ID) Success');
            return fromId;
        }
        // console.log('[SKL] Strategy 1 Fail');

        // Strategy 2: Linked SpotifyID
        const trackData = await mxmFetch('/track.get', { track_spotify_id: spotifyTrackId });
        const body = (trackData as any)?.message?.body?.track;
        
        if (body) {
            console.log('[SKL] Strategy 2 (Track ID) Mapping Found');
            const trackName = (body.track_name ?? '').toLowerCase();
            if (!trackName.includes('(english version)') && 
                !trackName.includes('(international version)') && 
                !trackName.includes('english ver.')) {
                
                const fromTrackId = await fetchSubtitleByTrackId(body.track_id);
                if (fromTrackId && fromTrackId.length > 0) {
                    console.log('[SKL] Strategy 2 Success');
                    return fromTrackId;
                }
            }
        }
        console.log('[SKL] Strategy 2 Fail');

        // Strategy 4: Metadata Search Fallback (Catch unlinked tracks)
        let meta = _metadataCache.get(hexGid);
        if (!meta) {
            console.log('[SKL] Metadata missing, waiting...');
            // Wait for metadata if it's missing (max 3s)
            meta = await new Promise<TrackMetadata | null>(resolve => {
                const timer = setTimeout(() => resolve(null), 3000);
                onMetadataReady(hexGid, (m) => { clearTimeout(timer); resolve(m); });
            }) || undefined;
        }

        if (meta) {
            console.log('[SKL] Triggering Strategy 4 (Search) for:', meta.name, 'by', meta.artist);
            const fromSearch = await fetchSubtitleBySearch(meta.name, meta.artist);
            if (fromSearch && fromSearch.length > 0) {
                console.log('[SKL] Strategy 4 Success');
                return fromSearch;
            }
        } else {
            console.warn('[SKL] Strategy 4 Aborted: Metadata Timeout');
        }

        // Final Strategy: Unsynced fallback (Linked source)
        const unsynced = await fetchUnsyncedLyrics(providerLyricsId);
        // if (unsynced) console.log('[SKL] Final Fallback (Unsynced) Success');
        return unsynced;
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

        // Ultimate Fail-Safe: If anything during interception fails, 
        // we MUST return the original fetch call to avoid breaking Spotify.
        try {
            // Case A: Metadata Interception (Stash the artist/track names)
            if (url.includes('spclient.wg.spotify.com/metadata/41/track/')) {
                const res = await _fetch(input, init);
                try {
                    const data = await res.clone().json();
                    const id = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1] || data.gid;
                    if (id) {
                        const meta = {
                            name: data.name,
                            artist: data.artist?.[0]?.name || 'Unknown',
                        };
                        _metadataCache.set(id, meta);
                        // Trigger pending callbacks
                        const callbacks = _pendingMetaCallbacks.get(id);
                        if (callbacks) {
                            callbacks.forEach(cb => cb(meta));
                            _pendingMetaCallbacks.delete(id);
                        }
                    }
                } catch (e) { console.warn('[SKL] Metadata error:', e); }
                return res;
            }

            // Case B: Lyrics Interception
            if (!url.includes('spclient.wg.spotify.com/color-lyrics/v2/track/')) {
                return _fetch(input, init);
            }

            // Intercepted lyrics call
            const originalResponse = await _fetch(input, init);
            
            // Fail-safe clone for fallback reconstruction
            const fallbackResponse = originalResponse.clone();
            let data: any = null;

            try {
                data = await originalResponse.json() as any;
                const language = data.lyrics?.language;
                const isDenseTypeface = data.lyrics?.isDenseTypeface;
                const providerLyricsId = data.lyrics?.providerLyricsId;
                const spotifyTrackId = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1];
                const hexGid = spotifyTrackId ? base62ToHex(spotifyTrackId) : null;

                // console.log('[SKL] Intercepted:', { language, isDenseTypeface, spotifyTrackId, hexGid });

                // Vindicated Guard: If Spotify already has native script (isDenseTypeface: true)
                // or if we're in a'Latin-like language, we skip restoration to save API usage.
                if (isDenseTypeface !== false || LATIN_LIKE_LANGS.has(language!) || !spotifyTrackId) {
                    const headers = new Headers(fallbackResponse.headers);
                    headers.delete('content-encoding');
                    headers.set('content-type', 'application/json');
                    return new Response(JSON.stringify(data), { 
                        status: fallbackResponse.status,
                        statusText: fallbackResponse.statusText,
                        headers 
                    });
                }

                const nativeLines = await fetchNativeLines(providerLyricsId, spotifyTrackId, hexGid!);
                if (!nativeLines || nativeLines.length === 0) {
                    console.warn('[SKL] Native restoration failed or returned no lines.');
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
                    lyrics: { 
                        ...data.lyrics, 
                        isDenseTypeface: true, 
                        lines: nativeLines 
                    },
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
                console.error('[SKL] Interceptor block error:', e);
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
            console.error('[SKL] Critical Fetch Intercept Failure:', e);
            // The absolute ultimate fallback: perform a-clean, original fetch.
            return _fetch(input, init);
        }
    };
});
