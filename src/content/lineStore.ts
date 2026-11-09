// The songs whose lyrics we have seen, with their processed versions. Results belong to
// their song: a lyrics list on screen is matched to the song it shares the most lines with
// (View), and decorated from that song only, so an identical line in another song (a
// kanji line in a Chinese and a Japanese song, "Tera" in two Hindi songs) never borrows
// the wrong romanization or restored script.
import type { Processed, Settings } from '../shared/types';
import { hash } from '../shared/hash';

export interface LineInfo {
  romanized?: string | null;
  /** By target language. */
  translated?: Record<string, string | null>;
}

type State = 'no' | 'pending' | 'done' | 'failed';

export interface Song {
  key: string;
  /** The song's lines (normalized), in the song's own script. */
  lines: string[];
  /**
   * Restored songs: the romanized lines Spotify shows, line for line with `lines`.
   * A list showing these is this song, drawn before its original script arrived.
   */
  shown?: string[];
  language: string | null;
  romanized: (string | null)[] | null;
  translated: Record<string, (string | null)[]>;
  romanizeState: State;
  translateState: Record<string, State>;
  translateError?: string;
  script?: string | null;
}

/** A line on screen, resolved against its song. */
export interface ResolvedLine {
  song: Song;
  /** The song's own line (original script). */
  original: string;
  /** True when the screen shows Spotify's romanized line rather than `original`. */
  aliased: boolean;
  info: LineInfo;
}

export type Processor = (req: { lines: string[]; language: string | null; romanize: boolean; translateTo: string | null }) => Promise<Processed>;

export const MAX_SONGS = 60;

export function normalizeLine(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export class LineStore {
  /** Least recently used first. */
  private songs = new Map<string, Song>();
  /** Line text (own or shown) -> keys of the songs that contain it. */
  private index = new Map<string, Set<string>>();
  private listeners = new Set<() => void>();
  private settings: Settings;

  constructor(private process: Processor, settings: Settings) {
    this.settings = settings;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  get size() {
    return this.songs.size;
  }

  /** Registers a song's lines (from Spotify, from us, or read off the screen). */
  addSong(rawLines: string[], language: string | null = null): Song {
    const lines = rawLines.map(normalizeLine);
    const key = hash(lines.join('\n'));
    let song = this.songs.get(key);
    if (song) {
      this.touch(song);
      if (language && !song.language) song.language = language;
    } else {
      song = { key, lines, language, romanized: null, translated: {}, romanizeState: 'no', translateState: {} };
      this.songs.set(key, song);
      this.indexSong(song);
      this.evict();
    }
    this.ensure(song);
    return song;
  }

  /**
   * A song restored line for line: `shown` is what Spotify drew (romanized), `native` the
   * same lines in the song's own script.
   */
  addRestored(shown: string[], native: string[], language: string | null): Song {
    const song = this.addSong(native, language);
    song.shown = shown.map(normalizeLine);
    this.indexSong(song);
    this.changed();
    return song;
  }

  /** Marks a song as just seen on screen. */
  touch(song: Song) {
    this.songs.delete(song.key);
    this.songs.set(song.key, song);
  }

  /**
   * The song a list of lines on screen belongs to: the one sharing the most lines with it,
   * the most recently seen on a tie. null: no known song shares a line.
   */
  songFor(texts: string[]): Song | null {
    const score = new Map<string, number>();
    for (const t of texts) {
      const n = normalizeLine(t);
      if (!n) continue;
      for (const key of this.index.get(n) ?? []) score.set(key, (score.get(key) ?? 0) + 1);
    }
    let best: Song | null = null;
    let bestScore = 0;
    let bestRank = -1;
    const ranks = new Map([...this.songs.keys()].map((k, i) => [k, i]));
    for (const [key, s] of score) {
      const rank = ranks.get(key) ?? -1;
      if (s > bestScore || (s === bestScore && rank > bestRank)) {
        best = this.songs.get(key) ?? null;
        bestScore = s;
        bestRank = rank;
      }
    }
    return best;
  }

  /** A line of a song, as shown on screen. */
  resolve(song: Song, text: string): ResolvedLine | null {
    const n = normalizeLine(text);
    if (!n) return null;
    let i = song.lines.indexOf(n);
    let aliased = false;
    if (i < 0 && song.shown) {
      i = song.shown.indexOf(n);
      aliased = i >= 0;
    }
    if (i < 0) return null;
    // A restored song's romanization is Spotify's own (licensed, written by people) when
    // it was restored line for line; ours otherwise.
    const spotifys = song.shown?.[i];
    const romanized = spotifys && spotifys !== song.lines[i] ? spotifys : song.romanized?.[i] ?? null;
    const info: LineInfo = { romanized, translated: {} };
    for (const [lang, tr] of Object.entries(song.translated)) info.translated![lang] = tr[i] ?? null;
    return { song, original: song.lines[i], aliased, info };
  }

  setSettings(s: Settings) {
    this.settings = s;
    // Newest songs first: they are the ones on screen.
    for (const song of [...this.songs.values()].reverse()) this.ensure(song);
    this.changed();
  }

  /** Whether this song still waits for what the current settings need. */
  status(song: Song | null): { pending: boolean; translateError?: string } {
    if (!song) return { pending: false };
    const want = this.wants();
    const pending = (want.romanize && song.romanizeState === 'pending') || (!!want.translateTo && song.translateState[want.translateTo] === 'pending');
    return { pending, translateError: song.translateError };
  }

  private indexSong(song: Song) {
    for (const t of [...song.lines, ...(song.shown ?? [])]) {
      if (!t) continue;
      let set = this.index.get(t);
      if (!set) this.index.set(t, (set = new Set()));
      set.add(song.key);
    }
  }

  private evict() {
    while (this.songs.size > MAX_SONGS) {
      const oldest = this.songs.values().next().value!;
      this.songs.delete(oldest.key);
      for (const t of [...oldest.lines, ...(oldest.shown ?? [])]) {
        const set = this.index.get(t);
        set?.delete(oldest.key);
        if (set && !set.size) this.index.delete(t);
      }
    }
  }

  private wants() {
    const s = this.settings;
    return {
      // Translated mode needs the romanization too: it stands in until the translation arrives.
      romanize: s.mode !== 'original' || s.showRomanized,
      translateTo: s.mode === 'translated' || s.showTranslation ? s.targetLang : null,
    };
  }

  private ensure(song: Song) {
    if (!song.lines.some((l) => l)) return;
    const want = this.wants();
    const romanize = want.romanize && (song.romanizeState === 'no' || song.romanizeState === 'failed');
    const translateTo = want.translateTo && !song.translateState[want.translateTo] ? want.translateTo : null;
    if (!romanize && !translateTo) return;
    if (romanize) song.romanizeState = 'pending';
    if (translateTo) song.translateState[translateTo] = 'pending';
    this.changed();
    this.process({ lines: song.lines, language: song.language, romanize, translateTo }).then(
      (p) => {
        song.script = p.script;
        song.translateError = p.translateError;
        if (romanize) {
          song.romanized = p.romanized;
          song.romanizeState = p.romanized ? 'done' : 'failed';
        }
        if (translateTo) {
          if (p.translated) {
            song.translated[translateTo] = p.translated;
            song.translateState[translateTo] = 'done';
          } else delete song.translateState[translateTo]; // failed: retry when asked again
        }
        this.changed();
      },
      (e) => {
        if (romanize) song.romanizeState = 'failed';
        if (translateTo) delete song.translateState[translateTo];
        song.translateError = String(e?.message || e);
        this.changed();
      },
    );
  }
}
