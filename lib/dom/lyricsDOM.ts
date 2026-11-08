import { traceEvent } from '../testHooks';
import type { SongCache } from '../core/lyricsTypes';
import { getLyricsLines, getNowPlayingKey, NOW_PLAYING_WIDGET, PANEL_TRACK_ATTR } from './domQueries';
import { isLatinScript } from '../lyrics/scriptDetector';
import { isLikelyRomanizedFallback } from '../lyrics/romanizedDetector';
import { countWordLines, hasLyricWords } from '../lyrics/lineUtils';
import { hashString } from '../utils/hashUtils';

/**
 * Physically removes all extension-injected elements and attributes from the 
 * native lyrics container, restoring it to its original Spotify state.
 */
/**
 * Physically removes all extension-injected elements and attributes from the 
 * native lyrics container, restoring it to its original Spotify state.
 */
export function purgeSlyDOM(opts: { keep?: readonly Element[]; keepSongsOtherThan?: string | null } = {}): void {
  // `keep`: rows already painted for the song now playing (see slyResetPlayerState): a
  // reset that arrives after them must not strip them (live 2026-11-08: the playing song,
  // just painted, was stripped and stayed unprocessed for ~0.5 s).
  // `keepSongsOtherThan`: leave the panels of other songs (tagged by the bridge) as they
  // are: their paint is theirs. The song being left slides out over ~0.5 s after a skip,
  // and stripping it showed its original lines on the way out (live 2026-11-08). A panel
  // Spotify hands to another song is cleaned when its tag changes (watchPanelSongChanges).
  const keep = new Set(opts.keep ?? []);
  const other = opts.keepSongsOtherThan;
  const ofOtherSong = (el: Element): boolean => {
    if (!other) return false;
    const tag = el.closest(`[${PANEL_TRACK_ATTR}]`)?.getAttribute(PANEL_TRACK_ATTR);
    return !!tag && tag !== other;
  };
  const kept = (el: Element): boolean =>
    keep.has(el) || (!!el.parentElement && keep.has(el.parentElement)) || ofOtherSong(el);
  traceEvent(`purge${keep.size ? `:keep${keep.size}` : ''}${other ? ':otherSongsKept' : ''}`);
  const lines = Array.from(document.querySelectorAll('[data-testid="lyrics-line"] > div'))
    .filter(el => !el.closest(`[data-testid="now-playing-bar"], footer, ${NOW_PLAYING_WIDGET}`) && !kept(el));
  // One summary line: the per-row log (with each row's lyrics) ran on every song change
  // and pushed everything else out of the console.
  let restored = 0;
  let stripped = 0;
  lines.forEach((el) => {
    const r = restoreRow(el);
    if (r === 'restored') restored++;
    else if (r === 'stripped') stripped++;
  });

  // V13 Fix: Global sweep for stale data-sly-original attributes.
  // When Pipeline A's #lyrics-root-sync is removed before purgeSlyDOM runs,
  // the '[data-testid="lyrics-line"] > div' query returns 0 results.
  // But React may recycle native DOM elements that still carry our attribute,
  // causing the next song's snapshotOriginals() to skip those lines
  // (it early-returns on hasAttribute('data-sly-original')), poisoning the cache.
  const staleAttrs = Array.from(document.querySelectorAll('[data-sly-original]'))
    .filter(el => !kept(el) && !Array.from(keep).some(k => k.contains(el)));
  if (staleAttrs.length > 0) {
    staleAttrs.forEach(el => {
      el.textContent = el.getAttribute('data-sly-original') || '';
      el.removeAttribute('data-sly-original');
    });
  }

  if (restored || stripped || staleAttrs.length) {
    console.log(`[sly-purge] 🧹 ${lines.length} rows: ${restored} restored, ${stripped} stripped, ${staleAttrs.length} stale attributes swept.`);
  }
}

// ---------------------------------------------------------------------------
// Row ownership (Pipeline B binds rows to a song only by the widget aria-label)
// ---------------------------------------------------------------------------

/** Native text of a row: the same rule as verifyAndHealCache's DOM hash. */
export const nativeRowText = (el: Element): string => el.getAttribute('data-sly-original') ?? el.textContent ?? '';

/** Native texts of the panel rows on screen. */
export const readNativeRowTexts = (): string[] => getLyricsLines().map(nativeRowText);

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Track id the MAIN-world bridge names right now ('' when none). It leads the widget label. */
const bridgeTrackId = (): string =>
  String((window as any).spotifyState?.track?.uri ?? '').match(/^spotify:track:([A-Za-z0-9]+)$/)?.[1] ?? '';

