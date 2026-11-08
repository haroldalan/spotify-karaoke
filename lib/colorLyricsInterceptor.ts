import { base62ToHex } from './utils/spotifyUtils';
import { hasLyricWords, countWordLines } from './lyrics/lineUtils';
import { hashString } from './utils/hashUtils';
import { isLikelyRomanizedFallback } from './lyrics/romanizedDetector';

/**
 * Convenience wrapper: posts a SLY_* message to the content-script world.
 * Uses '*' as the target origin — consistent with lyric-test/modules/bridge/interceptor.js.
 * (SKL_NATIVE_LYRICS uses window.location.origin separately for security.)
 */
function slyPost(type: string, trackId?: string, extra?: Record<string, unknown>): void {
    window.postMessage(
        { 
            source: 'SLY_ACTION_GATEWAY', 
            action: { type, ...(trackId ? { trackId } : {}), ...(extra ?? {}) } 
        },
        '*',
    );
}

/**
 * The page's link to the native-script lookup in the background
 * (lib/lyricsProviders/nativeLyrics.ts), relayed by the content script.
 */
export interface NativeLyricsClient {
    notifyMetadata(id: string, name: string, artist: string): void;
    newInterception(spotifyTrackId: string): number | Promise<number>;
    fetchNativeLines(
        spotifyTrackId: string,
        hexGid: string,
        interceptId: number,
        /** Lines with words in Spotify's (romanized) answer: a native copy must have about as many. */
        spotifyWordLines?: number,
    ): Promise<any[] | null>;
}

/**
 * Maximum time Spotify's color-lyrics response is held while the
 * native-script lookup (newInterception + fetchNativeLines) runs (contract K5).
 * When it expires, Spotify's response is released and the lookup finishes "late".
 */
export const NATIVE_HOLD_BUDGET_MS = 4000;

const COLOR_LYRICS_PATH = /^\/color-lyrics\/v2\/track\/([A-Za-z0-9]+)/;

function parseUrl(url: string): URL | null {
    try {
        return new URL(url, typeof location !== 'undefined' ? location.href : undefined);
    } catch {
        return null;
    }
}

/**
 * True for Spotify color-lyrics requests on any *.spotify.com host
 * (spclient.wg.spotify.com, gae2-spclient.spotify.com, …).
 */
export function isColorLyricsUrl(url: string): boolean {
    const u = parseUrl(url);
    if (!u) return false;
    const host = u.hostname.toLowerCase();
    if (host !== 'spotify.com' && !host.endsWith('.spotify.com')) return false;
    return COLOR_LYRICS_PATH.test(u.pathname);
}

/** Base62 track id from a color-lyrics URL path, or undefined. */
export function extractColorLyricsTrackId(url: string): string | undefined {
    const u = parseUrl(url);
    return u ? u.pathname.match(COLOR_LYRICS_PATH)?.[1] : undefined;
}

function jsonResponse(body: unknown, fallbackResponse: Response): Response {
    const headers = new Headers(fallbackResponse.headers);
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(body), {
        status: fallbackResponse.status,
        statusText: fallbackResponse.statusText,
        headers,
    });
}

// Latest lookup generation per track (MAIN world). A late result whose
// generation is no longer current belongs to a superseded lookup and is dropped.
const _lookupGeneration = new Map<string, number>();
const LOOKUP_GEN_CAP = 200;

function nextLookupGeneration(trackId: string): number {
    const gen = (_lookupGeneration.get(trackId) ?? 0) + 1;
    _lookupGeneration.delete(trackId);
    _lookupGeneration.set(trackId, gen);
    if (_lookupGeneration.size > LOOKUP_GEN_CAP) {
        const oldest = _lookupGeneration.keys().next().value;
        if (oldest !== undefined) _lookupGeneration.delete(oldest);
    }
    return gen;
}

const BUDGET_EXPIRED = Symbol('budget-expired');

// A letter from a script other than Latin (Hangul, Kana, Han, Devanagari, Cyrillic, …).
// Common/Inherited letters such as modifier apostrophes are not counted.
const NATIVE_SCRIPT_LETTER = /(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])\p{L}/u;

