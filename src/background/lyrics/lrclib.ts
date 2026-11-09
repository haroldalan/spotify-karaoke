// LRCLIB (lrclib.net): open, crowd-sourced lyrics, synced when available.
import type { TrackMeta } from '../../shared/types';
import { durationOk, isMatch } from './match';

const BASE = 'https://lrclib.net/api';
// LRCLIB asks clients to identify themselves; browsers can't set User-Agent, so it accepts this header.
const HEADERS = { 'Lrclib-Client': 'Spotify Karaoke (https://github.com/haroldalan/spotify-karaoke)' };

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LrclibResult {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  return (await res.json()) as T;
}

const matches = (r: LrclibRecord, meta: TrackMeta) => isMatch(meta, { title: r.trackName, artist: r.artistName, durationS: r.duration });

/**
 * Every LRCLIB record for this song: the exact lookup, then the search. Records whose
 * duration is off by more than 3 s are left out.
 */
export async function lrclibCandidates(meta: TrackMeta, fetchImpl: typeof fetch = fetch, opts: { deep?: boolean } = {}): Promise<LrclibRecord[]> {
  const artist = meta.artists[0] ?? '';
  const exact = new URLSearchParams({
    track_name: meta.name,
    artist_name: artist,
    album_name: meta.album,
    duration: String(Math.round(meta.durationMs / 1000)),
  });
  const out = new Map<number, LrclibRecord>();
  const rec = await getJson<LrclibRecord>(`${BASE}/get?${exact}`, fetchImpl);
  if (rec && durationOk(meta.durationMs, rec.duration)) out.set(rec.id, rec);
  if (!opts.deep && rec?.syncedLyrics && out.size) return [...out.values()];
  const q = new URLSearchParams({ track_name: meta.name, artist_name: artist });
  for (const r of (await getJson<LrclibRecord[]>(`${BASE}/search?${q}`, fetchImpl)) ?? []) if (matches(r, meta)) out.set(r.id, r);
  if (!out.size || opts.deep) {
    const loose = new URLSearchParams({ q: `${meta.name} ${artist}` });
    for (const r of (await getJson<LrclibRecord[]>(`${BASE}/search?${loose}`, fetchImpl)) ?? []) if (matches(r, meta)) out.set(r.id, r);
  }
  return [...out.values()];
}

export async function lrclib(meta: TrackMeta, fetchImpl: typeof fetch = fetch): Promise<LrclibResult | null> {
  const all = await lrclibCandidates(meta, fetchImpl);
  const best = all.find((r) => r.syncedLyrics) ?? all.find((r) => r.plainLyrics) ?? all.find((r) => r.instrumental);
  if (!best) return null;
  return { synced: best.syncedLyrics || null, plain: best.plainLyrics || null, instrumental: !!best.instrumental };
}
