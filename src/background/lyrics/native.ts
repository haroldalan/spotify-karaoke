// Native-script restoration: Spotify serves some songs' lyrics romanized ("Mera dil tera
// hai") although the song is written in its own script (मेरा दिल तेरा है). Romanization and
// translation from the real script are far better, and the script is what fans expect.
//
// Decided line by line, never for the whole song (PROBLEM.md: songs mix languages; Spotify
// romanizes some lines and not others; English lines belong in Latin script):
// - Lines are paired by start time (both copies timed to the same recording), or by position
//   when the copies have the same lines and no timings to go by.
// - A line is replaced only when Spotify's is romanized (Latin letters, not English), the
//   copy's is in the song's script, and the copy romanized by us reads like Spotify's line.
//   Every other line stays exactly as Spotify has it, with Spotify's timings.
// - A copy is refused when too few of the lines both have in comparable form agree (another
//   version, or pairs out of step).
// - Every copy (YouTube Music's licensed one, each distinct LRCLIB one) is tried; the one that
//   improves the most lines wins.
// When lines can't be paired, a synced copy of a song Spotify has wholly in Latin letters,
// close in length and reading like it as a whole, is used with its own timings. Anything less
// is refused: romanized lyrics in sync beat native lyrics out of sync.
import type { LyricLine, NativeResult, TrackMeta } from '../../shared/types';
export type { NativeResult };
import { expectedScript, isLatinLine, scriptShare, songScript, type Script } from '../../shared/scripts';
import { isEnglishLine } from '../../shared/english';
import { hasRomanizedPart } from '../../shared/lineMix';
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

/** A line's romanized copy must read at least this much like Spotify's line to replace it. */
const LINE_MIN = 0.45;
/** Of the lines both copies have in comparable form, at least this share must agree. */
const AGREE_MIN = 0.6;
/** The copy's line must have at least this share of its letters in the song's script. */
const SCRIPT_MIN = 0.5;
const SONG_MIN = 0.5;
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

const pairByPosition = (spotify: Worded): number[][] => spotify.map((_, k) => [k]);

/** A copy fitted line by line: which lines it improves, and how well they agree. */
interface LineFit {
  text: string[];
  replaced: number;
  /** Mean similarity of the replaced lines. */
  score: number;
}

function fitLines(req: NativeRequest, native: Worded, spotify: Worded, rom: string[], pairs: number[][], script: Script): LineFit | null {
  const text = [...req.lines];
  let comparable = 0;
  let replaced = 0;
  let sum = 0;
  spotify.forEach((x, j) => {
    const g = [...pairs[j]];
    if (!g.length) return;
    // A copy line that makes the group read less like Spotify's line isn't part of it (a
    // neighbour's line the timing let in): left out.
    const groupSim = (ks: number[]) => similarity(ks.map((k) => rom[k]).join(' '), x.l);
    for (let changed = true; changed && g.length > 1;) {
      changed = false;
      for (let q = 0; q < g.length && g.length > 1; q++) {
        const without = g.filter((_, w) => w !== q);
        if (groupSim(without) > groupSim(g) + 0.02) { g.splice(q, 1); changed = true; break; }
      }
    }
    const nat = g.map((k) => native[k].l).join(' ');
    // Only a romanized line of Spotify's against a line of the copy in the song's script.
    // Spotify's lines in another script, and English lines, stay as they are.
    if (!isLatinLine(x.l) || isEnglishLine(x.l) || scriptShare(nat, script) < SCRIPT_MIN) return;
    comparable++;
    // The group as a whole reads like Spotify's line, and every line in it is part of it (no
    // neighbour's line carried along).
    const sim = groupSim(g);
    if (sim < LINE_MIN || g.some((k) => containment(rom[k], x.l) < MEMBER_MIN)) return;
    replaced++;
    sum += sim;
    text[x.i] = nat;
  });
  if (!replaced || replaced / comparable < AGREE_MIN) return null;
  return { text, replaced, score: sum / replaced };
}

/** A copy's fit: the result, and how good it is (more lines improved, then closer). */
export type Fitted = NativeResult & { score: number };

/** Tries one candidate against Spotify's lines. */
export async function fit(
  req: NativeRequest,
  cand: { lines: LyricLine[]; synced: boolean; source: string },
  script: Script,
  romanize: NativeSources['romanize'],
): Promise<Fitted | null> {
  const native = worded(cand.lines.map((l) => l.text));
  const spotify = worded(req.lines);
  if (!native.length || !spotify.length) return null;
  if (songScript(native.map((x) => x.l)) !== script) return null;
  const rom = (await romanize(native.map((x) => x.l), script)).map((r, k) => r ?? native[k].l);

  // Pairings to try: by content in order (and time, when both are timed), and by position
  // when the copies have the same lines. The one that improves more lines wins.
  const pairings: number[][][] = [pairByAlignment(req, cand, native, spotify, rom)];
  if (native.length === spotify.length) pairings.push(pairByPosition(spotify));
  let best: LineFit | null = null;
  for (const p of pairings) {
    const f = fitLines(req, native, spotify, rom, p, script);
    if (f && (!best || f.replaced > best.replaced || (f.replaced === best.replaced && f.score > best.score))) best = f;
  }
  const lineFit: Fitted | null = best && {
    lines: best.text.map((t, i) => ({ startMs: req.times[i] ?? 0, text: t })),
    synced: req.synced,
    source: cand.source,
    aligned: true,
    replaced: best.replaced,
    total: spotify.length,
    score: best.score,
  };
  // The copy whole, with its own timings: only for a song Spotify has wholly in Latin letters
  // (no line in another script to lose), close in length and reading like it as a whole. Kept
  // when it restores more lines than pairing could (pairing keeps Spotify's timing on a tie).
  const tolerance = Math.max(2, Math.round(spotify.length * 0.15));
  let whole: Fitted | null = null;
  if (cand.synced && spotify.every((x) => isLatinLine(x.l)) && Math.abs(native.length - spotify.length) <= tolerance) {
    const score = similarity(rom.join(' '), spotify.map((x) => x.l).join(' '));
    if (score >= SONG_MIN) whole = { lines: cand.lines, synced: true, source: cand.source, aligned: false, replaced: spotify.length, total: spotify.length, score };
  }
  if (lineFit && whole) return better(lineFit, whole) ? whole : lineFit;
  return lineFit ?? whole;
}

/** searchNative's answer: complete is false when a source failed, so "none" isn't final. */
export interface NativeSearch {
  result: NativeResult | null;
  complete: boolean;
}

/** Better of two fits: more lines improved, then line for line over own timing, then closer. */
function better(a: Fitted | null, b: Fitted): boolean {
  if (!a) return true;
  if ((b.replaced ?? 0) !== (a.replaced ?? 0)) return (b.replaced ?? 0) > (a.replaced ?? 0);
  if (b.aligned !== a.aligned) return b.aligned;
  return b.score > a.score;
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
  // YouTube Music's (licensed) copy first, then LRCLIB's with a known duration, synced first;
  // identical uploads tried once.
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
  const { score: _score, ...result } = best;
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