/**
 * Rows that carried the current key's lyrics (successful snapshot, or an apply
 * whose source matched them), with the track id the bridge named at every bind
 * ('' when it named none, or when the binds disagreed).
 */
let boundRows = new WeakMap<Element, string>();
/** Rows of the previous key, with their native text at the song change. */
let retiredRows = new WeakMap<Element, string>();
/** When the rows were retired (Date.now()). */
let retiredAt = 0;
/**
 * The previous track's rows linger for a moment after a skip (under 1 s in the
 * 2026-11 live log). Past this window, rows that are still the same elements with
 * the same text are taken to be the current track's: refusing them for good would
 * leave a song without Romanized/Translated if a row was ever bound to the wrong
 * key (e.g. the next track's rows mounted while the bridge still named the old one).
 */
export const RETIRED_ROWS_WINDOW_MS = 5000;

function bindRows(rows: Element[]): void {
  const owner = bridgeTrackId();
  for (const el of rows) {
    const prev = boundRows.get(el);
    boundRows.set(el, prev === undefined || prev === owner ? owner : '');
  }
}

/**
 * Song change: remember the rows still on screen that belong to the outgoing key
 * with their native text. Those are the rows bound to it, the rows that show its
 * cache (Original mode with a stored or hot cache binds nothing), and the rows
 * still unchanged since an earlier retirement. Call it while they hold native
 * text, before the cache is reset. A new snapshot refuses rows that are still
 * these elements with this text.
 * Rows bound only while the bridge already named the incoming track (its rows
 * mounted before the widget label changed) are the incoming track's: they stay
 * bound to it instead.
 * Returns the number of rows retired.
 */
export function retireRows(
  outgoing: { original: string[]; trackId: string | null; fromTakeover?: boolean } = { original: [], trackId: null },
  incomingTrackId: string | null = null,
): number {
  const rows = getLyricsLines();
  const texts = rows.map(nativeRowText);
  const showOutgoingCache = outgoing.original.length > 0 && rows.length > 0 && cacheMatchesRows(outgoing.original, texts);
  const retired = new WeakMap<Element, string>();
  const bound = new WeakMap<Element, string>();
  let count = 0;
  let incoming = 0;
  rows.forEach((el, i) => {
    const owner = boundRows.get(el);
    if (owner && owner === incomingTrackId && owner !== outgoing.trackId) {
      bound.set(el, owner);
      incoming++;
      return;
    }
    const text = collapse(texts[i]);
    const stillRetired = retiredRows.get(el) === text;
    // A takeover hid Spotify's rows for the whole song: they were never snapshotted
    // or painted (so never bound), but every row still mounted is the outgoing song's.
    if (owner === undefined && !stillRetired && !showOutgoingCache && !outgoing.fromTakeover) return;
    retired.set(el, text);
    count++;
  });
  retiredRows = retired;
  retiredAt = Date.now();
  boundRows = bound;
  console.log(`[sly-snapshot] Retired ${count} row(s) of the previous track${incoming ? `; kept ${incoming} row(s) bound to the incoming track ${incomingTrackId}` : ''}.`);
  return count;
}

export type SnapshotResult = 'ok' | 'empty' | 'refused';
/** Returns a refusal reason, or null to allow the snapshot. */
export type SnapshotGuard = (texts: string[], rowsHash: number) => string | null;

let snapshotGuard: SnapshotGuard | null = null;
let getCurrentCanonicalHash: (() => number | null) | null = null;
let currentTrackRequested: (() => boolean) | null = null;

/**
 * Registers the track-level snapshot check (lifecycleController) and the source
 * of the current track's canonical hash, which exempts retired rows (two versions
 * of one song can share rows).
 */
export function registerSnapshotGuard(
  fn: SnapshotGuard | null,
  canonicalHash?: () => number | null,
  trackRequested?: () => boolean,
): void {
  snapshotGuard = fn;
  getCurrentCanonicalHash = canonicalHash ?? null;
  currentTrackRequested = trackRequested ?? null;
}

let refusalWarnKey = '';
const refusalWarned = new Set<string>();

function warnRefusalOnce(songKey: string, reason: string, rowCount: number, rowsHash: number): void {
  if (songKey !== refusalWarnKey) {
    refusalWarnKey = songKey;
    refusalWarned.clear();
  }
  if (refusalWarned.has(reason)) return;
  refusalWarned.add(reason);
  console.warn(`[sly-snapshot] ⚠️ Snapshot refused: ${reason} (${rowCount} rows, rows hash ${rowsHash}).`);
}

