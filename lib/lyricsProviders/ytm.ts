// Port of: lyric-test/modules/background/ytm.js

import { nav, fetchWithTimeout } from './fetchUtils';

const YT_BASE = 'https://music.youtube.com/youtubei/v1';
// Fallback only — used if dynamic fetch fails
const YT_API_KEY_FALLBACK = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

// In-memory cache — lives for the service worker's lifespan
let cachedApiKey: string | null = null;
let currentKeySource: 'scraped' | 'fallback' = 'fallback';

export function getYtmKeySource(): string {
  return currentKeySource;
}

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  try {
    const res = await fetchWithTimeout('https://music.youtube.com/', {}, 8000);
    const html = await res.text();
    // ytcfg.set({"INNERTUBE_API_KEY":"AIza..."}) is always present in the page HTML
    const match = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    if (match?.[1]) {
      cachedApiKey = match[1];
      currentKeySource = 'scraped';
      console.log('[YTM] Dynamic API key acquired.');
      return cachedApiKey;
    }
  } catch (e) {
    console.warn('[YTM] Dynamic key fetch failed, using fallback.', e);
  }
  currentKeySource = 'fallback';
  return YT_API_KEY_FALLBACK;
}

const ANDROID_CONTEXT = {
  client: {
    clientName: 'ANDROID_MUSIC',
    clientVersion: '7.21.50',
    hl: 'en',
    gl: 'US',
    osName: 'Android',
    osVersion: '12',
  },
};

