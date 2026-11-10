// Lyrics for a song Spotify has none for (or only unsynced ones).
// Sources are asked at once. Preference: YouTube Music synced (licensed, timed to the
// release) > LRCLIB synced > YouTube Music plain > LRCLIB plain.
import type { FoundLyrics, LyricLine, TrackMeta } from '../../shared/types';
import { cacheDelete, cacheGet, cacheSet, once } from '../cache';
import { hash } from '../../shared/hash';
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
  /** Nothing found, and LRCLIB lists the song as an instrumental. */
  instrumental?: boolean;
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
  return { found: null, complete, instrumental: !!lr?.instrumental };
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

const NONE_IDS = 'no-lyrics-ids';
const NONE_IDS_MAX = 1000;

/** Remembers which tracks have no lyrics anywhere, so pages don't claim lyrics for them. */
async function noteNone(id: string, none: boolean, at: number) {
  const ids = (await cacheGet<Record<string, number>>(NONE_IDS)) ?? {};
  if (none) ids[id] = at;
  else if (!(id in ids)) return;
  else delete ids[id];
  const keys = Object.keys(ids).sort((a, b) => ids[a] - ids[b]);
  for (const k of keys.slice(0, Math.max(0, keys.length - NONE_IDS_MAX))) delete ids[k];
  await cacheSet(NONE_IDS, ids);
}

const INSTRUMENTAL_IDS = 'instrumental-ids';

/** Remembers which tracks LRCLIB lists as instrumentals (pages leave Spotify's view as it is). */
async function noteInstrumental(id: string, yes: boolean, at: number) {
  const ids = (await cacheGet<Record<string, number>>(INSTRUMENTAL_IDS)) ?? {};
  if (yes) ids[id] = at;
  else if (!(id in ids)) return;
  else delete ids[id];
  const keys = Object.keys(ids).sort((a, b) => ids[a] - ids[b]);
  for (const k of keys.slice(0, Math.max(0, keys.length - NONE_IDS_MAX))) delete ids[k];
  await cacheSet(INSTRUMENTAL_IDS, ids);
}

/** Tracks known (within NONE_TTL) to be instrumentals. */
export async function knownInstrumental(now = Date.now()): Promise<string[]> {
  const ids = (await cacheGet<Record<string, number>>(INSTRUMENTAL_IDS)) ?? {};
  return Object.keys(ids).filter((id) => now - ids[id] < NONE_TTL);
}

/** Tracks known (within NONE_TTL) to have no lyrics anywhere. */
export async function knownNoLyrics(now = Date.now()): Promise<string[]> {
  const ids = (await cacheGet<Record<string, number>>(NONE_IDS)) ?? {};
  return Object.keys(ids).filter((id) => now - ids[id] < NONE_TTL);
}

// The details are part of the key: a request with a forged title can't overwrite the real song's entry.
export const lyricsKey = (meta: TrackMeta) => `lyr3:${meta.id}:${hash(`${meta.name}\n${meta.artists.join(',')}\n${Math.round(meta.durationMs / 1000)}`)}`;

/** "Search again": forgets what was found (or not) for this song, and asks the sources now. */
export async function retryLyrics(meta: TrackMeta, sources: Sources = DEFAULT_SOURCES): Promise<FoundLyrics | null> {
  await cacheDelete(lyricsKey(meta));
  await noteNone(meta.id, false, Date.now());
  await noteInstrumental(meta.id, false, Date.now());
  return findLyrics(meta, sources);
}

export function findLyrics(meta: TrackMeta, sources: Sources = DEFAULT_SOURCES, now = () => Date.now()): Promise<FoundLyrics | null> {
  const key = lyricsKey(meta);
  return once(key, async () => {
    const cached = await cacheGet<Stored>(key);
    if (cached && isFresh(cached, now())) return cached.found;
    const { found, complete, instrumental } = await searchLyrics(meta, sources).catch((): SearchResult => ({ found: null, complete: false }));
    const keep = better(found, cached?.found ?? null);
    // Kept older lyrics after an incomplete search: ask again soon rather than in a week.
    const at = keep && keep !== found && !complete ? now() - (keep.synced ? SYNCED_TTL : UNSYNCED_TTL) + UNREACHABLE_TTL : now();
    await cacheSet<Stored>(key, { found: keep, at, complete });
    await noteNone(meta.id, !keep && complete, at);
    await noteInstrumental(meta.id, !keep && complete && !!instrumental, at);
    return keep;
  });
}