/** Rule (a): the rows are still the previous track's (see retireRows), unless they can be this one's. */
function rowsAreRetired(lines: Element[], texts: string[], rowsHash: number): boolean {
  let nonEmpty = 0;
  let stale = 0;
  lines.forEach((el, i) => {
    const text = collapse(texts[i]);
    if (text === '') return;
    nonEmpty++;
    if (retiredRows.get(el) === text) stale++;
  });
  if (nonEmpty === 0 || stale / nonEmpty < 0.8) return false;
  const canonical = getCurrentCanonicalHash?.() ?? null;
  // Past the window the rows may be the current track's (bound to the wrong key
  // while the label lagged), but only if the current track has lyrics at all:
  // Spotify requested them, or their canonical hash is known. A track without
  // lyrics never does, so the previous track's lingering rows stay refused.
  const mayBeCurrent = canonical !== null || !!currentTrackRequested?.();
  const windowOpen = Date.now() - retiredAt < RETIRED_ROWS_WINDOW_MS;
  return (windowOpen || !mayBeCurrent) && (canonical === null || Number(canonical) !== rowsHash);
}

/**
 * True when the panel rows on screen are still the previous track's (the same rule
 * snapshotOriginals uses). slyCore's detector uses it so both pipelines agree that
 * such rows are no evidence about the current track.
 */
export function rowsOnScreenAreRetired(): boolean {
  const lines = getLyricsLines();
  if (lines.length === 0) return false;
  const texts = lines.map(nativeRowText);
  return rowsAreRetired(lines, texts, hashString(texts.join('|')));
}

function snapshotRefusal(lines: Element[], texts: string[], rowsHash: number): string | null {
  if (rowsAreRetired(lines, texts, rowsHash)) return 'rows belong to the previous track';
  return snapshotGuard?.(texts, rowsHash) ?? null;
}

// ---------------------------------------------------------------------------
// Cache-vs-rows check for the paths that paint cache.original's lyrics on native rows
// ---------------------------------------------------------------------------

const normalizeLine = (s: string | null | undefined): string => collapse((s ?? '').normalize('NFC'));

function linesLooselyMatch(original: string[], rowTexts: string[]): boolean {
  if (countWordLines(original) !== countWordLines(rowTexts)) return false;
  const known = new Set(original.map(normalizeLine));
  let nonEmpty = 0;
  let found = 0;
  for (const row of rowTexts) {
    const text = normalizeLine(row);
    if (text === '') continue;
    nonEmpty++;
    if (known.has(text)) found++;
  }
  return nonEmpty === 0 || found / nonEmpty >= 0.5;
}

/**
 * Native lines that replaced Spotify's rows (late native override), keyed by the
 * exact native lines: the Spotify rows they were aligned to. After an
 * override React may re-render Spotify's text, or the rows were never rewritten
 * (Romanized/Translated mode); those rows still belong to that cache.
 */
const nativeOverrides = new Map<string, string[]>();
/**
 * Exact key: hashString ignores separators, spaces and '♪', so a takeover's lines
 * (same words, another layout) would otherwise collide with an override's lines.
 */
const overrideKey = (lines: string[]): string => JSON.stringify(lines);

/** Test hook: forget the recorded native overrides. */
export function resetNativeOverrides(): void {
  nativeOverrides.clear();
}
const NATIVE_OVERRIDES_MAX = 20;

export function noteNativeOverride(nativeLines: string[], spotifyRows: string[]): void {
  const key = overrideKey(nativeLines);
  nativeOverrides.delete(key);
  nativeOverrides.set(key, [...spotifyRows]);
  if (nativeOverrides.size > NATIVE_OVERRIDES_MAX) {
    const oldest = nativeOverrides.keys().next().value;
    if (oldest !== undefined) nativeOverrides.delete(oldest);
  }
}

/**
 * The shape a late native override leaves (alignNativeToRows): native-script
 * lines laid out exactly like Spotify's Latin rows, a line with words on every
 * row with words and the rows' own spacer text everywhere else. Holds without
 * the in-memory override record, e.g. for the stored cache after a reload.
 * A takeover's lines (other spacer layout) or another song's lines do not fit.
 */
