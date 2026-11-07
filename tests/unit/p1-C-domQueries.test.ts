import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getAppRoot,
  getLyricsContainer,
  getLyricsLines,
  getNowPlayingTitle,
  getNowPlayingTrackId,
  getSlyLayoutHost,
  getThemedPanelContainer,
  getViewportRoot,
  titlesMatch,
} from '../../lib/dom/domQueries';

// Synthetic Oct-2026 web-player DOM (real structure, invented text).
const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf-8');

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

describe('p1-C domQueries on the 2026 lyrics overlay', () => {
  beforeEach(() => {
    loadFixture();
    (window as any).spotifyState = { track: null };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    (window as any).spotifyState = { track: null };
    delete (window as any).SPOTIFY_CLASSES;
  });

  it('reads the track id from the Now Playing view link when the widget has no track link', () => {
    // The widget only links to /album and /artist in the 2026 UI.
    expect(document.querySelector('[data-testid="now-playing-widget"] a[href*="/track/"]')).toBeNull();
    expect(getNowPlayingTrackId()).toBe('4UMIv5jd9gK98a39BQRD9X');
  });

  it('keeps the legacy widget link lookup as the first source', () => {
    const widget = document.querySelector('[data-testid="now-playing-widget"]')!;
    const a = document.createElement('a');
    a.setAttribute('href', '/track/LegacyTrackId0000000001');
    widget.appendChild(a);
    expect(getNowPlayingTrackId()).toBe('LegacyTrackId0000000001');
  });

  it('falls back to spotifyState only when its track name matches the widget title', () => {
    document.getElementById('Desktop_PanelContainer_Id')!.remove();
    expect(getNowPlayingTitle()).toBe('Test Song');

    (window as any).spotifyState = { track: { uri: 'spotify:track:BridgeTrackId0000000001', name: 'test song' } };
    expect(getNowPlayingTrackId()).toBe('BridgeTrackId0000000001');

    // The bridge lags the widget: a previous track's state must not leak its id.
    (window as any).spotifyState = { track: { uri: 'spotify:track:PreviousTrack0000000001', name: 'Previous Song' } };
    expect(getNowPlayingTrackId()).toBeNull();
  });

  it('returns null when the Now Playing view link and a title-verified bridge disagree', () => {
    (window as any).spotifyState = { track: { uri: 'spotify:track:4UMIv5jd9gK98a39BQRD9X', name: 'Test Song' } };
    expect(getNowPlayingTrackId()).toBe('4UMIv5jd9gK98a39BQRD9X');
    // Same title, different track (e.g. an intro on two albums): ambiguous.
    (window as any).spotifyState = { track: { uri: 'spotify:track:SameTitleOther00000001', name: 'Test Song' } };
    expect(getNowPlayingTrackId()).toBeNull();
  });

  it('returns the 7 overlay lines and none of the 3 Now Playing preview lines', () => {
    const lines = getLyricsLines();
    expect(lines).toHaveLength(7);
    expect(lines.map(l => l.textContent)).not.toContain('Preview line one');
    expect(lines.every(l => !l.closest('aside'))).toBe(true);
    expect(lines[0].textContent).toBe('Mera dil tera hai, tu kahan hai yaar');
    expect(getLyricsContainer()?.querySelectorAll('[data-testid="lyrics-line"]')).toHaveLength(7);
  });

  it('resolves the viewport root to div#main and the app root to [data-testid="root"]', () => {
    const viewportRoot = getViewportRoot();
    expect(viewportRoot?.tagName).toBe('DIV');
    expect(viewportRoot?.id).toBe('main');
    expect(document.getElementById('root')).toBeNull();
    expect(getAppRoot()?.getAttribute('data-testid')).toBe('root');
    // The <main> tag holds the playlist page, not the lyrics.
    expect(document.querySelector('main')?.querySelector('[data-testid="lyrics-line"]')).toBeNull();
  });

  it('picks the full-panel themed container, not the preview card', () => {
    const themed = getThemedPanelContainer();
    expect(themed?.classList.contains('bm5I7yGVN8NXt6vH9eiC')).toBe(true);
  });

  it('K11: the layout host is the themed container parent, with legacy main as fallback', () => {
    const host = getSlyLayoutHost();
    expect(host).toBe(getThemedPanelContainer()?.parentElement);
    expect(host?.classList.contains('QkWpHgKU0KPSQGTuVpP3')).toBe(true);

    // No themed container (legacy UI): fall back to main.<mainContainer>.
    getThemedPanelContainer()!.removeAttribute('style');
    (window as any).SPOTIFY_CLASSES = { mainContainer: 'TKq2Yidc5rgHzpJFRFYW' };
    expect(getSlyLayoutHost()?.tagName).toBe('MAIN');
  });
});

describe('titlesMatch', () => {
  it('matches titles that differ only in U+3000, NBSP, double spaces, edges or case', () => {
    expect(titlesMatch('Test\u3000Song', 'Test Song')).toBe(true);
    expect(titlesMatch('Test\u00a0Song', 'test song')).toBe(true);
    expect(titlesMatch('Test  Song ', ' Test Song')).toBe(true);
    expect(titlesMatch('Test\u3000\u00a0 Song\u202f?', 'TEST SONG ?')).toBe(true);
  });

  it('matches NFC and NFD spellings of the same title', () => {
    expect(titlesMatch('Cafe\u0301 Song', 'Caf\u00e9 Song')).toBe(true);
  });

  it('does not match different titles or empty titles', () => {
    expect(titlesMatch('Previous Song', 'Test Song')).toBe(false);
    expect(titlesMatch('TestSong', 'Test Song')).toBe(false);
    expect(titlesMatch('', '')).toBe(false);
    expect(titlesMatch('Test Song', '')).toBe(false);
  });

  it('getNowPlayingTrackId accepts a bridge name that differs only in whitespace', () => {
    loadFixture();
    document.getElementById('Desktop_PanelContainer_Id')!.remove();
    (window as any).spotifyState = { track: { uri: 'spotify:track:BridgeTrackId0000000002', name: 'Test\u3000Song' } };
    expect(getNowPlayingTrackId()).toBe('BridgeTrackId0000000002');
    (window as any).spotifyState = { track: null };
    document.body.innerHTML = '';
  });
});
