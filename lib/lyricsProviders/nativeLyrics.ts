/**
 * Native-script lyrics for songs Spotify shows romanized.
 *
 * Spotify serves a romanized fallback for many non-Latin songs (Hindi, Punjabi, Thai…).
 * The page's interceptor holds Spotify's answer briefly and asks here for the same
 * lyrics in the original script, which then replace the romanized lines.
 *
 * Sources, in order: lines already found for the track (remembered 30 days), YouTube
 * Music's synced lyrics when they are native script (licensed, timed to the release),
 * then a synced native-script copy from LRCLIB (crowd-sourced: only with the track's
 * duration and about as many lines as Spotify's romanized answer).
 *
 * Musixmatch was the first source until 2026-11: it stopped serving anonymous clients
 * (placeholder tokens, then captchas) and was removed.
 */
import type { SubtitleLine } from '../lyrics/subtitleParser';
import { findNativeLrclib, isNativeScriptText, lineCountFits, lrcTexts, lrcToSubtitleLines } from './lrclibNative';
import { countWordLines } from '../lyrics/lineUtils';
import { fetchYtmLyrics } from './ytm';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackMetadata {
  name: string;
  artist: string;
  /** Spotify's track duration (the bridge knows it; SLY_CHECK_CACHE does not send it). */
  durationMs?: number;
}

export interface NativeLyricsProvider {
  fetchNativeLines(
    spotifyTrackId: string,
    hexGid: string,
    interceptId: number,
    /** Lines with words in Spotify's (romanized) answer: a native copy must have about as many. */
    spotifyWordLines?: number,
  ): Promise<SubtitleLine[] | null>;
  /** `ifUnknown`: only when nothing is recorded for the id yet (a cache check's title may be read too early). */
  notifyMetadata(id: string, name: string, artist: string, durationMs?: number, opts?: { ifUnknown?: boolean }): void;
  newInterception(spotifyTrackId: string): number;
  /** Popup Reset (K7): forget what is held in memory (the popup removes the stored copy). */
  resetMemory(): void;
}

// ─── Track metadata and lookup generations ───────────────────────────────────

const _metadataCache = new Map<string, TrackMetadata>();
const _pendingMetaCallbacks = new Map<string, Array<(m: TrackMetadata) => void>>();
const _currentInterceptGeneration = new Map<string, number>();

const MAP_CAP = 200;

function touchAndCap<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAP_CAP) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

function getMetadata(id: string): TrackMetadata | undefined {
  const val = _metadataCache.get(id);
  if (val) {
    _metadataCache.delete(id);
    _metadataCache.set(id, val);
  }
  return val;
}

/** Title, artist and duration of a track, when the page or a lyrics request named it. */
export function getTrackMetadata(id: string): TrackMetadata | undefined {
  return id ? getMetadata(id) : undefined;
}

/**
 * Spotify asks for a track's lyrics as the track starts, often before the bridge has
 * named it (live: meta=no on every lookup): wait this long for its metadata.
 */
let _metadataWaitMs = 2500;

/** Test hook. */
export function setMetadataWaitMs(ms: number): void {
  _metadataWaitMs = ms;
}

function waitForMetadata(id: string, ms: number): Promise<TrackMetadata | undefined> {
  const known = getMetadata(id);
  if (known || !id || ms <= 0) return Promise.resolve(known);
  return new Promise((resolve) => {
    const cb = (m: TrackMetadata) => { clearTimeout(timer); resolve(m); };
    const timer = setTimeout(() => {
      const left = (_pendingMetaCallbacks.get(id) ?? []).filter((c) => c !== cb);
      if (left.length) _pendingMetaCallbacks.set(id, left);
      else _pendingMetaCallbacks.delete(id);
      resolve(undefined);
    }, ms);
    _pendingMetaCallbacks.set(id, [...(_pendingMetaCallbacks.get(id) ?? []), cb]);
  });
}

