// Native-script restoration: Spotify serves some songs' lyrics romanized ("Mera dil tera
// hai") although the song is written in its own script (मेरा दिल तेरा है). Romanization and
// translation from the real script are far better, and the script is what fans expect.
//
// Whole copies are judged, never patched line by line (the owner's call, 2026-11-10): one
// source per song. Asked only when enough of Spotify's lines look romanized. A copy (YouTube
// Music's licensed one, each distinct LRCLIB upload) qualifies when
// - it is in the song's script (most of its lines),
// - it is the same song: most of Spotify's romanized lines are found in it, in order, by
//   content (and by time when both are timed), its romanization by us reading like them,
// - it doesn't trade synced lyrics for unsynced ones.
// It is used as it is, with its own timings. Licensed beats crowd-sourced; then the copy
// that covers more of the song. A copy whose lines match Spotify's one for one can also be
// put over Spotify's lines when it arrives after Spotify drew them (overlay).
import type { LyricLine, NativeResult, TrackMeta } from '../../shared/types';
export type { NativeResult };
import { expectedScript, scriptShare, songScript, type Script } from '../../shared/scripts';
import { hasRomanizedPart, looksRomanized } from '../../shared/lineMix';
import { cacheGet, cacheSet, once } from '../cache';
import { hash } from '../../shared/hash';
import { romanizeLines } from '../text/romanize';
import type { LicensedLyrics } from './find';
import { lrclibCandidates } from './lrclib';
import { ytm } from './ytm';
import { parseLrc, plainLines } from './lrc';

export interface NativeRequest {
  meta: TrackMeta;
  /** Spotify's (romanized) lines and their start times. */
  lines: string[];
  times: number[];
  synced: boolean;
}


export interface NativeSources {
  lrclib: (meta: TrackMeta) => Promise<{ lines: LyricLine[]; synced: boolean; durationKnown: boolean }[]>;
  ytm?: (meta: TrackMeta) => Promise<LicensedLyrics | null>;
  romanize: (lines: string[], script: Script) => Promise<(string | null)[]>;
}

/** A copy's line, romanized by us, must read at least this much like Spotify's to count as found. */
const LINE_MIN = 0.45;
/** At least this share of Spotify's romanized lines must be found in the copy: the same song. */
const COVER_MIN = 0.6;
/** A line is in the song's script when at least this share of its letters are. */
const SCRIPT_MIN = 0.5;
/** At least this share of the copy's lines must be in the song's script. */
const SCRIPT_FIT_MIN = 0.5;
/** How early a native line may start relative to the Spotify line it belongs to. */
const TIME_SLACK_MS = 1500;
/** Distinct copies tried at most (LRCLIB often holds a dozen identical uploads). */
const MAX_COPIES = 8;

/** Consonant skeleton: what survives every romanization scheme ("thangamae" ~ "thangame"). */
export function skeleton(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/([kgcjtdpbs])h/g, '$1')
    .replace(/zh/g, 'l')
    .replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/f/g, 'p').replace(/x/g, 'ks')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

/** Dice coefficient of consonant-skeleton bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = skeleton(a);
  const y = skeleton(b);
  if (!x && !y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const A = bigrams(x);
  const B = bigrams(y);
  let common = 0;
  for (const [k, n] of A) common += Math.min(n, B.get(k) ?? 0);
  return (2 * common) / (x.length - 1 + y.length - 1);
}

const worded = (lines: string[]) => lines.map((l, i) => ({ l: l.trim(), i })).filter((x) => /\p{L}/u.test(x.l));

type Worded = { l: string; i: number }[];

/** Share of a's consonant-skeleton bigrams found in b: how much of a copy's line is in Spotify's. */
function containment(a: string, b: string): number {
  const x = skeleton(a);
  const y = skeleton(b);
  if (x.length < 2) return x && y.includes(x) ? 1 : 0;
  const A = bigrams(x);
  const B = bigrams(y);
  let common = 0;
  for (const [k, n] of A) common += Math.min(n, B.get(k) ?? 0);
  return common / (x.length - 1);
}

/** Below this, a copy's line is better left out than paired (an extra line, an interlude). */
const PAIR_MIN = 0.45;
/** Each copy line merged into one of Spotify's lines must be at least this much inside it. */
const MEMBER_MIN = 0.5;

/**
 * Which of the copy's lines (indices into `native`) belong to each of Spotify's lines: an
 * in-order alignment that pairs each copy line with the Spotify line its romanization reads
 * most like (several copy lines may share one: the copy split it), and leaves out lines that
 * fit nowhere. With both copies timed, a pair must also start near the Spotify line's span.
 * O(copy lines x Spotify lines): about 2,500 cells for a song.
 */