/**
 * True when any line contains a native-script letter. A romanized fallback is a
 * full transliteration with no native letters at all, whereas native lyrics that
 * mix in Latin-script (e.g. English) lines can fall below the detector's
 * native-script ratio and be classified romanized by their language tag alone.
 */
function hasNativeScriptLetters(lines: readonly string[]): boolean {
    return lines.some((l) => NATIVE_SCRIPT_LETTER.test(l));
}

/** A line starting this much before a native line's start still belongs to it. */
const PAIR_TOLERANCE_MS = 750;
/** Share of native lines that must find Spotify lines before any pair is used. */
const MIN_PAIRED_SHARE = 0.8;

/**
 * Spotify's romanized line(s) for each native line with words, by time, for synced native
 * lines that do not line up 1:1 with Spotify's (another line split, same release): the
 * Spotify word lines starting within a native line's span, joined. '' where none start
 * there. Null when too few native lines find one (the copies are not timed alike).
 */
export function romanizedByTime(spotifyLines: any[], nativeLines: any[]): string[] | null {
    const ms = (l: any) => Number(l?.startTimeMs);
    const native = nativeLines.filter((l: any) => hasLyricWords(l?.words) && Number.isFinite(ms(l)));
    const spotify = spotifyLines.filter((l: any) => hasLyricWords(l?.words) && Number.isFinite(ms(l)));
    if (!native.length || !spotify.length || native.every((l: any) => ms(l) === 0)) return null;
    const used = new Set<number>();
    const out = native.map((line: any, i: number) => {
        const from = ms(line) - PAIR_TOLERANCE_MS;
        const to = i + 1 < native.length ? ms(native[i + 1]) - PAIR_TOLERANCE_MS : Infinity;
        const words: string[] = [];
        spotify.forEach((s: any, k: number) => {
            if (!used.has(k) && ms(s) >= from && ms(s) < to) { used.add(k); words.push(String(s.words).trim()); }
        });
        return words.join(' ');
    });
    const paired = out.filter(Boolean).length;
    return paired / native.length >= MIN_PAIRED_SHARE ? out : null;
}

/**
 * Builds the lyrics lines/syncType that replace Spotify's romanized ones.
 * - Over a synced Spotify response, native lines with the same number of lines WITH WORDS
 *   (synced or not) → keep Spotify's timings (licensed, timed to the release) and write the
 *   native words onto Spotify's word lines in order ('♪' / empty lines keep Spotify's text).
 *   Each native line then has Spotify's romanized line: `romanizedWordLines` (in order).
 * - Otherwise synced native lines keep their own timings; unsynced native lines (every
 *   startTimeMs '0') over a synced response (K6) mark the response UNSYNCED.
 * - SYLLABLE_SYNCED with native lines that carry no syllables → LINE_SYNCED.
 */
function buildUpgradedLyrics(
    spotifyLines: any[],
    nativeLines: any[],
    syncType: string | undefined,
): { lines: any[]; syncType: string | undefined; romanizedWordLines?: string[] } {
    let outLines: any[] = nativeLines;
    let outSyncType = syncType;
    let romanizedWordLines: string[] | undefined;

    const nativeUnsynced = nativeLines.every((l: any) => String(l?.startTimeMs) === '0');
    if (syncType !== 'UNSYNCED') {
        const nativeWordLines = nativeLines.filter((l: any) => hasLyricWords(l?.words));
        const spotifyWordCount = countWordLines(spotifyLines.map((l: any) => l?.words));
        if (nativeWordLines.length > 0 && nativeWordLines.length === spotifyWordCount) {
            let k = 0;
            outLines = spotifyLines.map((l: any) => (
                hasLyricWords(l?.words)
                    ? { ...l, words: nativeWordLines[k++]?.words ?? '', syllables: [] }
                    : { ...l, syllables: [] }
            ));
            romanizedWordLines = spotifyLines.map((l: any) => l?.words).filter(hasLyricWords);
        } else if (nativeUnsynced) {
            outSyncType = 'UNSYNCED';
        } else {
            // Synced native lines split differently from Spotify's: pair them by time.
            romanizedWordLines = romanizedByTime(spotifyLines, nativeLines) ?? undefined;
        }
    }

    if (outSyncType === 'SYLLABLE_SYNCED') {
        const hasSyllables = outLines.some((l: any) => Array.isArray(l?.syllables) && l.syllables.length > 0);
        if (!hasSyllables) outSyncType = 'LINE_SYNCED';
    }

    return { lines: outLines, syncType: outSyncType, romanizedWordLines };
}

