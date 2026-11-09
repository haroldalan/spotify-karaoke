// YouTube Music lyrics (licensed, usually LyricFind; timed to the release).
//
// search (web client: clean titles, artists and durations) -> next -> browse.
// Timed lyrics are only served to the Android app's client, so next/browse are asked as
// that client first, then as the web client for plain lyrics.
//
// YouTube refuses requests that carry an extension's Origin, and the Android client
// expects the app's User-Agent. ytmHeaderRules() sets both, for this extension's own
// background requests only (tabIds: none), never for the user's YouTube Music tabs.
// The user chose to keep this source on 2026-11-09, knowing it is unofficial.
import type { LyricLine, TrackMeta } from '../../shared/types';
import { isMatch, parseClock } from './match';

const BASE = 'https://music.youtube.com/youtubei/v1';
/** Used when the current version can't be read from YouTube Music's homepage. */
const WEB_VERSION_FALLBACK = '1.20251103.01.00';
const WEB_VERSION_TTL = 24 * 3600_000;
let webVersion: { value: string; at: number } | null = null;

/** The web client's current version, read from YouTube Music's homepage once a day. */
async function webClientVersion(fetchImpl: typeof fetch): Promise<string> {
  if (webVersion && Date.now() - webVersion.at < WEB_VERSION_TTL) return webVersion.value;
  let value = WEB_VERSION_FALLBACK;
  try {
    const html = await (await fetchImpl('https://music.youtube.com/', { credentials: 'omit' })).text();
    value = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([\d.]+)"/.exec(html)?.[1] ?? value;
  } catch { /* fallback */ }
  webVersion = { value, at: Date.now() };
  return value;
}
const ANDROID = { client: { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50', hl: 'en', gl: 'US', osName: 'Android', osVersion: '12' } };
const ANDROID_UA = 'com.google.android.apps.youtube.music/7.21.50 (Linux; U; Android 12; en_US; Pixel 6) gzip';
const SONGS_ONLY = 'EgWKAQIIAWAB';
/** Marks Android-client requests so the header rule can tell them apart. */
const ANDROID_MARK = 'sk_client=android';

type Json = Record<string, unknown>;
type Client = 'web' | 'android';

/** Session rules for declarativeNetRequest. Call at every service worker start. */
export async function ytmHeaderRules(): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;
  // Only this extension's own background requests: never a tab, never another extension or site worker.
  const noTab = [chrome.tabs?.TAB_ID_NONE ?? -1];
  const ours = [chrome.runtime.id];
  const types = ['xmlhttprequest', 'other'] as chrome.declarativeNetRequest.ResourceType[];
  await dnr.updateSessionRules({
    removeRuleIds: [101, 102],
    addRules: [
      {
        id: 101,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            { header: 'origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
            { header: 'referer', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
          ],
        },
        condition: { urlFilter: '||music.youtube.com/youtubei/', tabIds: noTab, initiatorDomains: ours, resourceTypes: types },
      },
      {
        id: 102,
        priority: 2,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            { header: 'origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
            { header: 'referer', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
            { header: 'user-agent', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: ANDROID_UA },
          ],
        },
        condition: { urlFilter: `||music.youtube.com/youtubei/*${ANDROID_MARK}`, tabIds: noTab, initiatorDomains: ours, resourceTypes: types },
      },
    ],
  });
}

let rulesReady: Promise<void> | null = null;
/** Makes sure the header rules exist (once per worker lifetime; again after a failure). */
function ensureRules(): Promise<void> {
  rulesReady ??= (async () => {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr?.getSessionRules) return;
    const ids = new Set((await dnr.getSessionRules()).map((r) => r.id));
    if (!ids.has(101) || !ids.has(102)) await ytmHeaderRules();
  })().catch((e) => {
    rulesReady = null;
    throw e;
  });
  return rulesReady;
}

