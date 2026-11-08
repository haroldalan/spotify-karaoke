import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// L1-M5: the background answers every native-script lookup message.

vi.mock('../../lib/lyrics/lyricsProcessor', () => ({ processLines: vi.fn() }));
vi.mock('../../lib/lyricsProviders/lyricsEngine', () => ({
  getLyricsForTrack: vi.fn(),
  getColorOnly: vi.fn().mockResolvedValue(null),
  clearColorCache: vi.fn(),
}));
vi.mock('../../lib/lyricsProviders/nativeLyrics', () => ({
  nativeLyricsProvider: {
    notifyMetadata: vi.fn(),
    newInterception: vi.fn(),
    fetchNativeLines: vi.fn(),
    resetMemory: vi.fn(),
  },
  LEGACY_MUSIXMATCH_KEYS: ['skl_mxm_token'],
}));

import background from '../../entrypoints/background';
import { nativeLyricsProvider } from '../../lib/lyricsProviders/nativeLyrics';

const TRACK_ID = '0TestTrackCccccccccccc';
const LYRIC_MARKER = 'zzqinventedline';

let onMessage: (msg: any, sender: any, sendResponse: (r: any) => void) => any;

/** Resolves with the response, or 'NO_RESPONSE' if the handler neither answered nor kept the channel open. */
function send(msg: any): Promise<any> {
  return new Promise((resolve) => {
    const keepOpen = onMessage(msg, { tab: { id: 1 } }, resolve);
    if (keepOpen !== true) resolve('NO_RESPONSE');
  });
}

function sendWithTimeout(msg: any, ms = 200): Promise<any> {
  return Promise.race([send(msg), new Promise((r) => setTimeout(() => r('TIMED_OUT'), ms))]);
}

beforeAll(() => {
  (background as unknown as () => void)();
  onMessage = (global as any).browser.runtime.onMessage.addListener.mock.calls.at(-1)[0];
});

let errors: string[];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')); });
  (nativeLyricsProvider.newInterception as any).mockReset();
  (nativeLyricsProvider.fetchNativeLines as any).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SLY_NATIVE_NEW_INTERCEPTION', () => {
  it('answers generation 0 when the trackId is missing', async () => {
    expect(await sendWithTimeout({ type: 'SLY_NATIVE_NEW_INTERCEPTION', payload: {} })).toEqual({ generation: 0 });
    expect(await sendWithTimeout({ type: 'SLY_NATIVE_NEW_INTERCEPTION' })).toEqual({ generation: 0 });
    expect(nativeLyricsProvider.newInterception).not.toHaveBeenCalled();
  });

  it('still answers the provider generation for a trackId', async () => {
    (nativeLyricsProvider.newInterception as any).mockReturnValue(7);
    expect(await sendWithTimeout({ type: 'SLY_NATIVE_NEW_INTERCEPTION', payload: { trackId: TRACK_ID } })).toEqual({ generation: 7 });
    expect(nativeLyricsProvider.newInterception).toHaveBeenCalledWith(TRACK_ID);
  });
});

describe('SLY_NATIVE_FETCH', () => {
  const payload = { trackId: TRACK_ID, hexGid: '', interceptId: 3 };

  it('answers ok:false and logs name and message when the lookup rejects', async () => {
    (nativeLyricsProvider.fetchNativeLines as any).mockRejectedValue(new TypeError('invented failure'));
    const res = await sendWithTimeout({ type: 'SLY_NATIVE_FETCH', payload });
    expect(res).toMatchObject({ ok: false });
    expect(errors).toContain('[SKaraoke:BG] Native-script lookup threw: TypeError: invented failure');
  });

  it('answers ok:false when the lookup throws synchronously', async () => {
    (nativeLyricsProvider.fetchNativeLines as any).mockImplementation(() => { throw new RangeError('invented sync failure'); });
    const res = await sendWithTimeout({ type: 'SLY_NATIVE_FETCH', payload });
    expect(res).toMatchObject({ ok: false });
    expect(errors).toContain('[SKaraoke:BG] Native-script lookup threw: RangeError: invented sync failure');
  });

  it('answers ok:false for a non-Error rejection', async () => {
    (nativeLyricsProvider.fetchNativeLines as any).mockRejectedValue('invented string reason');
    expect(await sendWithTimeout({ type: 'SLY_NATIVE_FETCH', payload })).toMatchObject({ ok: false });
    expect(errors).toContain('[SKaraoke:BG] Native-script lookup threw: string: invented string reason');
  });

  it('answers ok:false for a null result and ok:true with the lines, without logging lyric text', async () => {
    (nativeLyricsProvider.fetchNativeLines as any).mockResolvedValueOnce(null);
    expect(await sendWithTimeout({ type: 'SLY_NATIVE_FETCH', payload })).toEqual({ ok: false, lines: null });

    const lines = [{ id: '0', startTimeMs: '0', words: LYRIC_MARKER, syllables: [], endTimeMs: '0' }];
    (nativeLyricsProvider.fetchNativeLines as any).mockResolvedValueOnce(lines);
    expect(await sendWithTimeout({ type: 'SLY_NATIVE_FETCH', payload })).toEqual({ ok: true, lines });
    expect(nativeLyricsProvider.fetchNativeLines).toHaveBeenLastCalledWith(TRACK_ID, '', 3, undefined);
    // Spotify's line count from the interceptor is passed on.
    await sendWithTimeout({ type: 'SLY_NATIVE_FETCH', payload: { ...payload, spotifyWordLines: 12 } });
    expect(nativeLyricsProvider.fetchNativeLines).toHaveBeenLastCalledWith(TRACK_ID, '', 3, 12);
    for (const spy of [console.log, console.warn, console.error] as any[]) {
      for (const call of spy.mock.calls) expect(call.map(String).join(' ')).not.toContain(LYRIC_MARKER);
    }
  });
});
