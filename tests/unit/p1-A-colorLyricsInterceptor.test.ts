import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    handleColorLyrics,
    NATIVE_HOLD_BUDGET_MS,
} from '../../lib/colorLyricsInterceptor';
import { base62ToHex } from '../../lib/utils/spotifyUtils';
import { isLikelyRomanizedFallback, nonLatinLetterRatio } from '../../lib/lyrics/romanizedDetector';
import type { NativeLyricsClient } from '../../lib/colorLyricsInterceptor';

// Synthetic color-lyrics response (real shape, invented text; romanized Hindi tagged "id").
const fixture = JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/color-lyrics-romanized-hindi.json'), 'utf8'),
);
const SPOTIFY_LINE_COUNT: number = fixture.lyrics.lines.length;
// Lines that carry words (the fixture also has a '♪' marker and a trailing '' line, as Spotify sends).
const SPOTIFY_WORD_LINE_COUNT: number = fixture.lyrics.lines.filter((l: any) => /[\p{L}\p{N}]/u.test(l.words)).length;
/** Spotify's words with each word line replaced, in order, by the next native line ('♪' / '' kept). */
function expectedSwappedWords(native: string[]): string[] {
    let k = 0;
    return fixture.lyrics.lines.map((l: any) => (/[\p{L}\p{N}]/u.test(l.words) ? native[k++] : l.words));
}