async function call(endpoint: string, body: Json, client: Client, fetchImpl: typeof fetch): Promise<Json> {
  if (typeof chrome !== 'undefined' && fetchImpl === fetch) await ensureRules();
  const mark = client === 'android' ? `&${ANDROID_MARK}` : '';
  const res = await fetchImpl(`${BASE}/${endpoint}?prettyPrint=false${mark}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: client === 'android' ? ANDROID : { client: { clientName: 'WEB_REMIX', clientVersion: await webClientVersion(fetchImpl), hl: 'en', gl: 'US' } }, ...body }),
  });
  if (!res.ok) throw new Error(`YouTube Music ${endpoint} (${client}) HTTP ${res.status}`);
  return (await res.json()) as Json;
}

function find(o: unknown, key: string, depth = 0): unknown {
  if (!o || typeof o !== 'object' || depth > 30) return undefined;
  const r = o as Json;
  if (key in r) return r[key];
  for (const k in r) {
    const f = find(r[k], key, depth + 1);
    if (f !== undefined) return f;
  }
  return undefined;
}

function findAll(o: unknown, key: string, out: unknown[] = [], depth = 0): unknown[] {
  if (!o || typeof o !== 'object' || depth > 30) return out;
  const r = o as Json;
  if (key in r) out.push(r[key]);
  for (const k in r) findAll(r[k], key, out, depth + 1);
  return out;
}

const runsText = (x: unknown) => ((x as { runs?: { text?: string }[] })?.runs ?? []).map((r) => r.text ?? '').join('');

export interface YtmSong { videoId: string; title: string; artist: string; durationS: number | null }

export function parseSearch(json: unknown): YtmSong[] {
  const songs: YtmSong[] = [];
  for (const item of findAll(json, 'musicResponsiveListItemRenderer') as Json[]) {
    const cols = ((item.flexColumns as Json[]) ?? []).map((c) => runsText((c.musicResponsiveListItemFlexColumnRenderer as Json)?.text));
    const videoId = find(item, 'videoId');
    if (typeof videoId !== 'string' || cols.length < 2) continue;
    const parts = cols[1].split(' • ').map((s) => s.trim());
    const durationS = parseClock(parts[parts.length - 1] ?? '');
    songs.push({ videoId, title: cols[0], artist: parts[0] ?? '', durationS });
  }
  return songs;
}

export interface YtmLyrics {
  lines: LyricLine[];
  synced: boolean;
  source: string;
}

function sourceLabel(raw: string): string {
  const s = raw.replace(/^Source:\s*/i, '').trim();
  return s ? `${s} via YouTube Music` : 'YouTube Music';
}

/** Lyrics from a browse response: timed (Android client) or plain. */
export function parseLyricsBrowse(json: unknown): YtmLyrics | null {
  const timed = find(json, 'timedLyricsData') as { lyricLine?: string; cueRange?: { startTimeMilliseconds?: string } }[] | undefined;
  if (Array.isArray(timed) && timed.length) {
    const lines = timed.map((t) => ({ startMs: Number(t.cueRange?.startTimeMilliseconds ?? 0), text: (t.lyricLine ?? '').trim() }));
    const synced = lines.some((l) => l.startMs > 0);
    return { lines, synced, source: sourceLabel(String(find(json, 'sourceMessage') ?? '')) };
  }
  const shelf = find(json, 'musicDescriptionShelfRenderer') as Json | undefined;
  const text = shelf ? runsText(shelf.description) : '';
  if (!text.trim()) return null;
  return {
    lines: text.split(/\r?\n/).map((t) => ({ startMs: 0, text: t.trim() })),
    synced: false,
    source: sourceLabel(runsText(shelf!.footer)),
  };
}

async function lyricsFor(videoId: string, client: Client, fetchImpl: typeof fetch): Promise<YtmLyrics | null> {
  const next = await call('next', { videoId }, client, fetchImpl);
  const tabs = (find(next, 'tabs') as Json[] | undefined) ?? [];
  const lyricsTab = tabs.find((t) => /lyrics/i.test(String((t.tabRenderer as Json)?.title ?? '')));
  const browseId = find(lyricsTab, 'browseId');
  if (typeof browseId !== 'string') return null;
  return parseLyricsBrowse(await call('browse', { browseId }, client, fetchImpl));
}

export async function ytm(meta: TrackMeta, fetchImpl: typeof fetch = fetch): Promise<YtmLyrics | null> {
  const search = await call('search', { query: `${meta.name} ${meta.artists[0] ?? ''}`, params: SONGS_ONLY }, 'web', fetchImpl);
  const song = parseSearch(search).find((s) => isMatch(meta, { title: s.title, artist: s.artist, durationS: s.durationS }));
  if (!song) return null;
  const timed = await lyricsFor(song.videoId, 'android', fetchImpl).catch(() => null);
  if (timed?.synced) return timed;
  return (await lyricsFor(song.videoId, 'web', fetchImpl).catch(() => null)) ?? timed;
}