export async function handleColorLyrics(
    originalResponse: Response,
    fallbackResponse: Response,
    url: string,
    native: NativeLyricsClient,
): Promise<Response> {
    let data: any = null;

    // Extract the track ID once — needed for all signals.
    const spotifyTrackId = extractColorLyricsTrackId(url);

    // ── Signal 1: SLY_FETCH_START ─────────────────────────────────────────────
    // Tells the DOM engine that Spotify's color-lyrics response is being processed.
    // Sets slyInternalState.isSpotifyFetching = true so the poll loop pauses.
    // Port of: lyric-test/modules/bridge/interceptor.js lines 25-27
    if (spotifyTrackId) slyPost('SLY_FETCH_START', spotifyTrackId);

    // Guard: non-2xx responses (401, 404, 429, 503, 304, …) won't contain usable JSON.
    // A 404 specifically means Spotify has no lyrics at all → MISSING.
    if (!originalResponse.ok) {
        if (spotifyTrackId && originalResponse.status === 404) {
            // Port of: lyric-test/modules/bridge/interceptor.js lines 32-33
            slyPost('SLY_PREFETCH_REPORT', spotifyTrackId, { state: 'MISSING' });
        }
        if (spotifyTrackId) slyPost('SLY_FETCH_END', spotifyTrackId);
        return fallbackResponse;
    }

    // Tracks whether SLY_INTERCEPT_START has been sent. Used by the catch block
    // to guarantee SLY_INTERCEPT_END is always paired — prevents the DOM engine
    // from being stuck with interceptorActive = true on an unexpected exception.
    let interceptStarted = false;

    try {
        data = await originalResponse.json() as any;

        const language      = data.lyrics?.language as string | undefined;
        const isDenseTypeface = data.lyrics?.isDenseTypeface as boolean | undefined;
        const syncType      = data.lyrics?.syncType as string | undefined;
        const lines         = data.lyrics?.lines as unknown[] | undefined;
        // The lookup finds metadata by the base62 id or the hex GID; a failed conversion
        // must not block the lookup.
        const hexGid        = spotifyTrackId ? base62ToHex(spotifyTrackId) : null;

        // Classify by the text itself (K3): Spotify's language tag is unreliable for
        // romanized lyrics (e.g. romanized Hindi tagged "id"), and native-script
        // lines must never be "upgraded". Any native-script letter vetoes the
        // verdict: mixed native/English lyrics (common in K-pop/J-pop) can fall
        // below the detector's native-script ratio and match on the tag alone.
        const lineWords = (lines ?? []).map((l: any) => (typeof l?.words === 'string' ? l.words : ''));
        const verdict = lineWords.length > 0
            ? isLikelyRomanizedFallback(lineWords, language ?? null)
            : { romanized: false, lang: null, reason: 'too-short' as const };
        const nativeLettersPresent = verdict.romanized && hasNativeScriptLetters(lineWords);
        const shouldUpgrade = verdict.romanized && !nativeLettersPresent;

        console.log(`[sly-interceptor] Classification diagnostics for "${spotifyTrackId}":`, {
            language,
            isDenseTypeface,
            syncType,
            romanized: shouldUpgrade,
            romanizedLang: shouldUpgrade ? verdict.lang : null,
            reason: nativeLettersPresent ? 'native-letters' : verdict.reason,
        });

        // ── Signal 2/3: SLY_PREFETCH_REPORT ──────────────────────────────────
        // Report the track's lyric state to the content-script's preFetch registry
        // BEFORE deciding whether to attempt a native upgrade. This ensures the
        // detector's §4 check is informed even for Latin-script or dense tracks
        // that we won't try to upgrade.
        // Port of: lyric-test/modules/bridge/interceptor.js lines 52-63
        if (spotifyTrackId) {
            if (!data?.lyrics || !lines || lines.length === 0) {
                slyPost('SLY_PREFETCH_REPORT', spotifyTrackId, { state: 'MISSING', nativeMissing: true });
            } else if (syncType === 'UNSYNCED') {
                slyPost('SLY_PREFETCH_REPORT', spotifyTrackId, { state: 'UNSYNCED' });
            } else if (shouldUpgrade) {
                slyPost('SLY_PREFETCH_REPORT', spotifyTrackId, { state: 'ROMANIZED', romanizedLang: verdict.lang });
            }
        }

        // Early-exit: no upgrade needed (Latin / native script / no track ID).
        if (!shouldUpgrade || !spotifyTrackId) {
            if (spotifyTrackId && data?.lyrics?.lines) {
                const wordsArray = data.lyrics.lines.map((l: any) => l.words || '');
                const canonHash = hashString(wordsArray.join('|'));
                slyPost('SLY_CANONICAL_HASH', spotifyTrackId, { canonHash });
            }
            if (spotifyTrackId) slyPost('SLY_FETCH_END', spotifyTrackId);
            return jsonResponse(data, fallbackResponse);
        }

        if (!hexGid) {
            console.warn('[SKaraoke:Interceptor] Base62 conversion failed for track ID (metadata search disabled):', spotifyTrackId);
        }

        const spotifyLines = lines as any[];
        const lookupGen = nextLookupGeneration(spotifyTrackId);

        // ── Signal 4: SLY_INTERCEPT_START ─────────────────────────────────────
        // Tells the DOM engine to suspend decisions while the native-script upgrade is in
        // progress. The DOM engine will not make any injection decisions until
        // SLY_INTERCEPT_END is received.
        // Port of: lyric-test/modules/bridge/interceptor.js line 91
        slyPost('SLY_INTERCEPT_START', spotifyTrackId);
        interceptStarted = true;

        // newInterception + fetchNativeLines share one hold budget (K5).
        const lookup: Promise<any[] | null> = (async () => {
            // Increment generation only for real intercepts.
            const interceptId = await native.newInterception(spotifyTrackId);
            return await native.fetchNativeLines(spotifyTrackId, hexGid ?? '', interceptId,
                countWordLines(spotifyLines.map((l: any) => l?.words)));
        })().catch((e) => {
            console.warn('[SKaraoke:Interceptor] Native lookup failed:', e);
            return null;
        });

        let budgetTimer: ReturnType<typeof setTimeout> | undefined;
        const budget = new Promise<typeof BUDGET_EXPIRED>((resolve) => {
            budgetTimer = setTimeout(() => resolve(BUDGET_EXPIRED), NATIVE_HOLD_BUDGET_MS);
        });
        const outcome = await Promise.race([lookup, budget]);
        clearTimeout(budgetTimer);

        if (outcome === BUDGET_EXPIRED) {
            console.warn(`[SKaraoke:Interceptor] Native lookup exceeded ${NATIVE_HOLD_BUDGET_MS}ms; releasing Spotify's response and continuing in the background.`);

            // Release Spotify's (unmodified) response now. No SLY_CANONICAL_HASH here:
            // Spotify's romanized words are not canonical while the native lookup is
            // pending (their hash would purge a cached native-script entry on replay).
            // A late success adopts the applied lines' hash; a late failure leaves it unset.
            slyPost('SLY_INTERCEPT_END', spotifyTrackId);
            interceptStarted = false;
            slyPost('SLY_FETCH_END', spotifyTrackId);

            void lookup.then((lateLines) => {
                if (_lookupGeneration.get(spotifyTrackId) !== lookupGen) {
                    console.log('[SKaraoke:Interceptor] Dropping superseded late native lookup for', spotifyTrackId);
                    return;
                }
                if (!lateLines || lateLines.length === 0) {
                    console.warn('[SKaraoke:Interceptor] Late native restoration failed or returned no lines.');
                    slyPost('SLY_FORCE_FALLBACK', spotifyTrackId);   // → forces Layer 2 (YTM/LRCLIB)
                    return;
                }
                const lateWords = lateLines.map((l: any) => l?.words || '');
                const spotifyWordLines = spotifyLines.map((l: any) => l?.words).filter(hasLyricWords);
                const romanizedForLate = countWordLines(lateWords) === spotifyWordLines.length
                    ? spotifyWordLines : romanizedByTime(spotifyLines, lateLines);
                slyPost('SKL_NATIVE_LYRICS', spotifyTrackId, {
                    nativeLines: lateWords,
                    isRomanizedUpgrade: true,
                    canonHash: hashString(lateWords.join('|')),
                    late: true,
                    spotifyLineCount: spotifyLines.length,
                    // K5: receivers compare lines WITH WORDS ('♪' / '' differ between sources).
                    spotifyWordLineCount: countWordLines(spotifyLines.map((l: any) => l?.words)),
                    // Spotify's romanized lines, for Romanized mode, when they pair up line for line.
                    ...(romanizedForLate ? { romanizedWordLines: romanizedForLate } : {}),
                });
            });

            return jsonResponse(data, fallbackResponse);
        }

        const nativeLines = outcome;

        if (!nativeLines || nativeLines.length === 0) {
            console.warn('[SKaraoke:Interceptor] Native restoration failed or returned no lines.');

            // ── Signals 5 + 6 + 7 (failure path) ────────────────────────────
            // Port of: lyric-test/modules/bridge/interceptor.js lines 95-99
            slyPost('SLY_INTERCEPT_END', spotifyTrackId);
            interceptStarted = false;
            // A newer lookup for the same track superseded this one (the background bumped the
            // generation, so this one returned null): let the newer lookup decide.
            if (_lookupGeneration.get(spotifyTrackId) === lookupGen) {
                slyPost('SLY_FORCE_FALLBACK', spotifyTrackId);   // → forces Layer 2 (YTM/LRCLIB)
            }
            slyPost('SLY_FETCH_END', spotifyTrackId);

            return jsonResponse(data, fallbackResponse);
        }

        const upgraded = buildUpgradedLyrics(spotifyLines, nativeLines, syncType);

        const wordsArray = upgraded.lines.map((l: any) => l.words || '');
        const canonHash = hashString(wordsArray.join('|'));
        slyPost('SLY_CANONICAL_HASH', spotifyTrackId, { canonHash });

        slyPost('SKL_NATIVE_LYRICS', spotifyTrackId, {
            nativeLines: wordsArray,
            isRomanizedUpgrade: true,
            canonHash: canonHash,
            // Spotify's romanized lines, for Romanized mode (only when written line for line).
            ...(upgraded.romanizedWordLines ? { romanizedWordLines: upgraded.romanizedWordLines } : {}),
        });

        // ── Signals 5 + 7 (success path) ─────────────────────────────────────
        // Port of: lyric-test/modules/bridge/interceptor.js lines 119-120
        slyPost('SLY_INTERCEPT_END', spotifyTrackId);
        interceptStarted = false;
        slyPost('SLY_FETCH_END', spotifyTrackId);

        const modified = {
            ...data,
            lyrics: {
                ...data.lyrics,
                isDenseTypeface: true,
                lines: upgraded.lines,
                ...(upgraded.syncType !== undefined ? { syncType: upgraded.syncType } : {}),
            },
        };

        return jsonResponse(modified, fallbackResponse);

    } catch (e) {
        console.error('[SKaraoke:Interceptor] Interceptor block error:', e);

        // Defensive cleanup: if SLY_INTERCEPT_START was sent but an exception
        // interrupted the flow before SLY_INTERCEPT_END, send it now.
        if (interceptStarted && spotifyTrackId) {
            slyPost('SLY_INTERCEPT_END', spotifyTrackId);
            // Spotify's unmodified response is returned below: a Layer-1 failure,
            // reported like the in-budget failure path (K5).
            slyPost('SLY_FORCE_FALLBACK', spotifyTrackId);
        }
        if (spotifyTrackId) slyPost('SLY_FETCH_END', spotifyTrackId);

        // V14 Fix: When data is null (JSON parse failed on originalResponse),
        // return a properly constructed Response instead of relying on fallbackResponse
        // whose body stream may have been consumed in edge cases (retries, double-reads).
        if (data === null) {
            const safeHeaders = new Headers(fallbackResponse.headers);
            safeHeaders.delete('content-encoding');
            return new Response(null, {
                status: fallbackResponse.status,
                statusText: fallbackResponse.statusText,
                headers: safeHeaders,
            });
        }
        return jsonResponse(data, fallbackResponse);
    }
}
