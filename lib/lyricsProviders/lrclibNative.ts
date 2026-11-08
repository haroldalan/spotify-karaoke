/**
 * Native-script lyrics from LRCLIB (lrclib.net, an open lyrics database with a public API).
 *
 * Spotify shows a romanized fallback for many non-Latin-script songs. Musixmatch used to
 * supply the native script, but since 2026-11 it no longer serves anonymous clients and was
 * removed. LRCLIB
 * often holds the native-script synced lyrics (live 2026-11-07: both test songs, Hindi and
 * Punjabi, with a romanized copy next to them), so it is searched for a native-script copy
 * of the same song.
 *
 * LRCLIB is crowd-sourced: copies of one song are timed to different edits (153–164 s for
 * one 159 s track) and some are partial or another arrangement. A copy is only used when the
 * track's duration is known and the copy is within DURATION_TOLERANCE_S of it, and, given
 * the romanized lyrics it replaces, when it has about as many lines with words.
 */
import type { SubtitleLine } from '../lyrics/subtitleParser';
import { isLikelyRomanizedFallback } from '../lyrics/romanizedDetector';
import { countWordLines } from '../lyrics/lineUtils';
import { fetchWithTimeout } from './fetchUtils';

export interface NativeLyricsQuery {
  title: string;
  artist: string;
  /** Spotify's track duration. Required: without it no copy is used. */
  durationMs?: number;
  /** Lines with words in the romanized lyrics being replaced, when known. */
  referenceWordLines?: number;
}

export interface NativeLrclibMatch {
  id: number;
  syncedLyrics: string;
  durationSec: number;
}

/** Copies timed to an edit this much longer or shorter than the track are not used. */
const DURATION_TOLERANCE_S = 3;
/** A copy may have this share (or MIN_LINE_SLACK lines) more or fewer lines with words. */
const LINE_COUNT_TOLERANCE = 0.25;
const MIN_LINE_SLACK = 3;
const LRCLIB_TIMEOUT_MS = 6000;
/** Native-script check: enough native letters, and not a few among mostly Latin text. */
const MIN_NATIVE_LETTERS = 10;
const MIN_NON_LATIN_RATIO = 0.25;
const MIN_NATIVE_LINE_SHARE = 0.2;
const MIN_NATIVE_PER_LINE = 2;

/** Title for comparison: lowercase, without "(From …)"/"- Remastered" parts or punctuation. */
export const coreTitle = (t: string): string => String(t || '').toLowerCase()
  .replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const norm = (s: string): string => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Line texts of an LRC document, without timestamps. */
export function lrcTexts(lrc: string): string[] {
  return String(lrc || '').split('\n').map((l) => l.replace(/^(\s*\[[^\]]*\])+\s*/, '').trim()).filter(Boolean);
}

/** True when the lines are in a native (non-Latin) script. */
export function isNativeScriptText(texts: readonly string[]): boolean {
  let nonLatin = 0;
  let letters = 0;
  let nativeLines = 0;
  let letterLines = 0;
  for (const text of texts) {
    const all = text.match(/\p{L}/gu) ?? [];
    const n = all.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
    letters += all.length;
    nonLatin += n;
    if (all.length) letterLines++;
    if (n >= MIN_NATIVE_PER_LINE) nativeLines++;
  }
  if (nonLatin < MIN_NATIVE_LETTERS || !letters) return false;
  return nonLatin / letters >= MIN_NON_LATIN_RATIO || (letterLines > 0 && nativeLines / letterLines >= MIN_NATIVE_LINE_SHARE);
}

/** True when an LRC document reads like a romanized stand-in for a non-Latin-script song. */
export function lrcLooksRomanized(lrc: string | undefined): boolean {
  return !!lrc && isLikelyRomanizedFallback(lrcTexts(lrc)).romanized;
}

const sameTitle = (wanted: string, got: string): boolean => {
  const a = coreTitle(wanted);
  const b = coreTitle(got);
  return !!a && !!b && (a === b || b.startsWith(a) || a.startsWith(b));
};

/** The candidate's artist list names the track's (first) artist, or the other way round. */
const sameArtist = (wanted: string, got: string): boolean => {
  const a = norm(wanted);
  const b = norm(got);
  return !!a && !!b && (b.includes(a) || a.includes(b));
};