/** Lines up to the last line with words (an in-time upgrade keeps Spotify's trailing '' line, which has no row). */
const trimTrailingSpacers = (lines: string[]): string[] => {
  let n = lines.length;
  while (n > 0 && !hasLyricWords(lines[n - 1])) n--;
  return lines.slice(0, n);
};

function nativeLinesFitRomanizedRows(fullOriginal: string[], fullRowTexts: string[]): boolean {
  const original = trimTrailingSpacers(fullOriginal);
  const rowTexts = trimTrailingSpacers(fullRowTexts);
  if (original.length !== rowTexts.length || countWordLines(rowTexts) === 0) return false;
  const sameLayout = rowTexts.every((row, i) => (hasLyricWords(row)
    ? hasLyricWords(original[i])
    : !hasLyricWords(original[i]) && normalizeLine(original[i]) === normalizeLine(row)));
  return sameLayout && !isLatinScript(original) && isLatinScript(rowTexts);
}

/**
 * True when cache.original belongs to the rows on screen: same hash (the hash
 * ignores separators, whitespace and '♪', so a trailing '' line without a row
 * still matches), or the same number of lines with words and at least half of
 * the non-empty rows found among the cached lines. Rows rewritten by a native
 * override also match the Spotify text they replaced (this session's record, or
 * the layout check above).
 */
export function cacheMatchesRows(original: string[], rowTexts: string[]): boolean {
  const originalHash = hashString(original.join('|'));
  const rowsHash = hashString(rowTexts.join('|'));
  if (originalHash === rowsHash) return true;
  if (linesLooselyMatch(original, rowTexts)) return true;
  const replaced = nativeOverrides.get(overrideKey(original));
  if (replaced && (hashString(replaced.join('|')) === rowsHash || linesLooselyMatch(replaced, rowTexts))) return true;
  return nativeLinesFitRomanizedRows(original, rowTexts);
}

/**
 * Guard for the native-row paint paths: true unless the panel shows native rows
 * (no #lyrics-root-sync takeover) and `original` does not belong to them. An empty
 * cache or no rows never blocks (nothing would be painted from the cache).
 */
export function cacheFitsNativeRows(original: string[], rows: Element[] = getLyricsLines()): boolean {
  if (document.getElementById('lyrics-root-sync')) return true;
  if (original.length === 0 || rows.length === 0) return true;
  return cacheMatchesRows(original, rows.map(nativeRowText));
}

let skipLogKey = '';
const skipLogged = new Set<string>();

/** Logs once per (song, path) that a paint path was skipped by cacheFitsNativeRows. */
export function noteCacheSkip(path: string, cacheLines: number, rowCount: number): void {
  const key = getNowPlayingKey();
  if (key !== skipLogKey) {
    skipLogKey = key;
    skipLogged.clear();
  }
  if (skipLogged.has(path)) return;
  skipLogged.add(path);
  console.log(`[sly-guard] ⏭️ ${path}: the ${cacheLines} cached lines do not belong to the ${rowCount} rows on screen. Not painting them.`);
}

/**
 * The paint paths found a cache that does not belong to the native rows on screen.
 * After a takeover ends on the same song (sly:release) the cache still holds the
 * takeover's lines: replace them, in place, with the native rows (same snapshot
 * guards as any snapshot). Any other cache is kept: it may be right and the rows
 * wrong (e.g. the next track's rows rendered before the widget label changed).
 * Returns true when the cache now holds the rows.
 */
export function reconcileTakeoverCache(
  store: { cache: SongCache; cacheFromTakeover: boolean; trackId: string | null },
  path: string,
): boolean {
  if (!store.cacheFromTakeover || document.getElementById('lyrics-root-sync')) return false;
  if (getLyricsLines().length === 0) return false;
  // Only for a takeover that ended on the same song. When the bridge already names
  // another track the release is a song change (slyCore's TRACK SWITCH) that the
  // widget label has not caught up with: the rows are about to be replaced.
  const bridge = bridgeTrackId();
  if (!bridge || !store.trackId || bridge !== store.trackId) return false;
  const fresh: SongCache = { original: [], processed: new Map() };
  if (snapshotOriginals(fresh) !== 'ok') return false;
  console.log(`[sly-guard] ${path}: replaced the takeover's ${store.cache.original.length} cached lines with the ${fresh.original.length} native rows on screen.`);
  store.cache.original = fresh.original;
  store.cache.processed.clear();
  store.cacheFromTakeover = false;
  return true;
}

