// Native-script restoration: Spotify serves some songs' lyrics romanized ("Mera dil tera
// hai") although the song is written in its own script (मेरा दिल तेरा है). Romanization and
// translation from the real script are far better, and the script is what fans expect.
//
// A copy in the song's script must prove it is the same song, line for line:
// - aligned: same number of lines with words, and the copy, romanized by us, reads like
//   Spotify's romanized lines. Spotify's (licensed) timings are kept, only the text changes.
// - own timing: otherwise a synced copy close in length whose whole text reads like
//   Spotify's is used with its own timings.
// Anything less is refused: romanized lyrics in sync beat native lyrics out of sync.
import type { LyricLine, NativeResult, TrackMeta } from '../../shared/types';
export type { NativeResult };
import { expectedScript, songScript, type Script } from '../../shared/scripts';
import { cacheGet, cacheSet, once } from '../cache';
import { hash } from '../../shared/hash';
import { romanizeLines } from '../text/romanize';
import { googleLines } from '../text/google';
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

const ALIGN_MIN = 0.45;
const SONG_MIN = 0.5;
/** How early a native line may start relative to the Spotify line it belongs to. */
const TIME_SLACK_MS = 1500;

/** Consonant skeleton: what survives every romanization scheme ("thangamae" ~ "thangame"). */
export function skeleton(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
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

/** Tries one candidate against Spotify's lines. */
export async function fit(
  req: NativeRequest,
  cand: { lines: LyricLine[]; synced: boolean; source: string },
  script: Script,
  romanize: NativeSources['romanize'],
): Promise<NativeResult | null> {
  const native = worded(cand.lines.map((l) => l.text));
  const spotify = worded(req.lines);
  if (!native.length || !spotify.length) return null;
  if (songScript(native.map((x) => x.l)) !== script) return null;
  const rom = (await romanize(native.map((x) => x.l), script)).map((r, k) => r ?? native[k].l);

  if (native.length === spotify.length) {
    const score = rom.reduce((s, r, k) => s + similarity(r, spotify[k].l), 0) / rom.length;
    if (score >= ALIGN_MIN) {
      const text = [...req.lines];
      spotify.forEach((x, k) => (text[x.i] = native[k].l));
      return {
        lines: text.map((t, i) => ({ startMs: req.times[i] ?? 0, text: t })),
        synced: req.synced,
        source: cand.source,
        aligned: true,
      };
    }
  }
  // Line breaks differ, but both copies are timed to the same recording: each of Spotify's
  // lines takes the native lines that start during it, and keeps Spotify's timing.
  if (req.synced && cand.synced && native.length !== spotify.length) {
    const spotifyStart = spotify.map((x) => req.times[x.i] ?? 0);
    const groups: number[][] = spotify.map(() => []);
    native.forEach((x, k) => {
      const t = cand.lines[x.i].startMs;
      let j = -1;
      for (let q = 0; q < spotifyStart.length && spotifyStart[q] <= t + TIME_SLACK_MS; q++) j = q;
      if (j >= 0) groups[j].push(k);
    });
    if (groups.every((g) => g.length)) {
      const joined = groups.map((g) => g.map((k) => rom[k]).join(' '));
      const score = joined.reduce((s, r, j) => s + similarity(r, spotify[j].l), 0) / joined.length;
      if (score >= ALIGN_MIN) {
        const text = [...req.lines];
        spotify.forEach((x, j) => (text[x.i] = groups[j].map((k) => native[k].l).join(' ')));
        return { lines: text.map((t, i) => ({ startMs: req.times[i] ?? 0, text: t })), synced: true, source: cand.source, aligned: true };
      }
    }
  }
  const tolerance = Math.max(2, Math.round(spotify.length * 0.15));
  if (cand.synced && Math.abs(native.length - spotify.length) <= tolerance) {
    const score = similarity(rom.join(' '), spotify.map((x) => x.l).join(' '));
    if (score >= SONG_MIN) return { lines: cand.lines, synced: true, source: cand.source, aligned: false };
  }
  return null;
}

/** searchNative's answer: complete is false when a source failed, so "none" isn't final. */
export interface NativeSearch {
  result: NativeResult | null;
  complete: boolean;
}

export async function searchNative(req: NativeRequest, sources: NativeSources): Promise<NativeSearch> {
  const script = expectedScript(req.meta.languages);
  if (!script || songScript(req.lines) !== 'Latn') return { result: null, complete: true };
  let complete = true;
  // Both sources are asked at once (a song's first play has seconds, not minutes); YouTube
  // Music's copy (licensed) is tried first, then LRCLIB copies whose duration is known.
  const ytP = sources.ytm ? sources.ytm(req.meta).catch(() => { complete = false; return null; }) : Promise.resolve(null);
  const lrP = sources.lrclib(req.meta).catch(() => { complete = false; return []; });
  const yt = await ytP;
  if (yt) {
    const r = await fit(req, yt, script, sources.romanize);
    if (r) return { result: r, complete };
  }
  const lr = (await lrP).filter((c) => c.durationKnown);
  // Synced copies first.
  lr.sort((a, b) => Number(b.synced) - Number(a.synced));
  for (const c of lr) {
    const r = await fit(req, { ...c, source: 'LRCLIB' }, script, sources.romanize);
    if (r) return { result: r, complete };
  }
  return { result: null, complete };
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
  romanize: (lines, script) => romanizeLines(lines, script, { google: async (l) => (await googleLines(l, 'en', true)).romanized }),
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