async function callYtmDirect(
  endpoint: string,
  payload: Record<string, unknown>,
  retried = false,
): Promise<unknown> {
  const key = await getApiKey();
  const response = await fetchWithTimeout(
    `${YT_BASE}/${endpoint}?alt=json&key=${key}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.music/7.21.50 (Linux; U; Android 12; en_US; Pixel 6) gzip',
      },
      body: JSON.stringify({ context: ANDROID_CONTEXT, ...payload }),
    },
  );

  if (response.status === 403 && !retried) {
    // Stale cached key — bust it and retry once with a freshly fetched key
    console.warn('[YTM] 403 received — busting cached key and retrying once.');
    cachedApiKey = null;
    return callYtmDirect(endpoint, payload, true);
  }

  if (!response.ok) throw new Error(`YTM HTTP Error: ${response.status}`);
  return response.json();
}

function findTypedVideoId(obj: unknown, type: string | null, depth = 0, visited = new Set<unknown>()): string | null {
  if (!obj || typeof obj !== 'object' || depth > 20 || visited.has(obj)) return null;
  visited.add(obj);
  const o = obj as Record<string, unknown>;

  if (o.musicResponsiveListItemRenderer) {
    const renderer = o.musicResponsiveListItemRenderer as Record<string, unknown>;
    const cols = (renderer.flexColumns as any[])?.[1]
      ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    const itemType = ((cols[0] as any)?.text || '').toLowerCase();

    if (type && itemType !== type) return null;
    return findTypedVideoId(renderer, null, depth + 1, visited);
  }

  if (o.musicCardShelfRenderer) {
    return findTypedVideoId(o.musicCardShelfRenderer, null, depth + 1, visited);
  }

  if (typeof o.videoId === 'string') return o.videoId;
  if (o.watchEndpoint && typeof (o.watchEndpoint as any).videoId === 'string') {
    return (o.watchEndpoint as any).videoId;
  }

  for (const key in o) {
    const found = findTypedVideoId(o[key], type, depth + 1, visited);
    if (found) return found;
  }
  return null;
}

function findRenderer(obj: unknown, name: string, depth = 0, visited = new Set<unknown>()): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object' || depth > 20 || visited.has(obj)) return null;
  visited.add(obj);
  const o = obj as Record<string, unknown>;
  if (o[name]) return o[name] as Record<string, unknown>;
  for (const key in o) {
    const found = findRenderer(o[key], name, depth + 1, visited);
    if (found) return found;
  }
  return null;
}

interface LrcLine {
  startTimeMs?: string | number;
  cueRange?: { startTimeMilliseconds?: string | number };
  text?: string;
  lyricLine?: string;
}

function convertToLRC(lyricsData: unknown): { lrc: string | null; plain: string | null } {
  const lines: LrcLine[] = Array.isArray(lyricsData)
    ? lyricsData
    : ((lyricsData as any)?.lines || (lyricsData as any)?.lyrics || []);
  
  if (!lines.length) return { lrc: null, plain: null };

  let validTimestamps = false;
  const formattedLines = lines.map((line) => {
    let ms = parseInt(String(line.startTimeMs ?? line.cueRange?.startTimeMilliseconds ?? ''));
    if (!isNaN(ms) && ms > 0) validTimestamps = true;
    if (isNaN(ms)) ms = 0;

    const min = Math.floor(ms / 60000);
    const sec = ((ms % 60000) / 1000).toFixed(2);
    const text = line.text || line.lyricLine || '';
    return `[${min.toString().padStart(2, '0')}:${sec.padStart(5, '0')}]${text}`;
  });

  const plain = lines
    .map((l) => l.text || l.lyricLine || '')
    .filter((t) => t.trim())
    .join('\n');

  if (!validTimestamps) return { lrc: null, plain: plain || null };
  return { lrc: formattedLines.join('\n'), plain: plain || null };
}

export interface YtmResult {
  syncedLyrics?: string;
  plainLyrics?: string;
  isSynced: boolean;
  source?: string;
  keySource?: string;
}

export async function fetchYtmLyrics(title: string, artist: string): Promise<YtmResult | null> {
  try {
    const cleanTitle = title.split(' (')[0].split(' - ')[0].trim();
    const cleanArtist = artist.split(',')[0].split(' feat.')[0].trim();

    console.log(`[YTM] Searching: ${cleanTitle} by ${cleanArtist}`);
    const searchRes = await callYtmDirect('search', {
      query: `${cleanTitle} ${cleanArtist}`,
      params: 'EgWKAQIIAWAB',
    });

    let videoId = findTypedVideoId(searchRes, 'song');
    if (!videoId) videoId = findTypedVideoId(searchRes, null);
    if (!videoId) return null;

    console.log(`[YTM] Video ID Found: ${videoId}`);
    const nextRes = await callYtmDirect('next', { videoId });

    const watchNextRenderer = nav(nextRes, [
      'contents',
      'singleColumnMusicWatchNextResultsRenderer',
      'tabbedRenderer',
      'watchNextTabbedResultsRenderer',
    ]) as { tabs?: any[] } | null;
    const tabs = watchNextRenderer?.tabs || [];
    const lyricsTab = tabs.find((t: any) => {
      const label = t.tabRenderer?.title || t.tabRenderer?.title?.runs?.[0]?.text;
      return typeof label === 'string' && label.toLowerCase() === 'lyrics';
    });

    const instantTimed = findRenderer(nextRes, 'musicTimedLyricsRenderer');
    if (instantTimed && (instantTimed.lyrics || instantTimed.timedLyricsData)) {
      console.log(`[YTM] Synced Lyrics Found in Next response!`);
      const { lrc, plain } = convertToLRC(instantTimed.lyrics || instantTimed.timedLyricsData);
      if (lrc || plain) {
        return {
          syncedLyrics: lrc || undefined,
          plainLyrics: (!lrc && plain) ? plain : undefined,
          isSynced: !!lrc,
          source: (instantTimed.footer as any)?.runs?.[0]?.text || 'YouTube Music',
          keySource: currentKeySource,
        };
      }
    }

    const browseId = (lyricsTab as any)?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
    if (!browseId) {
      console.log(`[YTM] No browseId found in lyrics tab.`);
      return null;
    }

    console.log(`[YTM] Valid Browse ID Found: ${browseId}`);
    const browseRes = await callYtmDirect('browse', { browseId });

    const TIMESTAMPED_LYRICS_PATH = [
      'contents', 'elementRenderer', 'newElement', 'type',
      'componentType', 'model', 'timedLyricsModel', 'lyricsData',
    ];
    const timedData = nav(browseRes, TIMESTAMPED_LYRICS_PATH) as Record<string, unknown> | null;

    if (timedData && timedData.timedLyricsData) {
      console.log(`[YTM] New format synced lyrics found.`);
      const { lrc, plain } = convertToLRC(timedData.timedLyricsData);
      if (lrc || plain) {
        return {
          syncedLyrics: lrc || undefined,
          plainLyrics: (!lrc && plain) ? plain : undefined,
          isSynced: !!lrc,
          source: timedData.sourceMessage as string || 'YouTube Music',
          keySource: currentKeySource,
        };
      }
    }

    const timedRenderer = findRenderer(browseRes, 'musicTimedLyricsRenderer');
    if (timedRenderer) {
      console.log(`[YTM] Legacy format synced lyrics found.`);
      const { lrc, plain } = convertToLRC(
        timedRenderer.lyrics || timedRenderer.timedRendererData || [],
      );
      if (lrc || plain) {
        return {
          syncedLyrics: lrc || undefined,
          plainLyrics: (!lrc && plain) ? plain : undefined,
          isSynced: !!lrc,
          source: (timedRenderer.footer as any)?.runs?.[0]?.text || 'YouTube Music',
          keySource: currentKeySource,
        };
      }
    }

    const plainRenderer = findRenderer(browseRes, 'musicDescriptionShelfRenderer');
    const lyrics = (plainRenderer?.description as any)?.runs?.[0]?.text;

    if (lyrics) {
      console.log(`[YTM] Plain lyrics found.`);
      return {
        plainLyrics: lyrics,
        isSynced: false,
        source: (plainRenderer?.footer as any)?.runs?.[0]?.text || 'YouTube Music',
        keySource: currentKeySource,
      };
    }

    console.log(`[YTM] Lyrics tab present but NO content found in browse response.`);
    return null;
  } catch (err) {
    console.error(`[YTM] Fetch Error:`, err);
    return null;
  }
}