function pairByAlignment(req: NativeRequest, cand: { lines: LyricLine[]; synced: boolean }, native: Worded, spotify: Worded, rom: string[]): number[][] {
  const n = native.length;
  const m = spotify.length;
  const timed = req.synced && cand.synced;
  const start = spotify.map((x) => req.times[x.i] ?? 0);
  const gain = (k: number, j: number): number => {
    if (timed) {
      const t = cand.lines[native[k].i].startMs;
      const end = j + 1 < m ? start[j + 1] : Infinity;
      if (t < start[j] - TIME_SLACK_MS || t >= end + TIME_SLACK_MS) return -Infinity;
    }
    return containment(rom[k], spotify[j].l) - PAIR_MIN;
  };
  // best[k][j]: the best total for the copy's first k lines, all paired at or before Spotify line j.
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m).fill(-Infinity));
  const from = Array.from({ length: n + 1 }, () => new Int8Array(m)); // 0 skip line, 1 pair with j, 2 carried from j-1
  for (let j = 0; j < m; j++) best[0][j] = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < m; j++) {
      let v = best[k][j];
      let how = 0;
      const g = best[k][j] + gain(k, j);
      if (g > v) { v = g; how = 1; }
      if (j > 0 && best[k + 1][j - 1] > v) { v = best[k + 1][j - 1]; how = 2; }
      best[k + 1][j] = v;
      from[k + 1][j] = how;
    }
  }
  const groups: number[][] = spotify.map(() => []);
  let k = n;
  let j = m - 1;
  while (k > 0 && j >= 0) {
    const how = from[k][j];
    if (how === 2) { j--; continue; }
    if (how === 1) groups[j].unshift(k - 1);
    k--;
  }
  return groups;
}

/** A copy's fit: the result, and how good it is. */
export type Fitted = NativeResult & { coverage: number; scriptFit: number };

/** Whether Spotify's line j is found in the copy: its paired lines read like it, and each belongs. */
function found(spotifyLine: string, group: number[], rom: string[]): boolean {
  const g = [...group];
  if (!g.length) return false;
  const groupSim = (ks: number[]) => similarity(ks.map((k) => rom[k]).join(' '), spotifyLine);
  // A copy line that makes the group read less like Spotify's line isn't part of it.
  for (let changed = true; changed && g.length > 1;) {
    changed = false;
    for (let q = 0; q < g.length && g.length > 1; q++) {
      if (groupSim(g.filter((_, w) => w !== q)) > groupSim(g) + 0.02) { g.splice(q, 1); changed = true; break; }
    }
  }
  return groupSim(g) >= LINE_MIN && g.every((k) => containment(rom[k], spotifyLine) >= MEMBER_MIN);
}

/** Judges one copy as the song's lyrics, whole. */
export async function fit(
  req: NativeRequest,
  cand: { lines: LyricLine[]; synced: boolean; source: string },
  script: Script,
  romanize: NativeSources['romanize'],
): Promise<Fitted | null> {
  const native = worded(cand.lines.map((l) => l.text));
  const spotify = worded(req.lines);
  if (!native.length || !spotify.length) return null;
  // Never synced lyrics traded for unsynced ones.
  if (req.synced && !cand.synced) return null;
  if (songScript(native.map((x) => x.l)) !== script) return null;
  const scriptFit = native.filter((x) => scriptShare(x.l, script) >= SCRIPT_MIN).length / native.length;
  if (scriptFit < SCRIPT_FIT_MIN) return null;
  const rom = (await romanize(native.map((x) => x.l), script)).map((r, k) => r ?? native[k].l);

  // The same song: Spotify's romanized lines found in the copy, in order.
  const romanizedLines = spotify.map((x, j) => (looksRomanized(x.l) ? j : -1)).filter((j) => j >= 0);
  if (!romanizedLines.length) return null;
  const pairs = pairByAlignment(req, cand, native, spotify, rom);
  const coverage = romanizedLines.filter((j) => found(spotify[j].l, pairs[j], rom)).length / romanizedLines.length;
  if (coverage < COVER_MIN) return null;

  // One for one with Spotify's lines: can also go over them if it comes late.
  let overlay: string[] | undefined;
  if (native.length === spotify.length) {
    const byPosition = romanizedLines.filter((j) => found(spotify[j].l, [j], rom)).length / romanizedLines.length;
    if (byPosition >= COVER_MIN) {
      overlay = [...req.lines];
      spotify.forEach((x, k) => (overlay![x.i] = native[k].l));
    }
  }
  return {
    // The copy as it is: its own timings when synced (both unsynced: no timings to keep).
    lines: cand.lines,
    synced: cand.synced,
    source: cand.source,
    aligned: !!overlay,
    ...(overlay ? { overlay } : {}),
    coverage,
    scriptFit,
  };
}

