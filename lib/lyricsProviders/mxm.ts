import type { SubtitleLine } from '../lyrics/subtitleParser';
import { parseSubtitle } from '../lyrics/subtitleParser';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackMetadata {
  name: string;
  artist: string;
}

export interface MxmProvider {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MXM_APP_ID = 'web-desktop-app-v1.0';
const MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';
const MXM_USER_AGENT = 'Musixmatch/1.0 (com.musixmatch.android.lyricscatcher; build:2022051201; Android 12)';

// ─── State ───────────────────────────────────────────────────────────────────

let _tokenCache: string | null = null;
let _tokenExpiry = 0;
let _tokenPromise: Promise<string | null> | null = null;
let _tokenFailCount = 0;
let _lastTokenFailTime = 0;

const _metadataCache = new Map<string, TrackMetadata>();
const _pendingMetaCallbacks = new Map<string, Array<(m: TrackMetadata) => void>>();
const _currentInterceptGeneration = new Map<string, number>();

const MAP_CAP = 200;

function capMap<K, V>(map: Map<K, V>): void {
  if (map.size > MAP_CAP) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

// ─── Token Management ────────────────────────────────────────────────────────

async function getToken(forceNew = false): Promise<string | null> {
  if (forceNew) {
    _tokenCache = null;
    _tokenExpiry = 0;
  }

  // 1. Try Memory
  if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;

  // 2. Try Persistent Storage
  if (!_tokenCache) {
    const stored = await browser.storage.local.get(['skl_mxm_token', 'skl_mxm_token_expiry']);
    if (stored.skl_mxm_token && Date.now() < (stored.skl_mxm_token_expiry || 0)) {
      _tokenCache = stored.skl_mxm_token as string;
      _tokenExpiry = stored.skl_mxm_token_expiry as number;
      return _tokenCache;
    }
  }

  // 3. Deduplicate Network Fetch
  if (_tokenPromise) return _tokenPromise;

  // Exponential backoff
  const now = Date.now();
  const cooldowns = [0, 30000, 60000, 300000];
  const waitTime = cooldowns[Math.min(_tokenFailCount, cooldowns.length - 1)];
  if (now - _lastTokenFailTime < waitTime) {
    console.warn('[MXM] Token backoff active. Wait time remaining:', Math.round((waitTime - (now - _lastTokenFailTime)) / 1000), 's');
    return null;
  }

  _tokenPromise = (async (): Promise<string | null> => {
    try {
      const url = `${MXM_BASE}/token.get?app_id=${MXM_APP_ID}&format=json`;
      console.log('[MXM] Fetching fresh token...');
      const res = await fetch(url, {
        headers: { 'User-Agent': MXM_USER_AGENT }
      });
      const data = await res.json() as any;
      const token = data?.message?.body?.user_token as string | undefined;

      if (token && !token.startsWith('UpgradeRequired')) {
        _tokenCache = token;
        _tokenExpiry = Date.now() + 55 * 60 * 1000;
        _tokenFailCount = 0;
        await browser.storage.local.set({ 
          skl_mxm_token: token, 
          skl_mxm_token_expiry: _tokenExpiry 
        });
        console.log('[MXM] Token acquired and persisted.');
        return token;
      } else {
        console.error('[MXM] Token rejected:', JSON.stringify(data, null, 2));
        _tokenFailCount++;
        _lastTokenFailTime = Date.now();
      }
    } catch (e) {
      console.error('[MXM] Token acquisition failed:', e);
      _tokenFailCount++;
      _lastTokenFailTime = Date.now();
    }
    return null;
  })();

  const result = await _tokenPromise;
  _tokenPromise = null;
  return result;
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function mxmFetch(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<any | null> {
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

  const options = {
    headers: {
      'User-Agent': MXM_USER_AGENT,
      'Origin': 'https://www.musixmatch.com'
    }
  };

  try {
    let res = await fetch(buildUrl(token), options);
    let data = await res.json() as any;

    if (res.status === 429 || data?.message?.header?.status_code === 429) {
      console.warn('[MXM] Rate limited (429). Retrying in 2s...');
      await new Promise(r => setTimeout(r, 2000));
      res = await fetch(buildUrl(token), options);
      data = await res.json();
    }

    if (data?.message?.header?.status_code === 401 || data?.message?.header?.status_code === 402) {
      console.warn('[MXM] Token expired or invalid (401/402). Forcing refresh...');
      token = await getToken(true);
      if (!token) return null;
      res = await fetch(buildUrl(token), options);
      data = await res.json();
    }

    if (data?.message?.header?.status_code === 200) return data;
    console.error(`[MXM] API Error ${data?.message?.header?.status_code} on ${path}`, data);
  } catch (e) {
    console.error(`[MXM] Fetch failed on ${path}:`, e);
  }
  return null;
}

// ─── Search Strategies ───────────────────────────────────────────────────────

async function fetchSubtitle(commontrackId: string | null): Promise<SubtitleLine[] | null> {
  if (!commontrackId) return null;
  const data = await mxmFetch('/track.subtitle.get', {
    subtitle_format: 'mxm',
    commontrack_id: commontrackId,
  });
  const lines = parseSubtitle(data);
  return lines ? lines.map(line => ({ ...line, words: line.words || '♪' })) : null;
}

async function fetchSubtitleByTrackId(trackId: number | string): Promise<SubtitleLine[] | null> {
  const data = await mxmFetch('/track.subtitle.get', {
    subtitle_format: 'mxm',
    track_id: trackId,
  });
  const lines = parseSubtitle(data);
  return lines ? lines.map(line => ({ ...line, words: line.words || '♪' })) : null;
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
  if (!list || list.length === 0) return null;
  
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

function verifyNativeScript(lines: SubtitleLine[]): boolean {
  const NATIVE_REGEX = /[\u0900-\u0DFF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F]/g;
  const sample = lines.slice(0, 15).map(l => l.words).join(' ');
  const matches = sample.match(NATIVE_REGEX);
  return (matches ? matches.length : 0) > 10;
}

// ─── Public Provider Interface ───────────────────────────────────────────────

export const mxmProvider: MxmProvider = {
  async fetchNativeLines(providerLyricsId, spotifyTrackId, hexGid, interceptId) {
    const isStale = () => (_currentInterceptGeneration.get(spotifyTrackId) || 0) !== interceptId;

    // Strategy 1: Direct ID
    const fromId = await fetchSubtitle(providerLyricsId);
    if (isStale()) return null;
    if (fromId && verifyNativeScript(fromId)) return fromId;

    // Strategy 2: Spotify Track Linkage
    const trackData = await mxmFetch('/track.get', { track_spotify_id: spotifyTrackId });
    if (isStale()) return null;
    const body = (trackData as any)?.message?.body?.track;
    if (body) {
      const trackName = (body.track_name || '').toLowerCase();
      const isEnglishVersion = trackName.includes('(english version)') || trackName.includes('english ver.');
      if (!isEnglishVersion) {
        const fromTrackId = await fetchSubtitleByTrackId(body.track_id);
        if (isStale()) return null;
        if (fromTrackId && verifyNativeScript(fromTrackId)) return fromTrackId;
      }
    }

    // Strategy 3: Metadata Search
    const meta = _metadataCache.get(hexGid);
    if (meta) {
      const fromSearch = await fetchSubtitleBySearch(meta.name, meta.artist);
      if (isStale()) return null;
      if (fromSearch && verifyNativeScript(fromSearch)) return fromSearch;
    }

    // Strategy 4: Unsynced Fallback
    const unsynced = await fetchUnsyncedLyrics(providerLyricsId);
    if (isStale()) return null;
    if (unsynced && verifyNativeScript(unsynced)) return unsynced;

    return null;
  },

  notifyMetadata(id, name, artist) {
    capMap(_metadataCache);
    _metadataCache.set(id, { name, artist });
    const callbacks = _pendingMetaCallbacks.get(id);
    if (callbacks) {
      callbacks.forEach(cb => cb({ name, artist }));
      _pendingMetaCallbacks.delete(id);
    }
  },

  newInterception(spotifyTrackId) {
    const nextGen = (_currentInterceptGeneration.get(spotifyTrackId) || 0) + 1;
    capMap(_currentInterceptGeneration);
    _currentInterceptGeneration.set(spotifyTrackId, nextGen);
    return nextGen;
  },

  warmup() {
    getToken();
  }
};