// Invented track id (22 base62 chars).
const TRACK_ID = '1AbCdEfGhIjKlMnOpQrStU';
const URL_WG = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${TRACK_ID}?format=json&vocalRemoval=false`;

// Invented Devanagari test sentences (not song lyrics).
const NATIVE_WORDS = [
    'यह पहली परीक्षण पंक्ति है',
    'यह दूसरी परीक्षण पंक्ति है',
    'यह तीसरी परीक्षण पंक्ति है',
    'यह चौथी परीक्षण पंक्ति है',
    'यह पाँचवीं परीक्षण पंक्ति है',
    'यह छठी परीक्षण पंक्ति है',
    'यह सातवीं परीक्षण पंक्ति है',
    'यह आठवीं परीक्षण पंक्ति है',
];

function syncedNative(count: number) {
    return NATIVE_WORDS.slice(0, count).map((words, i) => ({
        id: String(i),
        startTimeMs: String(1000 + i * 5000),
        words,
        syllables: [],
        endTimeMs: String(6000 + i * 5000),
    }));
}

function unsyncedNative(count: number) {
    return NATIVE_WORDS.slice(0, count).map((words, i) => ({
        id: String(i),
        startTimeMs: '0',
        words,
        syllables: [],
        endTimeMs: '0',
    }));
}

function cloneFixture(): any {
    return JSON.parse(JSON.stringify(fixture));
}

/** Minimal Response stand-in whose json() resolves without stream I/O (safe under fake timers). */
function fakeSpotifyResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json', 'content-encoding': 'gzip' }),
        json: async () => JSON.parse(JSON.stringify(body)),
    } as unknown as Response;
}

function fakeMxm(
    fetchImpl: () => Promise<any[] | null>,
    newInterceptionImpl: () => Promise<number> = async () => 7,
) {
    return {
        newInterception: vi.fn(newInterceptionImpl),
        fetchNativeLines: vi.fn(fetchImpl),
        notifyMetadata: vi.fn(),
    };
}

function deferred<T>() {
    let resolveFn!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolveFn = r; });
    return { promise, resolve: resolveFn };
}

let posted: any[] = [];
function actions(type?: string): any[] {
    const all = posted.map((m) => m?.action).filter(Boolean);
    return type ? all.filter((a) => a.type === type) : all;
}

async function run(body: any, mxm: ReturnType<typeof fakeMxm>, url = URL_WG) {
    const res = fakeSpotifyResponse(body);
    const fallback = fakeSpotifyResponse(body);
    const out = await handleColorLyrics(res, fallback, url, mxm as unknown as NativeLyricsClient);
    return { out, json: await out.json() as any };
}

beforeEach(() => {
    posted = [];
    vi.spyOn(window, 'postMessage').mockImplementation(((msg: any) => { posted.push(msg); }) as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('handleColorLyrics: romanized-fallback gate (K3)', () => {
    it('attempts the native upgrade for the romanized fixture and reports ROMANIZED with romanizedLang "hi"', async () => {
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));
        const { json, out } = await run(cloneFixture(), mxm);

        expect(mxm.newInterception).toHaveBeenCalledWith(TRACK_ID);
        expect(mxm.fetchNativeLines).toHaveBeenCalledWith(TRACK_ID, base62ToHex(TRACK_ID), 7, expect.any(Number)); // + Spotify's lines with words

        const reports = actions('SLY_PREFETCH_REPORT');
        expect(reports).toEqual([
            expect.objectContaining({ trackId: TRACK_ID, state: 'ROMANIZED', romanizedLang: 'hi' }),
        ]);

        const native = actions('SKL_NATIVE_LYRICS');
        expect(native).toHaveLength(1);
        expect(native[0]).toMatchObject({ trackId: TRACK_ID, isRomanizedUpgrade: true, nativeLines: NATIVE_WORDS });
        expect(native[0].late).toBeUndefined();

        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(NATIVE_WORDS);
        expect(json.lyrics.syncType).toBe('LINE_SYNCED');
        expect(out.headers.get('content-encoding')).toBeNull();

        const types = actions().map((a) => a.type);
        expect(types.indexOf('SLY_INTERCEPT_START')).toBeGreaterThan(-1);
        expect(types.indexOf('SLY_INTERCEPT_END')).toBeGreaterThan(types.indexOf('SLY_INTERCEPT_START'));
        expect(types).toContain('SLY_FETCH_END');
        expect(types).not.toContain('SLY_FORCE_FALLBACK');
    });

    it('never upgrades or reports ROMANIZED for native-script (Devanagari) lines', async () => {
        const body = cloneFixture();
        body.lyrics.language = 'hi';
        body.lyrics.isDenseTypeface = false;
        body.lyrics.lines = body.lyrics.lines.map((l: any, i: number) => ({ ...l, words: NATIVE_WORDS[i] }));
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));

        const { json } = await run(body, mxm);

        expect(mxm.newInterception).not.toHaveBeenCalled();
        expect(mxm.fetchNativeLines).not.toHaveBeenCalled();
        expect(actions('SLY_PREFETCH_REPORT').some((a) => a.state === 'ROMANIZED')).toBe(false);
        expect(actions('SLY_INTERCEPT_START')).toHaveLength(0);
        expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(0);
        expect(actions('SLY_CANONICAL_HASH')).toHaveLength(1);
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(body.lyrics.lines.map((l: any) => l.words));
    });

    it('never upgrades native Cyrillic lines tagged with a non-Latin language', async () => {
        const body = cloneFixture();
        body.lyrics.language = 'uk';
        body.lyrics.isDenseTypeface = false;
        body.lyrics.lines = body.lyrics.lines.map((l: any) => ({ ...l, words: 'Це лише тестовий рядок для перевірки' }));
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));

        await run(body, mxm);

        expect(mxm.fetchNativeLines).not.toHaveBeenCalled();
        expect(actions('SLY_PREFETCH_REPORT').some((a) => a.state === 'ROMANIZED')).toBe(false);
    });

    // Native lyrics where half the lines are English: the non-Latin letter ratio (~0.2)
    // is at or above the detector's native-script threshold (NATIVE_LETTER_RATIO, 0.02),
    // so the detector itself returns 'native-script'. These cases pin the ratio path;
    // the native-letter veto is pinned by the sub-0.02 case below.
    it.each([
        ['ko', ['이것은 테스트 문장입니다', '두 번째 시험 줄입니다']],
        ['ja', ['これはテストの文です', '二行目の試験です']],
    ])('never upgrades or reports ROMANIZED for mixed %s/English native lines', async (lang, nativeTestLines) => {
        const englishTestLines = ['this is only a test line for the checker', 'another plain english line for testing'];
        const body = cloneFixture();
        body.lyrics.language = lang;
        body.lyrics.isDenseTypeface = false;
        body.lyrics.syncType = 'SYLLABLE_SYNCED';
        body.lyrics.lines = body.lyrics.lines.map((l: any, i: number) => ({
            ...l,
            words: i % 2 ? englishTestLines[(i >> 1) % 2] : nativeTestLines[(i >> 1) % 2],
            syllables: [{ startTimeMs: l.startTimeMs, numChars: 2 }],
        }));
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));

        const { json } = await run(body, mxm);

        expect(mxm.newInterception).not.toHaveBeenCalled();
        expect(mxm.fetchNativeLines).not.toHaveBeenCalled();
        expect(actions('SLY_PREFETCH_REPORT').some((a) => a.state === 'ROMANIZED')).toBe(false);
        expect(actions('SLY_INTERCEPT_START')).toHaveLength(0);
        expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(0);
        expect(actions('SLY_FORCE_FALLBACK')).toHaveLength(0);
        expect(json.lyrics.syncType).toBe('SYLLABLE_SYNCED');
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(body.lyrics.lines.map((l: any) => l.words));
    });

    // Mostly-English lines with a single Hangul word: the non-Latin letter ratio is
    // between 0 and NATIVE_LETTER_RATIO (0.02), so the detector says "romanized" by the
    // 'ko' tag alone. Only the native-letter veto keeps these lines from being upgraded.
    it('never upgrades or reports ROMANIZED when one native word sits below the 0.02 ratio', async () => {
        const englishTestLines = [
            'this is only a long plain english test line for the checker',
            'another long plain english line written only for this test',
        ];
        const body = cloneFixture();
        body.lyrics.language = 'ko';
        body.lyrics.isDenseTypeface = false;
        body.lyrics.syncType = 'SYLLABLE_SYNCED';
        let k = 0;
        body.lyrics.lines = body.lyrics.lines.map((l: any) => {
            if (!/[\p{L}\p{N}]/u.test(l.words)) return l;
            const words = englishTestLines[k % 2] + (k === 0 ? ' 밤' : '');
            k++;
            return { ...l, words, syllables: [{ startTimeMs: l.startTimeMs, numChars: 2 }] };
        });
        const lineWords = body.lyrics.lines.map((l: any) => l.words);

        // Preconditions: the case sits in the veto band and the detector alone says romanized.
        const ratio = nonLatinLetterRatio(lineWords);
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThan(0.02);
        expect(isLikelyRomanizedFallback(lineWords, 'ko')).toMatchObject({ romanized: true, reason: 'tag' });

        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));
        const { json } = await run(body, mxm);

        expect(mxm.newInterception).not.toHaveBeenCalled();
        expect(mxm.fetchNativeLines).not.toHaveBeenCalled();
        expect(actions('SLY_PREFETCH_REPORT').some((a) => a.state === 'ROMANIZED')).toBe(false);
        expect(actions('SLY_INTERCEPT_START')).toHaveLength(0);
        expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(0);
        expect(actions('SLY_FORCE_FALLBACK')).toHaveLength(0);
        expect(json.lyrics.syncType).toBe('SYLLABLE_SYNCED');
        expect(json.lyrics.isDenseTypeface).toBe(false);
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(lineWords);
    });

    it('still upgrades fully romanized lines tagged "ko"', async () => {
        const body = cloneFixture();
        body.lyrics.language = 'ko';
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));

        await run(body, mxm);

        expect(mxm.fetchNativeLines).toHaveBeenCalledTimes(1);
        expect(actions('SLY_PREFETCH_REPORT')).toEqual([
            expect.objectContaining({ trackId: TRACK_ID, state: 'ROMANIZED', romanizedLang: 'ko' }),
        ]);
    });

    it('still reports UNSYNCED (not ROMANIZED) for an unsynced romanized response', async () => {
        const body = cloneFixture();
        body.lyrics.syncType = 'UNSYNCED';
        const mxm = fakeMxm(async () => unsyncedNative(SPOTIFY_LINE_COUNT));

        await run(body, mxm);

        expect(actions('SLY_PREFETCH_REPORT')).toEqual([
            expect.objectContaining({ trackId: TRACK_ID, state: 'UNSYNCED' }),
        ]);
    });

    it('still reports MISSING for a response without lines', async () => {
        const body = cloneFixture();
        body.lyrics.lines = [];
        const mxm = fakeMxm(async () => null);

        await run(body, mxm);

        expect(actions('SLY_PREFETCH_REPORT')).toEqual([
            expect.objectContaining({ trackId: TRACK_ID, state: 'MISSING', nativeMissing: true }),
        ]);
        expect(mxm.fetchNativeLines).not.toHaveBeenCalled();
    });

    it('sends SLY_FORCE_FALLBACK when Musixmatch returns nothing within the budget', async () => {
        const mxm = fakeMxm(async () => null);
        const { json } = await run(cloneFixture(), mxm);

        expect(actions('SLY_FORCE_FALLBACK')).toHaveLength(1);
        expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(0);
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(fixture.lyrics.lines.map((l: any) => l.words));
    });
});

describe('handleColorLyrics: Musixmatch unsynced lines (K6) and syncType', () => {
    it('keeps Spotify timings and swaps only the words when unsynced native lines match Spotify\'s lines with words', async () => {
        // Musixmatch's unsynced lyrics drop blank lines, so they match Spotify's WORD lines, not its '♪' / '' lines.
        const mxm = fakeMxm(async () => unsyncedNative(SPOTIFY_WORD_LINE_COUNT));
        const { json } = await run(cloneFixture(), mxm);
        const expected = expectedSwappedWords(NATIVE_WORDS.slice(0, SPOTIFY_WORD_LINE_COUNT));

        expect(SPOTIFY_WORD_LINE_COUNT).toBeLessThan(SPOTIFY_LINE_COUNT);
        expect(json.lyrics.syncType).toBe('LINE_SYNCED');
        expect(json.lyrics.lines.map((l: any) => l.startTimeMs)).toEqual(fixture.lyrics.lines.map((l: any) => l.startTimeMs));
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(expected);
        expect(actions('SKL_NATIVE_LYRICS')[0].nativeLines).toEqual(expected);
    });

    it('marks the response UNSYNCED when the native lines outnumber Spotify\'s lines with words', async () => {
        const mxm = fakeMxm(async () => unsyncedNative(SPOTIFY_LINE_COUNT));
        const { json } = await run(cloneFixture(), mxm);

        expect(json.lyrics.syncType).toBe('UNSYNCED');
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(NATIVE_WORDS.slice(0, SPOTIFY_LINE_COUNT));
    });

    it('marks the response UNSYNCED when unsynced native lines have a different count', async () => {
        const mxm = fakeMxm(async () => unsyncedNative(5));
        const { json } = await run(cloneFixture(), mxm);

        expect(json.lyrics.syncType).toBe('UNSYNCED');
        expect(json.lyrics.lines).toHaveLength(5);
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(NATIVE_WORDS.slice(0, 5));
    });

    it('downgrades SYLLABLE_SYNCED to LINE_SYNCED when the native lines carry no syllables', async () => {
        const body = cloneFixture();
        body.lyrics.syncType = 'SYLLABLE_SYNCED';
        body.lyrics.lines = body.lyrics.lines.map((l: any) => ({
            ...l,
            syllables: [{ startTimeMs: l.startTimeMs, numChars: 2 }],
        }));
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));
        const { json } = await run(body, mxm);

        expect(json.lyrics.syncType).toBe('LINE_SYNCED');
    });

    it('downgrades SYLLABLE_SYNCED to LINE_SYNCED when words are swapped onto Spotify timings', async () => {
        const body = cloneFixture();
        body.lyrics.syncType = 'SYLLABLE_SYNCED';
        body.lyrics.lines = body.lyrics.lines.map((l: any) => ({
            ...l,
            syllables: [{ startTimeMs: l.startTimeMs, numChars: 2 }],
        }));
        const mxm = fakeMxm(async () => unsyncedNative(SPOTIFY_WORD_LINE_COUNT));
        const { json } = await run(body, mxm);

        expect(json.lyrics.syncType).toBe('LINE_SYNCED');
        expect(json.lyrics.lines.every((l: any) => Array.isArray(l.syllables) && l.syllables.length === 0)).toBe(true);
        expect(json.lyrics.lines.map((l: any) => l.startTimeMs)).toEqual(body.lyrics.lines.map((l: any) => l.startTimeMs));
    });
});

describe('handleColorLyrics: hold budget and late native lines (K5)', () => {
    it('releases Spotify\'s response at the budget and posts late SKL_NATIVE_LYRICS when the lookup finishes', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const pending = deferred<any[] | null>();
        const mxm = fakeMxm(() => pending.promise);

        let settled = false;
        const p = handleColorLyrics(
            fakeSpotifyResponse(cloneFixture()),
            fakeSpotifyResponse(cloneFixture()),
            URL_WG,
            mxm as unknown as NativeLyricsClient,
        ).then((r) => { settled = true; return r; });

        await vi.advanceTimersByTimeAsync(NATIVE_HOLD_BUDGET_MS - 1);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        const out = await p;
        expect(settled).toBe(true);

        const json = await out.json() as any;
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(fixture.lyrics.lines.map((l: any) => l.words));
        expect(json.lyrics.syncType).toBe(fixture.lyrics.syncType);

        expect(actions('SLY_INTERCEPT_END')).toHaveLength(1);
        expect(actions('SLY_FETCH_END')).toHaveLength(1);
        expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(0);
        expect(actions('SLY_FORCE_FALLBACK')).toHaveLength(0);
        // Spotify's romanized words are not canonical while the lookup is pending.
        expect(actions('SLY_CANONICAL_HASH')).toHaveLength(0);

        // Musixmatch unsynced lines match Spotify's lines WITH WORDS, not its raw line count.
        expect(SPOTIFY_WORD_LINE_COUNT).toBeLessThan(SPOTIFY_LINE_COUNT);
        pending.resolve(unsyncedNative(SPOTIFY_WORD_LINE_COUNT));
        await vi.waitFor(() => expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(1));

        const late = actions('SKL_NATIVE_LYRICS')[0];
        expect(late).toMatchObject({
            trackId: TRACK_ID,
            nativeLines: NATIVE_WORDS.slice(0, SPOTIFY_WORD_LINE_COUNT),
            isRomanizedUpgrade: true,
            late: true,
        });
        expect(late.spotifyLineCount).toBe(SPOTIFY_LINE_COUNT);
        expect(late.spotifyWordLineCount).toBe(SPOTIFY_WORD_LINE_COUNT);
        expect(typeof late.canonHash).toBe('number');
        expect(actions('SLY_INTERCEPT_END')).toHaveLength(1);
        // The late payload carries its own hash; the receiver adopts the applied lines' hash.
        expect(actions('SLY_CANONICAL_HASH')).toHaveLength(0);
    });

    it('counts newInterception against the same budget', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const gen = deferred<number>();
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT), () => gen.promise);

        const p = handleColorLyrics(
            fakeSpotifyResponse(cloneFixture()),
            fakeSpotifyResponse(cloneFixture()),
            URL_WG,
            mxm as unknown as NativeLyricsClient,
        );
        await vi.advanceTimersByTimeAsync(NATIVE_HOLD_BUDGET_MS);
        const json = await (await p).json() as any;

        expect(mxm.fetchNativeLines).not.toHaveBeenCalled();
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(fixture.lyrics.lines.map((l: any) => l.words));

        gen.resolve(3);
        await vi.waitFor(() => expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(1));
        expect(mxm.fetchNativeLines).toHaveBeenCalledWith(TRACK_ID, base62ToHex(TRACK_ID), 3, expect.any(Number)); // + Spotify's lines with words
        expect(actions('SKL_NATIVE_LYRICS')[0].late).toBe(true);
    });

    it('posts SLY_FORCE_FALLBACK when a late lookup fails', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const pending = deferred<any[] | null>();
        const mxm = fakeMxm(() => pending.promise);

        const p = handleColorLyrics(
            fakeSpotifyResponse(cloneFixture()),
            fakeSpotifyResponse(cloneFixture()),
            URL_WG,
            mxm as unknown as NativeLyricsClient,
        );
        await vi.advanceTimersByTimeAsync(NATIVE_HOLD_BUDGET_MS);
        await p;

        pending.resolve(null);
        await vi.waitFor(() => expect(actions('SLY_FORCE_FALLBACK')).toHaveLength(1));
        expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(0);
        // A failed late lookup leaves the canonical hash unset.
        expect(actions('SLY_CANONICAL_HASH')).toHaveLength(0);
    });

    it('drops a late result that was superseded by a newer lookup for the same track', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const first = deferred<any[] | null>();
        const second = deferred<any[] | null>();
        const queue = [first.promise, second.promise];
        const mxm = fakeMxm(() => queue.shift()!);

        const p1 = handleColorLyrics(fakeSpotifyResponse(cloneFixture()), fakeSpotifyResponse(cloneFixture()), URL_WG, mxm as unknown as NativeLyricsClient);
        await vi.advanceTimersByTimeAsync(NATIVE_HOLD_BUDGET_MS);
        await p1;
        const p2 = handleColorLyrics(fakeSpotifyResponse(cloneFixture()), fakeSpotifyResponse(cloneFixture()), URL_WG, mxm as unknown as NativeLyricsClient);
        await vi.advanceTimersByTimeAsync(NATIVE_HOLD_BUDGET_MS);
        await p2;

        first.resolve(null); // stale generation in the background → null
        second.resolve(syncedNative(SPOTIFY_LINE_COUNT));
        await vi.waitFor(() => expect(actions('SKL_NATIVE_LYRICS')).toHaveLength(1));
        expect(actions('SLY_FORCE_FALLBACK')).toHaveLength(0);
    });
});

describe('handleColorLyrics: URL handling', () => {
    it('extracts the track id from a gae2-spclient color-lyrics URL', async () => {
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_LINE_COUNT));
        await run(cloneFixture(), mxm, `https://gae2-spclient.spotify.com/color-lyrics/v2/track/${TRACK_ID}/image/https%3A%2F%2Fi.scdn.co%2Fimage%2Fab67?format=json`);

        expect(actions('SLY_FETCH_START')).toEqual([expect.objectContaining({ trackId: TRACK_ID })]);
        expect(mxm.fetchNativeLines).toHaveBeenCalledWith(TRACK_ID, base62ToHex(TRACK_ID), 7, expect.any(Number)); // + Spotify's lines with words
    });
});

