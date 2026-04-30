import type { SubtitleLine } from './lyrics/subtitleParser';
import { parseSubtitle } from './lyrics/subtitleParser';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackMetadata {
    name: string;
    artist: string;
}

export interface MxmClient {
    fetchNativeLines(
        providerLyricsId: string | null,
        spotifyTrackId: string,
        hexGid: string,
        interceptId: number,
    ): Promise<SubtitleLine[] | null>;
    notifyMetadata(id: string, name: string, artist: string): void;
    newInterception(spotifyTrackId: string): number;
    warmup(): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMxmClient(fetchFn: typeof window.fetch): MxmClient {
    const MXM_APP_ID = 'web-desktop-app-v1.0';
    const MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

    // ─── Token state ──────────────────────────────────────────────────────────
    let _tokenCache: string | null = null;
    let _tokenExpiry = 0;
    let _tokenPromise: Promise<string | null> | null = null;

    function hydrateTokenFromStorage() {
        try {
            const t = localStorage.getItem('skl_mxm_token');
            const exp = Number(localStorage.getItem('skl_mxm_token_expiry') ?? '0');
            if (t && Date.now() < exp) {
                _tokenCache = t;
                _tokenExpiry = exp;
                // console.log('[SKaraoke:Interceptor] Token restored from storage, expires in', Math.round((exp - Date.now()) / 60000), 'min');
            }
        } catch { /* ignore */ }
    }

    hydrateTokenFromStorage();

    // ─── Metadata state ───────────────────────────────────────────────────────

    const _metadataCache = new Map<string, TrackMetadata>();
    const _pendingMetaCallbacks = new Map<string, Array<(m: TrackMetadata) => void>>();
    const _currentInterceptGeneration = new Map<string, number>();

    const MAP_CAP = 200;
    function capMap<K, V>(map: Map<K, V>): void {
        if (map.size > MAP_CAP) {
            map.delete(map.keys().next().value!);
        }
    }

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
                const res = await fetchFn(url, { credentials: 'omit' });
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
            let res = await fetchFn(buildUrl(token), { credentials: 'omit' });
            let data = await res.json() as any;

            if (res.status === 429 || data?.message?.header?.status_code === 429) {
                await new Promise(r => setTimeout(r, 1500));
                res = await fetchFn(buildUrl(token), { credentials: 'omit' });
                data = await res.json() as any;
            }

            if (data?.message?.header?.status_code === 401 || data?.message?.header?.status_code === 402) {
                token = await getToken(true);
                if (!token) return null;
                res = await fetchFn(buildUrl(token), { credentials: 'omit' });
                data = await res.json() as any;
            }

            if (data?.message?.header?.status_code === 200) return data;
        } catch (e) {
            console.warn('[SKaraoke:Interceptor] mxmFetch failed:', path, e);
        }
        return null;
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

    // ─── Forensic verification ──────────────────────────────────────────────

    /**
     * Self-contained native-script verifier.
     * Mirrors the logic in lyric-test/modules/common/forensics.js `analyzeText()`
     * and lyric-test/modules/bridge/interceptor.js lines 101-110.
     *
     * We cannot call window.slyForensics here because mxmClient runs in the
     * MAIN world where isolated-world window globals are not accessible.
     *
     * Returns true only if the lines contain > 10 native-script characters
     * (Indic, CJK, Cyrillic, Arabic, Thai) — the same threshold as the
     * original `isActuallyNative` check.
     */
    function verifyNativeScript(lines: SubtitleLine[]): boolean {
        const NATIVE_REGEX =
            /[\u0900-\u0DFF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F]/g;
        const sample = lines.slice(0, 15).map(l => l.words).join(' ');
        const matches = sample.match(NATIVE_REGEX);
        const nativeCount = matches ? matches.length : 0;
        return nativeCount > 10;
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
        if (fromId && fromId.length > 0) {
            if (!verifyNativeScript(fromId)) {
                console.warn('[SKaraoke:Interceptor] ⚠️ Forensic check failed on subtitle (commontrackId) — appears romanized. Trying next strategy.');
            } else {
                return fromId;
            }
        }

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
                if (fromTrackId && fromTrackId.length > 0) {
                    if (!verifyNativeScript(fromTrackId)) {
                        console.warn('[SKaraoke:Interceptor] ⚠️ Forensic check failed on subtitle (trackId) — appears romanized. Trying next strategy.');
                    } else {
                        return fromTrackId;
                    }
                }
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
            if (fromSearch && fromSearch.length > 0) {
                if (!verifyNativeScript(fromSearch)) {
                    console.warn('[SKaraoke:Interceptor] ⚠️ Forensic check failed on search result — appears romanized. Trying unsynced fallback.');
                } else {
                    return fromSearch;
                }
            }
        }

        const unsynced = await fetchUnsyncedLyrics(providerLyricsId);
        if (isStale()) return null;
        if (!unsynced) return null;

        // Forensic gate: if the final candidate lines don't contain enough
        // native-script characters, MXM also returned romanized content.
        // Returning null signals the interceptor to fire SLY_FORCE_FALLBACK.
        if (!verifyNativeScript(unsynced)) {
            console.warn('[SKaraoke:Interceptor] ⚠️ Forensic check failed on unsynced fallback — MXM content appears romanized. Aborting.');
            return null;
        }
        return unsynced;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    return {
        fetchNativeLines,

        warmup(): void {
            getToken();
        },

        newInterception(spotifyTrackId: string): number {
            const nextGen = (_currentInterceptGeneration.get(spotifyTrackId) ?? 0) + 1;
            capMap(_currentInterceptGeneration);
            _currentInterceptGeneration.set(spotifyTrackId, nextGen);
            return nextGen;
        },

        notifyMetadata(id: string, name: string, artist: string): void {
            const meta = { name, artist };
            capMap(_metadataCache);
            _metadataCache.set(id, meta);
            const callbacks = _pendingMetaCallbacks.get(id);
            if (callbacks) {
                callbacks.forEach(cb => cb(meta));
                _pendingMetaCallbacks.delete(id);
            }
        },
    };
}