/**
 * Snapshots the rows on screen into cache.original.
 * 'refused': the rows belong to another track (no attribute written, cache untouched);
 * 'empty': fewer than 3 lines with text, or the BUG-4 wait; 'ok': cache.original set.
 */
export function snapshotOriginals(cache: SongCache): SnapshotResult {
  const lines = getLyricsLines();
  const currentKey = getNowPlayingKey();
  console.log(`[sly-audit] 📸 snapshotOriginals executing for active songKey: "${currentKey}". Snapped ${lines.length} lines. First line preview: "${lines[0]?.textContent?.trim() || 'empty'}"`);

  // Ownership checks come before any attribute write.
  const texts = lines.map(nativeRowText);
  const rowsHash = hashString(texts.join('|'));
  const refusal = snapshotRefusal(lines, texts, rowsHash);
  if (refusal) {
    warnRefusalOnce(currentKey, refusal, lines.length, rowsHash);
    return 'refused';
  }

  lines.forEach((el) => {
    if (el.hasAttribute('data-sly-original')) return;
    
    // SLY FIX: Never read from .sly-main-line during a snapshot. 
    // If the extension has already injected spans (due to a race), 
    // we must ignore them and use textContent (which should be the native text 
    // if Spotify just updated the node) or ideally, we should have purged first.
    el.setAttribute('data-sly-original', el.textContent ?? '');
  });

  const snapped = lines.map(
    (el) => el.getAttribute('data-sly-original') ?? ''
  );

  const hasContent = snapped.filter(l => l.trim().length > 0).length >= 3;
  if (!hasContent) return 'empty';

  // BUG-4 guard: Spotify may be showing its own romanization of a non-Latin
  // song. Refuse the snapshot ONLY while the interceptor is still trying to
  // fetch the native script (between SLY_INTERCEPT_START and SLY_INTERCEPT_END);
  // the 'sly:interceptor_settled' listener re-runs the pending mode switch.
  // Once the interceptor has settled without an upgrade, the Latin lines on
  // screen are the only lyrics there are: refusing them would leave
  // cache.original empty and silently break Romanized/Translated.
  // A late native upgrade (SKL_NATIVE_LYRICS late:true) still replaces them.
  const songLang = (window as any).spotifyState?.language as string | undefined;
  const isNonLatinLang = !!songLang && !!(window as any).SLY_NATIVE_LANGUAGES?.has(songLang);
  const interceptorInFlight = !!(window as any).slyInternalState?.interceptorActive;
  if (interceptorInFlight && isLatinScript(snapped) &&
      (isNonLatinLang || isLikelyRomanizedFallback(snapped, songLang ?? null).romanized)) {
    console.warn(`[sly-snapshot] ⚠️ BUG-4 guard: interceptor in flight and DOM text looks like a romanized fallback (language tag "${songLang}"). Waiting for the native upgrade before snapshotting.`);
    // Clean up the data-sly-original attributes we just set — they contain the wrong text.
    lines.forEach((el) => el.removeAttribute('data-sly-original'));
    return 'empty';
  }

  cache.original = snapped;
  bindRows(lines);
  return 'ok';
}

/**
 * Capitalizes the first alphabetic character in a string, preserving any leading
 * non-alphabetic characters (e.g., "(dha" -> "(Dha").
 */
export function capitalizeLine(line: string): string {
  if (!line) return line;
  return line.replace(/^([^a-zA-Z]*)([a-z])/, (match, prefix, firstChar) => {
    return prefix + firstChar.toUpperCase();
  });
}

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()♪?…\s]/g, '')
    .trim();
}

/** Canonical form for duplicate checks: NFC, case-folded, without punctuation, symbols or whitespace. */
function normalizeForCompare(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

/**
 * True when a processed line differs from its original in a way a reader would
 * notice. Used to decide whether the dual (original) line is worth showing:
 * romanization can hand back an untouched line in a different Unicode form
 * (NFD vs NFC, e.g. Japanese dakuten) or with only punctuation/spacing
 * changes, which would render as an identical duplicate.
 */
export function isMeaningfullyDifferent(original?: string | null, processed?: string | null): boolean {
  if (!original || !processed) return false;
  return normalizeForCompare(original) !== normalizeForCompare(processed);
}

function getBigrams(str: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.substring(i, i + 2));
  }
  return bigrams;
}

function getDiceSimilarity(s1: string, s2: string): number {
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  const set2 = new Set(b2);
  let intersection = 0;
  for (const b of b1) {
    if (set2.has(b)) {
      intersection++;
    }
  }
  const totalLength = b1.length + b2.length;
  return totalLength > 0 ? (2 * intersection) / totalLength : 0;
}

