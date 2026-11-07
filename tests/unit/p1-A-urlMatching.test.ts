import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isColorLyricsUrl, extractColorLyricsTrackId } from '../../lib/colorLyricsInterceptor';

const TRACK_ID = '1AbCdEfGhIjKlMnOpQrStU'; // invented

describe('isColorLyricsUrl / extractColorLyricsTrackId', () => {
    it.each([
        `https://spclient.wg.spotify.com/color-lyrics/v2/track/${TRACK_ID}?format=json`,
        `https://gae2-spclient.spotify.com/color-lyrics/v2/track/${TRACK_ID}/image/https%3A%2F%2Fi.scdn.co%2Fimage%2Fab67?format=json&vocalRemoval=false&market=from_token`,
        `https://guc3-spclient.spotify.com/color-lyrics/v2/track/${TRACK_ID}`,
    ])('matches %s', (url) => {
        expect(isColorLyricsUrl(url)).toBe(true);
        expect(extractColorLyricsTrackId(url)).toBe(TRACK_ID);
    });

    it.each([
        `https://spclient.wg.spotify.com/metadata/4/track/0123456789abcdef0123456789abcdef`,
        `https://example.com/color-lyrics/v2/track/${TRACK_ID}`,
        `https://spclient.wg.spotify.com.example.com/color-lyrics/v2/track/${TRACK_ID}`,
        `https://notspotify.com/color-lyrics/v2/track/${TRACK_ID}`,
        `https://api.spotify.com/v1/color-lyrics/v2/track/${TRACK_ID}`,
        `https://example.com/?next=https://spclient.wg.spotify.com/color-lyrics/v2/track/${TRACK_ID}`,
        'not a url at all',
    ])('does not match %s', (url) => {
        expect(isColorLyricsUrl(url)).toBe(false);
    });

    it('anchors the track id to the color-lyrics path', () => {
        expect(extractColorLyricsTrackId(`https://api.spotify.com/v1/track/${TRACK_ID}`)).toBeUndefined();
    });
});

describe('fetchInterceptor entrypoint: host matching', () => {
    let originalFetch: typeof window.fetch;
    let posted: any[];

    beforeEach(() => {
        originalFetch = window.fetch;
        posted = [];
        window.fetch = vi.fn(async () => new Response(JSON.stringify({
            lyrics: {
                syncType: 'LINE_SYNCED',
                language: 'en',
                isDenseTypeface: false,
                lines: [{ startTimeMs: '1000', words: 'An invented English test line for matching', syllables: [], endTimeMs: '0' }],
            },
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
        vi.spyOn(window, 'postMessage').mockImplementation(((msg: any) => { posted.push(msg); }) as any);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.resetModules();
    });

    afterEach(() => {
        window.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('intercepts color-lyrics on a gae2-spclient host', async () => {
        await import('../../entrypoints/fetchInterceptor');
        const res = await window.fetch(`https://gae2-spclient.spotify.com/color-lyrics/v2/track/${TRACK_ID}?format=json`);
        expect(res.ok).toBe(true);
        const types = posted.map((m) => m?.action).filter((a) => a?.trackId === TRACK_ID).map((a) => a.type);
        expect(types).toContain('SLY_FETCH_START');
        expect(types).toContain('SLY_FETCH_END');
    });

    it('passes other requests straight through without lifecycle signals', async () => {
        await import('../../entrypoints/fetchInterceptor');
        await window.fetch('https://spclient.wg.spotify.com/metadata/4/track/0123456789abcdef0123456789abcdef');
        const types = posted.map((m) => m?.action?.type);
        expect(types).not.toContain('SLY_FETCH_START');
        expect(types).not.toContain('SLY_MXM_NOTIFY_METADATA');
    });
});