// ─── Restored native lines, per track ────────────────────────────────────────
// A track's native lines, once found, answer every later request for it at once: the
// song page asks for its lyrics before the page has named the track (no metadata: no
// search possible), reloads and replays would repeat several YouTube Music / LRCLIB
// requests, and Spotify's hold budget is only a few seconds.
const NATIVE_LINES_KEY = 'skl_native_lines_v1';
const NATIVE_LINES_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NATIVE_LINES_MAX = 200;
interface StoredNativeLines { at: number; source: string; lines: SubtitleLine[] }
let _nativeLines: Record<string, StoredNativeLines> | null = null;

async function loadNativeLines(): Promise<Record<string, StoredNativeLines>> {
  if (_nativeLines) return _nativeLines;
  try {
    const stored = (await browser.storage.local.get(NATIVE_LINES_KEY))?.[NATIVE_LINES_KEY];
    _nativeLines = stored && typeof stored === 'object' ? { ...(stored as Record<string, StoredNativeLines>) } : {};
  } catch {
    _nativeLines = {};
  }
  return _nativeLines;
}

async function knownNativeLines(trackId: string): Promise<StoredNativeLines | null> {
  if (!trackId) return null;
  const entry = (await loadNativeLines())[trackId];
  return entry && Array.isArray(entry.lines) && entry.lines.length && Date.now() - entry.at < NATIVE_LINES_TTL_MS ? entry : null;
}

async function forgetNativeLines(trackId: string): Promise<void> {
  const map = await loadNativeLines();
  if (!(trackId in map)) return;
  delete map[trackId];
  try { await browser.storage.local.set({ [NATIVE_LINES_KEY]: map }); } catch { /* memory is updated */ }
}

async function rememberNativeLines(trackId: string, source: string, lines: SubtitleLine[]): Promise<void> {
  if (!trackId || !lines.length) return;
  const map = await loadNativeLines();
  map[trackId] = { at: Date.now(), source, lines };
  const ids = Object.keys(map).sort((a, b) => map[a].at - map[b].at);
  while (ids.length > NATIVE_LINES_MAX) delete map[ids.shift()!];
  try { await browser.storage.local.set({ [NATIVE_LINES_KEY]: map }); } catch { /* memory still has it */ }
}

/**
 * Storage keys the removed Musixmatch client left behind (token, rest marker, the
 * "only romanized on Musixmatch" memory). Removed once on update; Reset removes them too.
 */
export const LEGACY_MUSIXMATCH_KEYS = [
  'skl_mxm_token', 'skl_mxm_token_expiry', 'skl_mxm_unavailable_until',
  'skl_mxm_no_native', 'skl_mxm_no_native_v2', 'skl_mxm_no_native_v3',
];

// ─── Provider ────────────────────────────────────────────────────────────────