export function applyLinesToDOM(
  lines: string[] | null | undefined,
  originals: string[] | undefined,
  dualLyricsEnabled: boolean,
  setApplying: (v: boolean) => void,
  targetElements?: Element[]
): void {
  traceEvent(`paint:${Array.isArray(lines) ? lines.length : 'none'}`);
  if (!Array.isArray(lines)) {
    console.warn('[sly-dom] 🚫 applyLinesToDOM called with invalid/non-array lines:', lines);
    return;
  }

  setApplying(true);

  const domElements = targetElements ?? getLyricsLines();
  const isTakeoverMode = document.getElementById('lyrics-root-sync') !== null;
  const useTextMatching = !isTakeoverMode && Array.isArray(originals) && originals.length > 0;

  // Native rows that show this source's lyrics belong to the current key (retireRows).
  if (!isTakeoverMode) {
    const source = Array.isArray(originals) && originals.length > 0 ? originals : lines;
    const rows = domElements.filter(el => !!el && el.isConnected);
    const rowTexts = rows.map(el => (el.querySelector('.sly-main-line, .sly-dual-line')
      ? el.getAttribute('data-sly-original') ?? ''
      : el.textContent ?? ''));
    if (source.length > 0 && rows.length > 0 && cacheMatchesRows(source, rowTexts)) bindRows(rows);
  }

  console.log(`%c[sly-dom] 🚀 applyLinesToDOM invoked!`, 'color: #38bdf8; font-weight: bold;');
  console.log(`[sly-dom] Args: linesLength=${lines.length} | originalsLength=${originals?.length ?? 'none'} | dualEnabled=${dualLyricsEnabled} | targetElementsGiven=${!!targetElements} | domElementsLength=${domElements.length} | isTakeoverMode=${isTakeoverMode}`);
  if (useTextMatching) {
    console.log(`[sly-dom] Text matching is ACTIVE. Space count in cache.original:`, originals!.filter(l => !l.trim()).length);
  } else {
    console.log(`[sly-dom] Text matching is INACTIVE (falling back strictly to 1:1 index alignment).`);
  }

  let currentArrayIdx = 0;

  console.groupCollapsed(`[sly-dom] 🔍 Detailed line matching and rendering details (${domElements.length} lines)`);
  domElements.forEach((el, i) => {
    // BUG-15 Fix: If the element is no longer connected to the DOM, skip it.
    // This happens if a panel close -> reopen occurred during an async fetch.
    // We allow 'lyrics-root-sync' even if not yet connected (during initial injection).
    if (!el) {
      console.log(`[sly-dom] Element [${i}] is null! Skipping.`);
      return;
    }
    if (!el.isConnected && el.id !== 'lyrics-root-sync') {
      console.log(`[sly-dom] Element [${i}] is not connected (detached). Skipping.`);
      return;
    }

    let matchIndex = i; // Default index-based fallback

    const isProcessed = el.querySelector('.sly-main-line, .sly-dual-line') !== null;
    let domOriginalText = '';
    const rawAttrOriginal = el.getAttribute('data-sly-original');

    if (isProcessed) {
      domOriginalText = rawAttrOriginal ?? '';
      console.log(`[sly-dom] [${i}] Element is PROCESSED (has spans) | textContent="${el.textContent?.trim()}" | data-sly-original attribute="${rawAttrOriginal}"`);
    } else {
      domOriginalText = el.textContent?.trim() ?? '';
      console.log(`[sly-dom] [${i}] Element is NATIVE/RECYCLED (no spans) | textContent="${domOriginalText}" | data-sly-original attribute="${rawAttrOriginal}"`);
      if (rawAttrOriginal !== null) {
        console.log(`[sly-dom]   -> Cleared stale data-sly-original attribute!`);
        el.removeAttribute('data-sly-original');
      }
    }

    domOriginalText = domOriginalText.replace(/\s+/g, ' ').trim();
    const originalTextToRestore = domOriginalText;

    const paddingLineClass = window.SPOTIFY_CLASSES?.paddingLineHelper || 'aLaX8poOH8kdbmGf';
    const isSpacer = el.classList.contains(paddingLineClass) ||
                     el.parentElement?.classList.contains(paddingLineClass) ||
                     (i < 2 && domOriginalText === '');

    if (isSpacer) {
      matchIndex = -1;
      console.log(`[sly-dom] [${i}] Identified as SPACER | Mapping to matchIndex=-1 (Ignored)`);
    } else if (useTextMatching) {
      const isDomInstrumental = domOriginalText === '' || domOriginalText === '♪';

      let foundIndex = -1;

      if (isDomInstrumental) {
        console.log(`[sly-dom] [${i}] Instrumental matching search starting from currentArrayIdx=${currentArrayIdx}...`);
        for (let j = currentArrayIdx; j < originals!.length; j++) {
          const origText = (originals![j] ?? '').replace(/\s+/g, ' ').trim();
          const isOrigInstrumental = origText === '' || origText === '♪';

          if (isOrigInstrumental) {
            let hasVocalSkipped = false;
            for (let k = currentArrayIdx; k < j; k++) {
              const betweenText = (originals![k] ?? '').replace(/\s+/g, ' ').trim();
              if (betweenText !== '' && betweenText !== '♪') {
                hasVocalSkipped = true;
                break;
              }
            }
            if (!hasVocalSkipped) {
              foundIndex = j;
              console.log(`[sly-dom]   -> Found sliding-window instrumental match at index=${foundIndex}`);
              break;
            }
          }
        }
      } else {
        console.log(`[sly-dom] [${i}] Vocal Line Sørensen-Dice matching search starting from currentArrayIdx=${currentArrayIdx}...`);
        const normDom = normalizeText(domOriginalText);
        if (normDom !== '') {
          let bestIndex = -1;
          let bestScore = 0;
          const searchLimit = Math.min(currentArrayIdx + 15, originals!.length);

          for (let j = currentArrayIdx; j < searchLimit; j++) {
            const origText = (originals![j] ?? '').replace(/\s+/g, ' ').trim();
            const isOrigInstrumental = origText === '' || origText === '♪';
            if (isOrigInstrumental) continue;

            const normOrig = normalizeText(origText);
            if (normOrig === '') continue;

            if (normDom === normOrig) {
              bestIndex = j;
              bestScore = 1.0;
              break;
            }

            if (normDom.includes(normOrig) || normOrig.includes(normDom)) {
              const score = Math.min(normDom.length, normOrig.length) / Math.max(normDom.length, normOrig.length);
              if (score > bestScore) {
                bestScore = score;
                bestIndex = j;
              }
            }

            const dice = getDiceSimilarity(normDom, normOrig);
            if (dice >= 0.50 && dice > bestScore) {
              bestScore = dice;
              bestIndex = j;
            }
          }

          if (bestIndex !== -1 && bestScore >= 0.45) {
            foundIndex = bestIndex;
            console.log(`[sly-dom]   -> Found sliding-window vocal match at index=${foundIndex} with score=${bestScore.toFixed(3)} ("${originals![foundIndex]}")`);
          }
        }
      }

      if (foundIndex === -1 && !isDomInstrumental) {
        console.log(`[sly-dom] [${i}] Sliding window mismatch. Running fallback global search for exact normalized match...`);
        const normDom = normalizeText(domOriginalText);
        if (normDom !== '') {
          for (let j = 0; j < originals!.length; j++) {
            const origText = (originals![j] ?? '').replace(/\s+/g, ' ').trim();
            if (normDom === normalizeText(origText)) {
              foundIndex = j;
              console.log(`[sly-dom]   -> Found fallback global match at index=${foundIndex} ("${originals![foundIndex]}")`);
              break;
            }
          }
        }
      }

      if (foundIndex !== -1) {
        matchIndex = foundIndex;
        currentArrayIdx = foundIndex + 1;
        console.log(`[sly-dom] [${i}] Matched successfully! matchIndex=${matchIndex} | Advanced sliding-window pointer to j=${currentArrayIdx}`);
      } else {
        console.warn(`[sly-dom] ⚠️ [${i}] Could NOT match native text "${domOriginalText}" inside originals cache! Falling back to 1:1 index alignment (matchIndex=${matchIndex})`);
        matchIndex = i;
      }
    }

    if (matchIndex === -1) {
      el.textContent = '';
      el.removeAttribute('data-sly-original');
      console.log(`[sly-dom] [${i}] Spacer div ignored & cleared.`);
      return;
    }

    if (originalTextToRestore !== '') {
      el.setAttribute('data-sly-original', originalTextToRestore);
      console.log(`[sly-dom] [${i}] Set data-sly-original attribute to raw DOM text: "${originalTextToRestore}"`);
    }

    if (lines[matchIndex] === undefined) {
      console.warn(`[sly-dom] [${i}] Target line at matchIndex=${matchIndex} is undefined inside processed lines! skipping replacement.`);
      return;
    }

    const processedLine = capitalizeLine(lines[matchIndex]);

    const showDual =
      dualLyricsEnabled &&
      originals !== undefined &&
      originals[matchIndex] !== undefined &&
      isMeaningfullyDifferent(originals[matchIndex], lines[matchIndex]);

    console.log(`[sly-dom] [${i}] Rendering: showDual=${showDual} | Original="${originals?.[matchIndex]}" | Processed/Romanized="${processedLine}"`);

    if (showDual) {
      el.textContent = '';
      const mainSpan = document.createElement('span');
      mainSpan.className = 'sly-main-line';
      mainSpan.textContent = processedLine;
      el.appendChild(mainSpan);

      const subSpan = document.createElement('span');
      subSpan.className = 'sly-dual-line';
      subSpan.textContent = originals![matchIndex];
      el.appendChild(subSpan);
    } else {
      if (originalTextToRestore === '') {
        el.textContent = '';
      } else {
        el.textContent = '';
        const mainSpan = document.createElement('span');
        mainSpan.className = 'sly-main-line';
        mainSpan.textContent = processedLine;
        el.appendChild(mainSpan);
      }
    }
  });
  console.groupEnd();

  // CENTRALIZED DEBUG LOGGING: Spit out the entire lyrics side-by-side in console.table
  try {
    const isOriginalMode = !originals || originals.length === 0 || originals === lines;
    const modeName = isOriginalMode ? 'ORIGINAL' : 'PROCESSED';
    
    console.groupCollapsed(`%c[sly-debug] 📋 ENTIRE LYRICS APPLIED (Mode: ${modeName}) (${lines.length} lines)`, 'color: #1DB954; font-weight: bold; font-size: 12px;');
    console.log(`[sly-debug] Applied Lines Count: ${lines.length}`);
    
    const table = lines.map((line, idx) => {
      const orig = originals?.[idx] ?? line;
      if (isOriginalMode) {
        return {
          Index: idx,
          Original: orig
        };
      } else {
        return {
          Index: idx,
          Original: orig,
          Applied: line
        };
      }
    });
    console.table(table);
    console.groupEnd();
  } catch (logErr) {
    console.warn('[sly-debug] Failed to print entire lyrics table:', logErr);
  }

  // setTimeout defers the flag reset to a macrotask, ensuring the MutationObserver
  // microtask (which fires during the same synchronous task as the DOM writes above)
  // still sees isApplying=true and skips its re-apply check.
  setTimeout(() => { setApplying(false); }, 50);
}

