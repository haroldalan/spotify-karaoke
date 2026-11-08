import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Live 2026-11-08: the now-playing widget names the new track before the page bridge does.
// Pairing the widget's id with the bridge's (previous) title sent the previous song's
// title under the new id; the native-script lookup then searched for the wrong song.

const NEW_ID = '0NewInventedTrackNnnnn';
const OLD_ID = '0OldInventedTrackNnnnn';

function widget(id: string) {
  document.body.innerHTML = `<div data-testid="now-playing-widget">
    <a data-testid="context-item-link" href="/track/${id}">x</a></div>`;
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('MetadataEngine.getNowPlaying: id and title from the same track', () => {
  it('widget ahead of the bridge: the new id, with no title (never the previous one)', async () => {
    const { spotifyState } = await import('../../lib/slyCore/state');
    const { MetadataEngine } = await import('../../lib/slyCore/metadataEngine');
    const { getNowPlayingTrackId } = await import('../../lib/dom/domQueries');
    widget(NEW_ID);
    if (getNowPlayingTrackId() !== NEW_ID) return expect.fail('fixture: widget id not found');
    (spotifyState as any).track = { uri: `spotify:track:${OLD_ID}`, name: 'Previous Invented Song', artists: [{ name: 'Previous Artist' }] };
    const meta = MetadataEngine.getNowPlaying();
    expect(meta.uri).toBe(`spotify:track:${NEW_ID}`);
    expect(meta.title).toBe('');
    expect(meta.artist).toBe('');
    // The bridge catches up: both agree.
    (spotifyState as any).track = { uri: `spotify:track:${NEW_ID}`, name: 'New Invented Song', artists: [{ name: 'New Artist' }] };
    expect(MetadataEngine.getNowPlaying()).toMatchObject({ uri: `spotify:track:${NEW_ID}`, title: 'New Invented Song', artist: 'New Artist' });
  });

  it('song change warming waits for the bridge instead of sending the previous title', async () => {
    vi.useFakeTimers();
    const posted: any[] = [];
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(((msg: any) => { posted.push(msg); }) as any);
    const { spotifyState } = await import('../../lib/slyCore/state');
    const { WarmingEngine } = await import('../../lib/slyCore/warmingEngine');
    WarmingEngine.init();
    vi.advanceTimersByTime(200); // boot-time check (nothing playing)
    posted.length = 0;
    widget(NEW_ID);
    (spotifyState as any).track = { uri: `spotify:track:${OLD_ID}`, name: 'Previous Invented Song', artists: [{ name: 'Previous Artist' }] };
    document.dispatchEvent(new CustomEvent('sly:song_change', { detail: { uri: `spotify:track:${NEW_ID}` } }));
    vi.advanceTimersByTime(300);
    expect(posted.filter((m) => m?.type === 'SLY_CHECK_CACHE')).toHaveLength(0);
    (spotifyState as any).track = { uri: `spotify:track:${NEW_ID}`, name: 'New Invented Song', artists: [{ name: 'New Artist' }] };
    vi.advanceTimersByTime(150);
    const checks = posted.filter((m) => m?.type === 'SLY_CHECK_CACHE');
    expect(checks).toHaveLength(1);
    expect(checks[0].payload).toEqual({ title: 'New Invented Song', artist: 'New Artist', uri: `spotify:track:${NEW_ID}` });
    spy.mockRestore();
  });
});

describe('YouTube Music: one lookup per song at a time', () => {
  it('a second request for the same song shares the running lookup', async () => {
    const local = (global as any).browser.storage.local;
    local.get = vi.fn().mockResolvedValue({ ytm_api_key: 'TEST_KEY', ytm_key_source: 'scraped' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response;
    }));
    const { fetchYtmLyrics } = await import('../../lib/lyricsProviders/ytm');
    const [a, b] = await Promise.all([
      fetchYtmLyrics('Invented Song (From "Film")', 'Invented Artist, Other'),
      fetchYtmLyrics('Invented Song', 'Invented Artist'),
    ]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(calls.filter((u) => u.includes('/search'))).toHaveLength(1);
    // Once finished, a new request runs again.
    await fetchYtmLyrics('Invented Song', 'Invented Artist');
    expect(calls.filter((u) => u.includes('/search'))).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
