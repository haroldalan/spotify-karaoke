// Spotify's JSON formats: reading metadata/4 and color-lyrics, writing color-lyrics.
import type { FoundLyrics, TrackMeta } from '../shared/types';
import { hexToBase62 } from '../shared/spotifyId';
import { songScript } from '../shared/scripts';

const METADATA_PATH = /^\/metadata\/4\/track\/([0-9a-f]{32})/;
const COLOR_LYRICS_PATH = /^\/color-lyrics\/v2\/track\/([0-9A-Za-z]{22})/;
const GRAPHQL_PATH = /^\/pathfinder\/v\d+\/query/;

export type SpotifyRequest =
  | { kind: 'metadata'; gid: string }
  | { kind: 'lyrics'; id: string }
  | { kind: 'graphql' };

/**
 * What a request is, on any *.spotify.com host (spclient.wg.spotify.com, regional
 * gae2-spclient.spotify.com, api-partner.spotify.com ...). null: not ours to look at.
 */
export function classify(url: string): SpotifyRequest | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || (host !== 'spotify.com' && !host.endsWith('.spotify.com'))) return null;
  let m = METADATA_PATH.exec(u.pathname);
  if (m) return { kind: 'metadata', gid: m[1] };
  m = COLOR_LYRICS_PATH.exec(u.pathname);
  if (m) return { kind: 'lyrics', id: m[1] };
  if (GRAPHQL_PATH.test(u.pathname)) return { kind: 'graphql' };
  return null;
}

/** Track details found in any GraphQL response (album, playlist, search, now playing ...). */
export interface TrackHint {
  id: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
}

/**
 * Collects track objects from a GraphQL response: { uri: 'spotify:track:<id>', name,
 * artists.items[].profile.name, duration.totalMilliseconds, albumOfTrack.name }.
 * Bounded work: stops after `budget` objects.
 */
export function harvestTracks(json: unknown, budget = 50_000): TrackHint[] {
  const out: TrackHint[] = [];
  const stack: unknown[] = [json];
  let seen = 0;
  while (stack.length && seen++ < budget) {
    const o = stack.pop();
    if (!o || typeof o !== 'object') continue;
    if (Array.isArray(o)) { for (const x of o) stack.push(x); continue; }
    const r = o as Record<string, any>;
    if (typeof r.uri === 'string' && r.uri.startsWith('spotify:track:') && typeof r.name === 'string') {
      const id = r.uri.slice('spotify:track:'.length);
      const artists = ((r.artists?.items ?? r.firstArtist?.items ?? []) as any[]).map((a) => a?.profile?.name).filter((n): n is string => typeof n === 'string');
      const durationMs = Number(r.duration?.totalMilliseconds ?? r.trackDuration?.totalMilliseconds ?? 0);
      if (/^[0-9A-Za-z]{22}$/.test(id) && artists.length && durationMs > 0) {
        out.push({ id, name: r.name, artists, album: typeof r.albumOfTrack?.name === 'string' ? r.albumOfTrack.name : '', durationMs });
      }
    }
    for (const k in r) if (r[k] && typeof r[k] === 'object') stack.push(r[k]);
  }
  return out;
}

interface RawMeta {
  gid?: string;
  name?: string;
  album?: { name?: string };
  artist?: { name?: string }[];
  duration?: number;
  external_id?: { type?: string; id?: string }[];
  has_lyrics?: boolean;
  language_of_performance?: string[];
}

export function parseMeta(json: RawMeta): TrackMeta | null {
  const id = json.gid ? hexToBase62(json.gid) : null;
  if (!id || !json.name) return null;
  return {
    id,
    name: json.name,
    artists: (json.artist ?? []).map((a) => a.name ?? '').filter(Boolean),
    album: json.album?.name ?? '',
    durationMs: json.duration ?? 0,
    isrc: json.external_id?.find((e) => e.type === 'isrc')?.id,
    languages: json.language_of_performance ?? [],
    hasLyrics: json.has_lyrics === true,
  };
}

interface RawLine {
  startTimeMs?: string;
  words?: string;
}

export interface SpotifyLyrics {
  lines: string[];
  times: number[];
  syncType: string;
  language: string | null;
  provider: string;
}

export function parseColorLyrics(json: { lyrics?: { lines?: RawLine[]; syncType?: string; language?: string; provider?: string } }): SpotifyLyrics | null {
  const l = json.lyrics;
  if (!l?.lines) return null;
  return {
    lines: l.lines.map((x) => x.words ?? ''),
    times: l.lines.map((x) => Number(x.startTimeMs) || 0),
    syncType: l.syncType ?? '',
    language: l.language || null,
    provider: l.provider ?? '',
  };
}

/** Scripts Spotify sets isDenseTypeface for (tall glyphs, stacked marks): it gives their lines more height. */
const DENSE_SCRIPTS = new Set(['Jpan', 'Hani', 'Kore', 'Thai', 'Laoo', 'Khmr', 'Mymr', 'Deva', 'Beng', 'Guru', 'Gujr', 'Orya', 'Taml', 'Telu', 'Knda', 'Mlym', 'Sinh']);

/** Our credit in Spotify's own footer: "Lyrics provided by LRCLIB · Spotify Karaoke". */
export const creditFor = (source: string) => `${source} · Spotify Karaoke`;

/**
 * A color-lyrics response for lyrics we supply. `replacing`: Spotify's own response when
 * we replace it (restored script, synced upgrade), whose album colours are kept.
 */
export function buildColorLyrics(found: FoundLyrics, language: string | null, replacing?: { colors?: unknown; hasVocalRemoval?: unknown }) {
  const script = songScript(found.lines.map((l) => l.text));
  const lines = found.lines.map((l) => ({
    startTimeMs: String(found.synced ? l.startMs : 0),
    words: l.text,
    syllables: [],
    endTimeMs: '0',
    transliteratedWords: '',
  }));
  return {
    lyrics: {
      syncType: found.synced ? 'LINE_SYNCED' : 'UNSYNCED',
      lines,
      provider: 'spotify-karaoke',
      providerLyricsId: '0',
      providerDisplayName: creditFor(found.source),
      syncLyricsUri: '',
      isDenseTypeface: DENSE_SCRIPTS.has(script),
      alternatives: [],
      language: language ?? '',
      isRtlLanguage: script === 'Arab' || script === 'Hebr',
      capStatus: 'NONE',
      // The sidebar's preview card shows these: lines with words, not "♪" or blanks.
      previewLines: lines.filter((l) => /\p{L}/u.test(l.words)).slice(0, 3),
      translationLanguages: [],
    },
    colors: replacing?.colors ?? { background: -11184811, text: -16777216, highlightText: -1 },
    hasVocalRemoval: replacing?.hasVocalRemoval ?? false,
  };
}