// ─── 2026-11-07: Spotify's timings and romanized lines kept for restored native lines ──

describe('handleColorLyrics: native lines written onto Spotify\'s lines', () => {
    const spotifyWordLines = () => fixture.lyrics.lines.map((l: any) => l.words).filter((w: string) => /[\p{L}\p{N}]/u.test(w));

    it('synced native lines with as many word lines keep Spotify\'s timings and carry Spotify\'s romanized lines', async () => {
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_WORD_LINE_COUNT));
        const { json } = await run(cloneFixture(), mxm);
        const native = NATIVE_WORDS.slice(0, SPOTIFY_WORD_LINE_COUNT);
        expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(expectedSwappedWords(native));
        // Spotify's (licensed) timings, not the copy's.
        expect(json.lyrics.lines.map((l: any) => l.startTimeMs)).toEqual(fixture.lyrics.lines.map((l: any) => l.startTimeMs));
        expect(json.lyrics.syncType).toBe('LINE_SYNCED');
        const msg = actions('SKL_NATIVE_LYRICS')[0];
        expect(msg.romanizedWordLines).toEqual(spotifyWordLines());
    });

    it('a different number of lines keeps the copy\'s own timings and sends no romanized lines', async () => {
        const mxm = fakeMxm(async () => syncedNative(SPOTIFY_WORD_LINE_COUNT + 2));
        const { json } = await run(cloneFixture(), mxm);
        expect(json.lyrics.lines.map((l: any) => l.startTimeMs)).toEqual(syncedNative(SPOTIFY_WORD_LINE_COUNT + 2).map((l) => l.startTimeMs));
        expect(actions('SKL_NATIVE_LYRICS')[0].romanizedWordLines).toBeUndefined();
    });
});
