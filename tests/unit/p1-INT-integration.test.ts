/**
 * Phase-1 integration checks across group boundaries.
 * Synthetic DOM and invented text only (no real lyrics, no personal data).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleColorLyrics } from '../../lib/colorLyricsInterceptor';
import type { MxmClient } from '../../lib/mxmClient';
import { slyScavengeClasses, SPOTIFY_CLASSES } from '../../lib/slyCore/scavenger';

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/color-lyrics-romanized-hindi.json'), 'utf8'),
);
const TRACK_ID = '1AbCdEfGhIjKlMnOpQrStU';
const URL_WG = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${TRACK_ID}?format=json`;

function fakeSpotifyResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(JSON.stringify(body)),
  } as unknown as Response;
}

let posted: any[] = [];
const actionTypes = () => posted.map((m) => m?.action?.type).filter(Boolean);

beforeEach(() => {
  posted = [];
  vi.spyOn(window, 'postMessage').mockImplementation(((msg: any) => { posted.push(msg); }) as any);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('interceptor exception after SLY_INTERCEPT_START (A -> B2 Layer-1 pending)', () => {
  it('pairs INTERCEPT_END with SLY_FORCE_FALLBACK and returns Spotify lines unchanged', async () => {
    // A malformed Musixmatch line makes the upgrade path throw after INTERCEPT_START.
    const mxm = {
      newInterception: vi.fn(async () => 1),
      fetchNativeLines: vi.fn(async () => [null] as any[]),
      notifyMetadata: vi.fn(),
      warmup: vi.fn(),
    };
    const out = await handleColorLyrics(
      fakeSpotifyResponse(fixture), fakeSpotifyResponse(fixture), URL_WG, mxm as unknown as MxmClient,
    );
    const json = await out.json() as any;

    const types = actionTypes();
    expect(types).toContain('SLY_INTERCEPT_START');
    const end = types.indexOf('SLY_INTERCEPT_END');
    const fallback = types.indexOf('SLY_FORCE_FALLBACK');
    expect(end).toBeGreaterThan(types.indexOf('SLY_INTERCEPT_START'));
    expect(fallback).toBeGreaterThan(end);
    expect(types).not.toContain('SKL_NATIVE_LYRICS');
    expect(posted.find((m) => m?.action?.type === 'SLY_FORCE_FALLBACK').action.trackId).toBe(TRACK_ID);
    expect(json.lyrics.lines.map((l: any) => l.words)).toEqual(fixture.lyrics.lines.map((l: any) => l.words));
  });
});

describe('scavenger: NPV preview exclusion is locale-independent (K10)', () => {
  it('does not fingerprint the Now Playing view preview when its aria-label is localised', () => {
    const before = SPOTIFY_CLASSES.container;
    (window as any).slyDeepScavengeStyles = undefined;
    document.body.innerHTML = `
      <div id="main"><div data-testid="root">
        <aside id="Desktop_PanelContainer_Id" aria-label="Vista de reproducción">
          <div data-testid="lyrics-npv-section" class="PreviewCardHashAbc" style="--lyrics-color-active: #fff;">
            <div class="PreviewListHashAbc"><div data-testid="lyrics-line"><div>linea de prueba uno</div></div></div>
            <div class="PreviewListHashAbc"><div data-testid="lyrics-line"><div>linea de prueba dos</div></div></div>
          </div>
        </aside>
      </div></div>`;
    slyScavengeClasses();
    expect(SPOTIFY_CLASSES.container).toBe(before);
    expect(SPOTIFY_CLASSES.container).not.toBe('PreviewCardHashAbc');
  });
});