/** The copy's lines with words are within the tolerance of the reference count. */
export function lineCountFits(copyWordLines: number, referenceWordLines: number | undefined): boolean {
  if (!referenceWordLines || referenceWordLines <= 0) return true;
  const slack = Math.max(MIN_LINE_SLACK, Math.round(referenceWordLines * LINE_COUNT_TOLERANCE));
  return Math.abs(copyWordLines - referenceWordLines) <= slack;
}

/**
 * Searches LRCLIB for a synced, native-script copy of the song: same title and artist,
 * within DURATION_TOLERANCE_S of the track (the closest wins) and, when the romanized
 * lyrics' line count is given, with about as many lines.
 */
export async function findNativeLrclib(query: NativeLyricsQuery, label = 'LRCLIB'): Promise<NativeLrclibMatch | null> {
  const title = String(query.title || '').split(' (')[0].split(' - ')[0].trim();
  const artist = String(query.artist || '').trim();
  if (!coreTitle(title) || !artist) {
    console.log(`[LRCLIB] ${label} native search skipped: no title/artist`);
    return null;
  }
  if (!query.durationMs || query.durationMs <= 0) {
    console.log(`[LRCLIB] ${label} native search skipped: track duration unknown`);
    return null;
  }
  const t0 = Date.now();
  let results: Record<string, unknown>[];
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const res = await fetchWithTimeout(`https://lrclib.net/api/search?${params.toString()}`, {}, LRCLIB_TIMEOUT_MS);
    if (!res.ok) {
      console.log(`[LRCLIB] ${label} native search: HTTP ${res.status}, ${Date.now() - t0}ms`);
      return null;
    }
    const body = await res.json();
    results = Array.isArray(body) ? body : [];
  } catch (e) {
    console.log(`[LRCLIB] ${label} native search failed: ${(e as Error)?.name ?? 'error'}, ${Date.now() - t0}ms`);
    return null;
  }

  const wantedSec = query.durationMs / 1000;
  let best: NativeLrclibMatch | null = null;
  let bestGap = Infinity;
  let nativeCopies = 0;
  let timedCopies = 0;
  for (const r of results) {
    const synced = typeof r.syncedLyrics === 'string' ? r.syncedLyrics : '';
    if (!synced || r.instrumental === true) continue;
    if (!sameTitle(title, String(r.trackName ?? '')) || !sameArtist(artist, String(r.artistName ?? ''))) continue;
    if (!isNativeScriptText(lrcTexts(synced))) continue;
    nativeCopies++;
    const durationSec = Number(r.duration) || 0;
    const gap = Math.abs(durationSec - wantedSec);
    if (gap > DURATION_TOLERANCE_S) continue;
    timedCopies++;
    if (!lineCountFits(countWordLines(lrcTexts(synced)), query.referenceWordLines)) continue;
    if (gap < bestGap) {
      best = { id: Number(r.id) || 0, syncedLyrics: synced, durationSec };
      bestGap = gap;
      if (gap === 0) break;
    }
  }
  const took = `${Date.now() - t0}ms`;
  const ref = query.referenceWordLines ? `, ${query.referenceWordLines} romanized lines` : '';
  if (best) {
    console.log(`[LRCLIB] ${label} native copy found: id=${best.id} duration=${best.durationSec}s (track ${wantedSec.toFixed(0)}s${ref}), ${results.length} results, ${took}`);
  } else {
    const why = !nativeCopies ? '' : !timedCopies ? ` (none within ${DURATION_TOLERANCE_S}s of ${wantedSec.toFixed(0)}s)` : ` (${timedCopies} timed to the track, none with about as many lines${ref})`;
    console.log(`[LRCLIB] ${label} no native copy: ${results.length} results, ${nativeCopies} native${why}, ${took}`);
  }
  return best;
}

/** LRC (one timestamp per line, as LRCLIB stores it) to the subtitle lines the interceptor uses. */
export function lrcToSubtitleLines(lrc: string): SubtitleLine[] {
  const out: SubtitleLine[] = [];
  for (const raw of String(lrc || '').split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/^(\s*\[[^\]]*\])+\s*/, '').trim();
    for (const m of stamps) {
      const ms = Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000);
      out.push({ id: '', startTimeMs: String(ms), words: words || '♪', syllables: [], endTimeMs: '0' });
    }
  }
  out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
  out.forEach((line, i) => {
    line.id = String(i);
    line.endTimeMs = i < out.length - 1 ? out[i + 1].startTimeMs : String(Number(line.startTimeMs) + 3000);
  });
  return out;
}
