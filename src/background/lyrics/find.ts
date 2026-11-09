// Lyrics for a song Spotify has none for (or only unsynced ones).
// Sources are asked at once. Preference: YouTube Music synced (licensed, timed to the
// release) > LRCLIB synced > YouTube Music plain > LRCLIB plain.
import type { FoundLyrics, LyricLine, TrackMeta } from '../../shared/types';
import { cacheGet, cacheSet, once } from '../cache';
import { lrclib } from './lrclib';
import { parseLrc, plainLines } from './lrc';
import { ytm } from './ytm';

/** Synced lyrics: rarely improve. */
const SYNCED_TTL = 30 * 24 * 3600_000;
/** Unsynced lyrics: looked up again after a week, in case a synced copy appeared. */
const UNSYNCED_TTL = 7 * 24 * 3600_000;
/** Every source answered and none had the song. */
const NONE_TTL = 3 * 24 * 3600_000;
/** A source could not be reached: try again soon. */
const UNREACHABLE_TTL = 30 * 60_000;

export interface LicensedLyrics { lines: LyricLine[]; synced: boolean; source: string }

export interface Sources {
  lrclib: typeof lrclib;
  /** Licensed lyrics (YouTube Music). */
  ytm?: (meta: TrackMeta) => Promise<LicensedLyrics | null>;
}

export const DEFAULT_SOURCES: Sources = { lrclib, ytm };

export interface SearchResult {
  found: FoundLyrics | null;
  /** False when a source failed, so "not found" is not final. */
  complete: boolean;
}

const hasWords = (lines: { text: string }[]) => lines.some((l) => l.text);

export async function searchLyrics(meta: TrackMeta, sources: Sources = DEFAULT_SOURCES): Promise<SearchResult> {
  const [l, y] = await Promise.allSettled([sources.lrclib(meta), sources.ytm ? sources.ytm(meta) : Promise.resolve(null)]);
  const lr = l.status === 'fulfilled' ? l.value : null;
  const yt = y.status === 'fulfilled' ? y.value : null;
  const complete = l.status === 'fulfilled' && y.status === 'fulfilled';
  const lrSynced = lr?.synced ? parseLrc(lr.synced) : null;

  if (yt?.synced && hasWords(yt.lines)) return { found: { lines: yt.lines, synced: true, source: yt.source }, complete };
  if (lrSynced && hasWords(lrSynced)) return { found: { lines: lrSynced, synced: true, source: 'LRCLIB' }, complete };
  if (yt && hasWords(yt.lines)) return { found: { lines: yt.lines, synced: false, source: yt.source }, complete };
  if (lr?.plain) return { found: { lines: plainLines(lr.plain), synced: false, source: 'LRCLIB' }, complete };
  return { found: null, complete };
}

interface Stored {
  found: FoundLyrics | null;
  /** When the sources were last asked. */
  at: number;
  /** Every source answered. */
  complete: boolean;
}

function isFresh(s: Stored, now: number): boolean {
  const ttl = s.found ? (s.found.synced ? SYNCED_TTL : UNSYNCED_TTL) : s.complete ? NONE_TTL : UNREACHABLE_TTL;
  return now - s.at < ttl;
}

/** The better of a new search result and what was found before: never trade lyrics for none, or synced for unsynced. */
export function better(next: FoundLyrics | null, before: FoundLyrics | null): FoundLyrics | null {
  if (!next) return before;
  if (!before) return next;
  return before.synced && !next.synced ? before : next;
}

export function findLyrics(meta: TrackMeta, sources: Sources = DEFAULT_SOURCES, now = () => Date.now()): Promise<FoundLyrics | null> {
  const key = `lyr3:${meta.id}`;
  return once(key, async () => {
    const cached = await cacheGet<Stored>(key);
    if (cached && isFresh(cached, now())) return cached.found;
    const { found, complete } = await searchLyrics(meta, sources).catch(() => ({ found: null, complete: false }));
    const keep = better(found, cached?.found ?? null);
    // Kept older lyrics after an incomplete search: ask again soon rather than in a week.
    const at = keep && keep !== found && !complete ? now() - (keep.synced ? SYNCED_TTL : UNSYNCED_TTL) + UNREACHABLE_TTL : now();
    await cacheSet<Stored>(key, { found: keep, at, complete });
    return keep;
  });
}
