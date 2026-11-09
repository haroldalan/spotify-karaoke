/** What the main (highlighted) line shows. */
export type Mode = 'original' | 'romanized' | 'translated';

export interface Settings {
  mode: Mode;
  /** BCP-47 primary tag Google Translate understands, e.g. 'en', 'hi', 'zh-CN'. */
  targetLang: string;
  /** Lines shown beneath the main line (never the one already shown as main). */
  showOriginal: boolean;
  showRomanized: boolean;
  showTranslation: boolean;
  /** Find lyrics elsewhere when Spotify has none. */
  fillMissing: boolean;
  /** Replace romanized lyrics with the song's own script when a matching copy exists. */
  restoreNative: boolean;
  /** Show the on-page mode switcher. */
  showPill: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'romanized',
  targetLang: 'en',
  showOriginal: true,
  showRomanized: false,
  showTranslation: false,
  fillMissing: true,
  restoreNative: true,
  showPill: true,
};

/** Track metadata, from Spotify's metadata/4 response. */
export interface TrackMeta {
  /** base62 track id, as in spotify:track:<id>. */
  id: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  isrc?: string;
  /** language_of_performance, e.g. ['ja']. */
  languages: string[];
  hasLyrics: boolean;
}

export interface LyricLine {
  /** Start time in ms; 0 for every line of unsynced lyrics. */
  startMs: number;
  text: string;
}

export interface FoundLyrics {
  lines: LyricLine[];
  synced: boolean;
  /** Shown in Spotify's "Lyrics provided by" footer. */
  source: string;
}

export interface NativeResult {
  lines: LyricLine[];
  synced: boolean;
  source: string;
  /** Line i of Spotify's answer is line i of ours (same timings): the display can map text to text. */
  aligned: boolean;
}

/** Processed versions of a song's lines, index-aligned with the input. null: not applicable. */
export interface Processed {
  romanized: (string | null)[] | null;
  translated: (string | null)[] | null;
  /** Detected writing system of the song, e.g. 'Jpan' or 'Deva' (ISO 15924). */
  script: string | null;
  /** Why translation failed, when it did. */
  translateError?: string;
}