/** Puts one row back to Spotify's text: 'restored' (text and marker), 'stripped' (our spans only) or null. */
function restoreRow(el: Element): 'restored' | 'stripped' | null {
  const original = el.getAttribute('data-sly-original');
  if (original !== null) {
    el.textContent = original;
    el.removeAttribute('data-sly-original');
    return 'restored';
  }
  const innerSpans = el.querySelectorAll('.sly-main-line, .sly-dual-line');
  if (innerSpans.length === 0) return null;
  innerSpans.forEach(s => s.remove());
  return 'stripped';
}

let panelSongWatcher: MutationObserver | null = null;

/**
 * Cleans a lyrics panel when Spotify hands it to another song (its bridge tag changes from
 * one track to another): its rows still carry the previous song's paint and markers, which
 * would otherwise be read as the new song's originals. Panels of other songs are otherwise
 * left painted (purgeSlyDOM keepSongsOtherThan). Idempotent.
 */
export function watchPanelSongChanges(): void {
  if (panelSongWatcher || typeof MutationObserver === 'undefined') return;
  panelSongWatcher = new MutationObserver(records => {
    for (const rec of records) {
      const el = rec.target as Element;
      const now = el.getAttribute(PANEL_TRACK_ATTR);
      if (!rec.oldValue || !now || rec.oldValue === now) continue;
      traceEvent('panelSongChanged');
      el.querySelectorAll('[data-testid="lyrics-line"] > div').forEach(restoreRow);
      el.querySelectorAll('[data-sly-original]').forEach(restoreRow);
    }
  });
  panelSongWatcher.observe(document.documentElement, {
    subtree: true, attributes: true, attributeOldValue: true, attributeFilter: [PANEL_TRACK_ATTR],
  });
}
