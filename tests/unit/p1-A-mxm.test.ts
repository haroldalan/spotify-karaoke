import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { base62ToHex } from '../../lib/utils/spotifyUtils';

// Invented ids and text throughout; no real lyrics.
const TRACK_ID = '1AbCdEfGhIjKlMnOpQrStU';
const MXM_TRACK_ID = 111;
const MXM_COMMONTRACK_ID = 222;
const SEARCH_COMMONTRACK_ID = 333;
const NATIVE_SUBTITLE = JSON.stringify([
    { time: { total: 1.5 }, text: 'यह पहली परीक्षण पंक्ति है' },
    { time: { total: 6.0 }, text: 'यह दूसरी परीक्षण पंक्ति है' },
]);

type Req = { url: URL; headers: Record<string, string> };

function ok(body: unknown) {
    return new Response(JSON.stringify({ message: { header: { status_code: 200 }, body } }), { status: 200 });
}
function notFound() {
    return new Response(JSON.stringify({ message: { header: { status_code: 404 }, body: '' } }), { status: 200 });
}

describe('base62ToHex', () => {
    it('matches librespot\'s published test vector (digits, lowercase, uppercase alphabet)', () => {
        // librespot core/src/spotify_id.rs, CONV_VALID[0]
        expect(base62ToHex('5sWHDYs0csV6RS48xBl0tH')).toBe('b39fe8081e1f4c54be38e8d6f9f12bb9');
        expect(BigInt('0x' + base62ToHex('5sWHDYs0csV6RS48xBl0tH'))).toBe(238762092608182713602505436543891614649n);
    });

    it('returns null for characters outside the alphabet', () => {
        expect(base62ToHex('abc-def')).toBeNull();
    });
});

describe('mxmProvider.fetchNativeLines', () => {
    let requests: Req[];
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        requests = [];
        originalFetch = globalThis.fetch;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
            const url = new URL(typeof input === 'string' ? input : input.url);
            requests.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
            const p = url.searchParams;
            switch (url.pathname.replace('/ws/1.1', '')) {
                case '/token.get':
                    return new Response(JSON.stringify({ message: { body: { user_token: 'test-token' } } }));
                case '/track.get':
                    return ok({ track: { track_id: MXM_TRACK_ID, commontrack_id: MXM_COMMONTRACK_ID, track_name: 'Invented Title' } });
                case '/track.subtitle.get':
                    if (p.get('commontrack_id') === String(SEARCH_COMMONTRACK_ID)) {
                        return ok({ subtitle: { subtitle_body: NATIVE_SUBTITLE } });
                    }
                    return notFound();
                case '/track.lyrics.get':
                    // Latin-only text: fails the native-script check so the flow continues.
                    return ok({ lyrics: { lyrics_body: 'only latin text here\nanother latin line' } });
                case '/track.search':
                    return ok({ track_list: [{ track: { commontrack_id: SEARCH_COMMONTRACK_ID } }] });
                default:
                    return notFound();
            }
        }) as any;
        vi.resetModules();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('sends the linked Musixmatch track_id as track_id to track.lyrics.get', async () => {
        const { mxmProvider } = await import('../../lib/lyricsProviders/mxm');
        const gen = mxmProvider.newInterception(TRACK_ID);
        await mxmProvider.fetchNativeLines(null, TRACK_ID, base62ToHex(TRACK_ID)!, gen);

        const lyricsCalls = requests.filter((r) => r.url.pathname.endsWith('/track.lyrics.get'));
        expect(lyricsCalls.some((r) => r.url.searchParams.get('track_id') === String(MXM_TRACK_ID))).toBe(true);
        expect(lyricsCalls.some((r) => r.url.searchParams.get('commontrack_id') === String(MXM_TRACK_ID))).toBe(false);
    });

    it('finds metadata notified under the base62 Spotify id (metadata search strategy)', async () => {
        const { mxmProvider } = await import('../../lib/lyricsProviders/mxm');
        mxmProvider.notifyMetadata(TRACK_ID, 'Invented Title', 'Invented Artist');
        const gen = mxmProvider.newInterception(TRACK_ID);
        const lines = await mxmProvider.fetchNativeLines(null, TRACK_ID, base62ToHex(TRACK_ID)!, gen);

        const search = requests.find((r) => r.url.pathname.endsWith('/track.search'));
        expect(search?.url.searchParams.get('q_track')).toBe('Invented Title');
        expect(search?.url.searchParams.get('q_artist')).toBe('Invented Artist');
        expect(lines?.map((l) => l.words)).toEqual(['यह पहली परीक्षण पंक्ति है', 'यह दूसरी परीक्षण पंक्ति है']);
    });

    it('still finds metadata stored under the hex GID', async () => {
        const { mxmProvider } = await import('../../lib/lyricsProviders/mxm');
        const hex = base62ToHex(TRACK_ID)!;
        mxmProvider.notifyMetadata(hex, 'Invented Title', 'Invented Artist');
        const gen = mxmProvider.newInterception(TRACK_ID);
        await mxmProvider.fetchNativeLines(null, TRACK_ID, hex, gen);

        expect(requests.some((r) => r.url.pathname.endsWith('/track.search'))).toBe(true);
    });

    it('works without a hex GID', async () => {
        const { mxmProvider } = await import('../../lib/lyricsProviders/mxm');
        mxmProvider.notifyMetadata(TRACK_ID, 'Invented Title', 'Invented Artist');
        const gen = mxmProvider.newInterception(TRACK_ID);
        const lines = await mxmProvider.fetchNativeLines(null, TRACK_ID, '', gen);
        expect(lines).not.toBeNull();
    });

    it('does not set the forbidden Origin header', async () => {
        const { mxmProvider } = await import('../../lib/lyricsProviders/mxm');
        const gen = mxmProvider.newInterception(TRACK_ID);
        await mxmProvider.fetchNativeLines(null, TRACK_ID, base62ToHex(TRACK_ID)!, gen);

        expect(requests.length).toBeGreaterThan(0);
        for (const r of requests) {
            expect(Object.keys(r.headers).map((h) => h.toLowerCase())).not.toContain('origin');
        }
    });
});
