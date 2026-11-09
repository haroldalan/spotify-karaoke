// Spotify's JSON formats: reading metadata/4 and color-lyrics, writing color-lyrics.
import type { FoundLyrics, TrackMeta } from '../shared/types';
import { hexToBase62 } from '../shared/spotifyId';

export const METADATA_URL = /^https:\/\/spclient\.wg\.spotify\.com\/metadata\/4\/track\/([0-9a-f]{32})/;
export const COLOR_LYRICS_URL = /^https:\/\/spclient\.wg\.spotify\.com\/color-lyrics\/v2\/track\/([0-9A-Za-z]{22})/;

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

/** A color-lyrics response for lyrics we found. Spotify takes the colours from the cover itself. */
export function buildColorLyrics(found: FoundLyrics, language: string | null) {
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
      providerDisplayName: found.source,
      syncLyricsUri: '',
      isDenseTypeface: false,
      alternatives: [],
      language: language ?? '',
      isRtlLanguage: false,
      capStatus: 'NONE',
      previewLines: lines.slice(0, 3),
      translationLanguages: [],
    },
    colors: { background: -11184811, text: -16777216, highlightText: -1 },
    hasVocalRemoval: false,
  };
}