export const nativeLyricsProvider: NativeLyricsProvider = {
  resetMemory(): void {
    _nativeLines = null;
  },

  async fetchNativeLines(spotifyTrackId, hexGid, interceptId, spotifyWordLines) {
    // Diagnostics: one start line, one line per source that did not answer, one end line.
    const t0 = Date.now();
    const hasMeta = _metadataCache.has(spotifyTrackId) || (!!hexGid && _metadataCache.has(hexGid));
    console.log(`[NATIVE] lookup ${spotifyTrackId} meta=${hasMeta ? 'yes' : 'no'} gen=${interceptId}`);

    const done = (lines: SubtitleLine[] | null, source?: string): SubtitleLine[] | null => {
      console.log(`[NATIVE] lookup done ${lines && source ? source : 'null'} ${Date.now() - t0}ms`);
      if (lines && lines.length && source && spotifyTrackId) void rememberNativeLines(spotifyTrackId, source, lines);
      return lines;
    };
    const isStale = (after: string): boolean => {
      const current = _currentInterceptGeneration.get(spotifyTrackId) || 0;
      if (current === interceptId) return false;
      console.log(`[NATIVE] lookup ${spotifyTrackId} stale after ${after} (gen ${interceptId}, current ${current}); aborting`);
      return true;
    };
    /**
     * About as many lines with words as Spotify's romanized answer (the tolerance LRCLIB
     * copies get). Native lines for another song or edit do not fit (live 2026-11-08: a
     * wrong title found another song's lyrics, 59 lines against Spotify's 30): they would be
     * refused on the page anyway, and were remembered for the track.
     */
    const fitsSpotify = (lines: SubtitleLine[]): boolean =>
      lineCountFits(countWordLines(lines.map((l) => l.words)), spotifyWordLines);
    const metaNow = (): TrackMetadata | undefined =>
      getMetadata(spotifyTrackId) ?? (hexGid ? getMetadata(hexGid) : undefined);

    const known = await knownNativeLines(spotifyTrackId);
    if (known && fitsSpotify(known.lines)) {
      console.log(`[NATIVE] lookup done remembered (${known.source}) ${Date.now() - t0}ms`);
      return known.lines;
    }
    if (known) {
      console.log(`[NATIVE] Remembered native lines for ${spotifyTrackId} (${known.source}) do not fit Spotify's ${spotifyWordLines} lines: forgotten, looking again.`);
      await forgetNativeLines(spotifyTrackId);
    }

    let meta = metaNow();
    if (!meta && spotifyTrackId) {
      meta = await waitForMetadata(spotifyTrackId, _metadataWaitMs);
      if (isStale('metadata wait')) return done(null);
    }
    if (!meta) {
      console.log('[NATIVE] YouTube Music and LRCLIB skipped: no metadata');
      return done(null);
    }
    // LRCLIB is asked at the same time when the duration is already known (it needs it):
    // YouTube Music still wins when its lyrics are native script, but a slow YouTube Music
    // (live: 9–12 s) no longer adds LRCLIB's time on top.
    const lrclibFor = (m: TrackMetadata) => findNativeLrclib({
      title: m.name, artist: m.artist, durationMs: m.durationMs, referenceWordLines: spotifyWordLines,
    }).catch(() => null);
    const early = meta.durationMs ? lrclibFor(meta) : null;
    const ytm = await fetchYtmLyrics(meta.name, meta.artist).catch(() => null);
    if (isStale('YTM')) return done(null);
    const ytmNative = ytm?.isSynced && ytm.syncedLyrics && isNativeScriptText(lrcTexts(ytm.syncedLyrics))
      ? lrcToSubtitleLines(ytm.syncedLyrics) : null;
    if (ytmNative && fitsSpotify(ytmNative)) return done(ytmNative, 'YTM');
    console.log(`[NATIVE] YouTube Music: ${!ytm ? 'no lyrics' : !ytm.isSynced ? 'unsynced lyrics only'
      : ytmNative ? `native-script lyrics with ${countWordLines(ytmNative.map((l) => l.words))} lines against Spotify's ${spotifyWordLines} (another song or edit)`
      : 'synced lyrics are not native script'}`);
    // Otherwise the page usually sends the duration by now (YouTube Music takes a few requests).
    const match = await (early ?? lrclibFor(metaNow() ?? meta));
    if (isStale('LRCLIB')) return done(null);
    return match ? done(lrcToSubtitleLines(match.syncedLyrics), 'LRCLIB') : done(null);
  },

  notifyMetadata(id, name, artist, durationMs, opts) {
    // A notification without a duration (SLY_CHECK_CACHE) keeps the one the bridge sent.
    const prev = _metadataCache.get(id);
    if (opts?.ifUnknown && prev) return;
    const keep = !durationMs && prev && prev.name === name ? prev.durationMs : undefined;
    const ms = durationMs && durationMs > 0 ? durationMs : keep;
    touchAndCap(_metadataCache, id, ms ? { name, artist, durationMs: ms } : { name, artist });
    const callbacks = _pendingMetaCallbacks.get(id);
    if (callbacks) {
      const stored = _metadataCache.get(id)!;
      callbacks.forEach(cb => cb(stored));
      _pendingMetaCallbacks.delete(id);
    }
  },

  newInterception(spotifyTrackId) {
    const nextGen = (_currentInterceptGeneration.get(spotifyTrackId) || 0) + 1;
    touchAndCap(_currentInterceptGeneration, spotifyTrackId, nextGen);
    return nextGen;
  },
};
