// Every song's lines we have seen, and their processed versions, addressed by line text.
// A line on screen reading X is decorated with whatever we know about X.
import type { Processed, Settings } from '../shared/types';
import { hash } from '../shared/hash';

export interface LineInfo {
  romanized?: string | null;
  /** By target language. */
  translated?: Record<string, string | null>;
}

interface Song {
  key: string;
  lines: string[];
  language: string | null;
  romanized: 'no' | 'pending' | 'done' | 'failed';
  translated: Record<string, 'pending' | 'done' | 'failed'>;
  translateError?: string;
  script?: string | null;
}

export type Processor = (req: { lines: string[]; language: string | null; romanize: boolean; translateTo: string | null }) => Promise<Processed>;

const MAX_SONGS = 60;

export function normalizeLine(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export class LineStore {
  private songs = new Map<string, Song>();
  private lines = new Map<string, LineInfo>();
  /** Spotify's romanized line -> the same line in the song's own script. */
  private aliases = new Map<string, string>();
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

  /** The original-script line for a romanized line Spotify shows, when known. */
  alias(text: string): string | undefined {
    return this.aliases.get(normalizeLine(text));
  }

  /** Registers line-for-line pairs (romanized -> original script). */
  addAliases(from: string[], to: string[]) {
    from.forEach((f, i) => {
      const a = normalizeLine(f);
      const b = normalizeLine(to[i] ?? '');
      if (a && b && a !== b) this.aliases.set(a, b);
    });
    while (this.aliases.size > 20000) this.aliases.delete(this.aliases.keys().next().value!);
    this.changed();
  }

  get(text: string): LineInfo | undefined {
    return this.lines.get(normalizeLine(text));
  }

  /** Registers a song's lines (from Spotify, from us, or read off the screen). */
  addSong(rawLines: string[], language: string | null = null): string {
    const lines = rawLines.map(normalizeLine);
    const key = hash(lines.join('\n'));
    const existing = this.songs.get(key);
    if (existing) {
      // Most recent last.
      this.songs.delete(key);
      this.songs.set(key, existing);
      if (language && !existing.language) existing.language = language;
    } else {
      this.songs.set(key, { key, lines, language, romanized: 'no', translated: {} });
      while (this.songs.size > MAX_SONGS) this.songs.delete(this.songs.keys().next().value!);
    }
    this.ensure(key);
    return key;
  }

  setSettings(s: Settings) {
    this.settings = s;
    // Newest songs first: they are the ones on screen.
    for (const key of [...this.songs.keys()].reverse()) this.ensure(key);
    this.changed();
  }

  /** Whether any song still waits for what the current settings need. */
  status(): { pending: boolean; translateError?: string; script?: string | null } {
    const want = this.wants();
    const last = [...this.songs.values()].pop();
    let pending = false;
    for (const s of this.songs.values()) {
      if (want.romanize && s.romanized === 'pending') pending = true;
      if (want.translateTo && s.translated[want.translateTo] === 'pending') pending = true;
    }
    return { pending, translateError: last?.translateError, script: last?.script };
  }

  private wants() {
    const s = this.settings;
    return {
      romanize: s.mode === 'romanized' || s.showRomanized,
      translateTo: s.mode === 'translated' || s.showTranslation ? s.targetLang : null,
    };
  }

  private ensure(key: string) {
    const song = this.songs.get(key);
    if (!song || !song.lines.some((l) => l)) return;
    const want = this.wants();
    const romanize = want.romanize && (song.romanized === 'no' || song.romanized === 'failed');
    const translateTo = want.translateTo && !song.translated[want.translateTo] ? want.translateTo : null;
    if (!romanize && !translateTo) return;
    if (romanize) song.romanized = 'pending';
    if (translateTo) song.translated[translateTo] = 'pending';
    this.changed();
    this.process({ lines: song.lines, language: song.language, romanize, translateTo }).then(
      (p) => {
        song.script = p.script;
        song.translateError = p.translateError;
        song.lines.forEach((line, i) => {
          if (!line) return;
          const info = this.lines.get(line) ?? {};
          if (romanize && p.romanized) info.romanized = p.romanized[i];
          if (translateTo && p.translated) (info.translated ??= {})[translateTo] = p.translated[i];
          this.lines.set(line, info);
        });
        if (romanize) song.romanized = p.romanized ? 'done' : 'failed';
        if (translateTo) {
          if (p.translated) song.translated[translateTo] = 'done';
          else delete song.translated[translateTo]; // failed: retry when asked again
        }
        if (this.lines.size > 20000) this.lines.clear();
        this.changed();
      },
      (e) => {
        if (romanize) song.romanized = 'failed';
        if (translateTo) delete song.translated[translateTo];
        song.translateError = String(e?.message || e);
        this.changed();
      },
    );
  }
}
