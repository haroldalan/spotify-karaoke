// Native-script restoration: Spotify serves some songs' lyrics romanized ("Mera dil tera
// hai") although the song is written in its own script (मेरा दिल तेरा है). Romanization and
// translation from the real script are far better, and the script is what fans expect.
//
// Whole copies are judged, never patched line by line (the owner's call, 2026-11-10): one
// source per song. Asked only when enough of Spotify's lines look romanized. A copy (YouTube
// Music's licensed one, each distinct LRCLIB upload) qualifies when
// - it is in the song's script (most of its lines),
// - it is the same song: most of Spotify's romanized lines are found in it, in order, by
//   content (and by time when both are timed), its romanization by us reading like them;
//   or, when the two break their lines differently, by the whole text (wholeText below),
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

// ─── The same song, judged by the whole text ────────────────────────────────────
//
// Line by line (above) asks for each of Spotify's lines to be paired with the copy's. Two
// transcriptions of one song often break their lines differently: one joins what the other
// splits ("is besangi duniya ke sangi" + "ham naa hote yaara" in one line), writes a chorus
// once or every time, adds ad-libs. Each of those costs paired lines, though the song is the
// same. The whole text doesn't care where lines break: the copy is the same song when
// - most of Spotify's romanized text is in it (its consonant trigrams, as a set: a chorus
//   written once still counts),
// - most of the copy's own text is in Spotify's (another version, or a different song that
//   shares a few lines, has much of its own),
// - most of Spotify's romanized lines are each found inside one or two consecutive copy
//   lines (whole lines, not scattered trigrams).
// The metadata already matched (title, artist, duration) before any copy got here.

/** Share of Spotify's romanized text (distinct trigrams) found in the copy. */
const WHOLE_COVER_MIN = 0.7;
/** Share of the copy's own text (in the song's script) found in Spotify's. */
const WHOLE_OWN_MIN = 0.6;
/** Share of Spotify's romanized lines found inside one or two consecutive copy lines. */
const WHOLE_LINES_MIN = 0.6;
/** A line counts as found when this share of its trigrams is in the copy lines. */
const WHOLE_LINE_IN = 0.6;
/**
 * Both timed: at least this share of the found lines must start within TIME_SLACK_MS of the
 * copy line they were found in. A copy that joins two of Spotify's lines starts the first
 * half on time and only the second half early (one joining every pair: half on time). A copy
 * timed to another recording (a video's intro, a live cut) is off on almost every line, and
 * would play out of sync.
 */
const WHOLE_TIMED_MIN = 0.4;

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Share of a's trigrams in b (0 when a has none). */
function setIn(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n / a.size;
}

export interface WholeText { cover: number; own: number; lines: number; /** Both timed: share of found lines on time; null otherwise. */ timed: number | null }

/** Start times, when both copies are timed: Spotify's romanized line (by its place in romanizedLines), the copy's line. */
export interface WholeTimes { spotify: (n: number) => number; copy: (k: number) => number }

/** Whole-text measures for a copy, or null when they fall short. */
function wholeText(spotify: Worded, romanizedLines: number[], native: Worded, rom: string[], script: Script, times?: WholeTimes): WholeText | null {
  const m = wholeMeasures(spotify, romanizedLines, native, rom, script, times);
  const onTime = m.timed === null || m.timed >= WHOLE_TIMED_MIN;
  return m.cover >= WHOLE_COVER_MIN && m.own >= WHOLE_OWN_MIN && m.lines >= WHOLE_LINES_MIN && onTime ? m : null;
}

/** The whole-text measures (exported for tests and for measuring real songs). */
export function wholeMeasures(spotify: Worded, romanizedLines: number[], native: Worded, rom: string[], script: Script, times?: WholeTimes): WholeText {
  const sk = (s: string) => skeleton(s);
  const spotifyRom = romanizedLines.map((j) => sk(spotify[j].l));
  const copyAll = rom.map(sk);
  const copyText = trigrams(copyAll.join(''));
  const cover = setIn(trigrams(spotifyRom.join('')), copyText);
  // The copy's own lines (in the song's script) against all of Spotify's, English included.
  const own = setIn(trigrams(native.map((x, k) => (scriptShare(x.l, script) >= SCRIPT_MIN ? copyAll[k] : '')).join('')), trigrams(spotify.map((x) => sk(x.l)).join('')));
  // Each Spotify line inside one copy line, or two consecutive ones (the copy split it).
  const windows = copyAll.map((s, k) => trigrams(s + (copyAll[k + 1] ?? '')));
  const judged = spotifyRom.map((s, n) => ({ s, n })).filter((x) => x.s.length >= 3);
  let located = 0;
  let onTime = 0;
  for (const { s, n } of judged) {
    const g = trigrams(s);
    const ks = windows.map((w, k) => (setIn(g, w) >= WHOLE_LINE_IN ? k : -1)).filter((k) => k >= 0);
    if (!ks.length) continue;
    located++;
    if (times && ks.some((k) => Math.abs(times.copy(k) - times.spotify(n)) <= TIME_SLACK_MS)) onTime++;
  }
  const lines = judged.length ? located / judged.length : 0;
  return { cover, own, lines, timed: times ? (located ? onTime / located : 0) : null };
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
  let coverage = romanizedLines.filter((j) => found(spotify[j].l, pairs[j], rom)).length / romanizedLines.length;
  if (coverage < COVER_MIN) {
    // Line by line fell short: judged by the whole text instead, which doesn't care where
    // either copy breaks its lines (2026-11-10). Never refuses what line by line takes.
    const times: WholeTimes | undefined = req.synced && cand.synced
      ? { spotify: (n) => req.times[spotify[romanizedLines[n]].i] ?? 0, copy: (k) => cand.lines[native[k].i].startMs }
      : undefined;
    const whole = wholeText(spotify, romanizedLines, native, rom, script, times);
    if (!whole) return null;
    coverage = whole.cover;
  }

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

/**
 * Bump when the judging takes copies it used to refuse: a song remembered as "none" by an
 * older judge is looked up again (once). A found copy stays found. 2: the whole-text check.
 */
const JUDGE_VERSION = 2;
const FOUND_TTL = 30 * 24 * 3600_000;
const NONE_TTL = 3 * 24 * 3600_000;
/** A source failed: look again soon. */
const UNREACHABLE_TTL = 30 * 60_000;

export function restoreNative(req: NativeRequest, sources: NativeSources = DEFAULT_SOURCES): Promise<NativeResult | null> {
  const key = `nat:${req.meta.id}:${hash(`${req.meta.name}\n${req.lines.join('\n')}`)}`;
  return once(key, async () => {
    const cached = await cacheGet<NativeResult | { none: true; judge?: number }>(key);
    if (cached && !('none' in cached)) return cached;
    if (cached && 'none' in cached && (cached.judge ?? 1) >= JUDGE_VERSION) return null;
    const { result, complete } = await searchNative(req, sources).catch(() => ({ result: null, complete: false }));
    await cacheSet(key, result ?? { none: true, judge: JUDGE_VERSION }, result ? FOUND_TTL : complete ? NONE_TTL : UNREACHABLE_TTL);
    return result;
  });
}