/** searchNative's answer: complete is false when a source failed, so "none" isn't final. */
export interface NativeSearch {
  result: NativeResult | null;
  complete: boolean;
}

/** Better of two copies: licensed beats crowd-sourced; then the one covering more of the song. */
function better(a: Fitted | null, b: Fitted): boolean {
  if (!a) return true;
  const licensed = (f: Fitted) => f.source !== 'LRCLIB';
  if (licensed(a) !== licensed(b)) return licensed(b);
  if (Math.abs(b.coverage - a.coverage) > 0.02) return b.coverage > a.coverage;
  if (b.scriptFit !== a.scriptFit) return b.scriptFit > a.scriptFit;
  return b.aligned && !a.aligned;
}

export async function searchNative(req: NativeRequest, sources: NativeSources): Promise<NativeSearch> {
  const script = expectedScript(req.meta.languages);
  // Enough of Spotify's lines are romanized to look (multilingual songs mix scripts and English).
  if (!script || !hasRomanizedPart(req.lines)) return { result: null, complete: true };
  let complete = true;
  // Both sources are asked at once (a song's first play has seconds, not minutes).
  const ytP = sources.ytm ? sources.ytm(req.meta).catch(() => { complete = false; return null; }) : Promise.resolve(null);
  const lrP = sources.lrclib(req.meta).catch(() => { complete = false; return []; });
  const [yt, lrAll] = await Promise.all([ytP, lrP]);
  // LRCLIB's copies need a known duration (matched to this recording); synced first; identical
  // uploads judged once.
  const lr = lrAll.filter((c) => c.durationKnown).sort((a, b) => Number(b.synced) - Number(a.synced));
  const copies = [...(yt ? [yt] : []), ...lr.map((c) => ({ ...c, source: 'LRCLIB' }))];
  const seen = new Set<string>();
  let best: Fitted | null = null;
  for (const c of copies) {
    const key = `${c.synced}\n${c.lines.map((l) => l.text).join('\n')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_COPIES) break;
    const r = await fit(req, c, script, sources.romanize);
    if (r && better(best, r)) best = r;
  }
  if (!best) return { result: null, complete };
  const { coverage: _c, scriptFit: _s, ...result } = best;
  return { result, complete };
}

async function lrclibNative(meta: TrackMeta) {
  const records = await lrclibCandidates(meta, fetch, { deep: true });
  return records.flatMap((r) => {
    const durationKnown = typeof r.duration === 'number' && r.duration > 0;
    const out: { lines: LyricLine[]; synced: boolean; durationKnown: boolean }[] = [];
    if (r.syncedLyrics) out.push({ lines: parseLrc(r.syncedLyrics), synced: true, durationKnown });
    else if (r.plainLyrics) out.push({ lines: plainLines(r.plainLyrics), synced: false, durationKnown });
    return out;
  });
}

const DEFAULT_SOURCES: NativeSources = {
  lrclib: lrclibNative,
  ytm,
  // Scoring only (similarity of consonant skeletons): local romanizers, or a transliteration,
  // never Google; trying several copies must not cost several Google requests.
  romanize: (lines, script) => romanizeLines(lines, script, { google: async () => { throw new Error('local only'); } }),
};

const FOUND_TTL = 30 * 24 * 3600_000;
const NONE_TTL = 3 * 24 * 3600_000;
/** A source failed: look again soon. */
const UNREACHABLE_TTL = 30 * 60_000;

export function restoreNative(req: NativeRequest, sources: NativeSources = DEFAULT_SOURCES): Promise<NativeResult | null> {
  const key = `nat:${req.meta.id}:${hash(`${req.meta.name}\n${req.lines.join('\n')}`)}`;
  return once(key, async () => {
    const cached = await cacheGet<NativeResult | { none: true }>(key);
    if (cached) return 'none' in cached ? null : cached;
    const { result, complete } = await searchNative(req, sources).catch(() => ({ result: null, complete: false }));
    await cacheSet(key, result ?? { none: true }, result ? FOUND_TTL : complete ? NONE_TTL : UNREACHABLE_TTL);
    return result;
  });
}
