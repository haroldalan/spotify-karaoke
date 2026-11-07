import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getLyricsLines,
  getNowPlayingKey,
  getNowPlayingTitle,
  getNowPlayingTrackId,
  getThemedPanelContainer,
  isPreviewLine,
} from '../../lib/dom/domQueries';
import { createDomObserver, type SlyDomObserver } from '../../lib/dom/domObserver';

// Synthetic 2026-11-07 web-player DOM (real structure, invented text): the widget is
// [data-testid="now-playing-widget-v2"] and no element carries the track id.
const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf-8');

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

const flush = () => new Promise(r => setTimeout(r, 0));
const widget = () => document.querySelector('[data-testid="now-playing-widget-v2"]')!;

/** A Now Playing view lyrics preview in a non-English UI (aria-label localised). */
function addLocalisedPreview(): void {
  const aside = document.getElementById('Desktop_PanelContainer_Id')!;
  aside.setAttribute('aria-label', 'Vista de reproducción');
  aside.innerHTML =
    '<div data-testid="lyrics-npv-section" style="--lyrics-color-active: rgba(255, 255, 255, 1);">' +
    '<div><div data-testid="lyrics-line"><div>Preview one</div></div>' +
    '<div data-testid="lyrics-line"><div>Preview two</div></div>' +
    '<div data-testid="lyrics-line"><div>Preview three</div></div>' +
    '<div data-testid="lyrics-line"><div>Preview four</div></div>' +
    '<div data-testid="lyrics-line"><div>Preview five</div></div>' +
    '<div data-testid="lyrics-line"><div>Preview six</div></div>' +
    '<div data-testid="lyrics-line"><div>Preview seven</div></div>' +
    '<div data-testid="lyrics-line"><div>Preview eight</div></div></div></div>';
}

describe('p1-C domQueries on the 2026-11 UI (now-playing-widget-v2)', () => {
  beforeEach(() => {
    loadFixture();
    (window as any).spotifyState = { track: null };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    (window as any).spotifyState = { track: null };
  });

  it('reads the song key and the title from the v2 widget', () => {
    expect(document.querySelector('[data-testid="now-playing-widget"]')).toBeNull();
    expect(getNowPlayingKey()).toBe('Now playing: Test Song by Test Artist, Second Artist');
    // Title from the album link text, not the localised aria-label.
    widget().setAttribute('aria-label', 'Reproduciendo: Test Song de Test Artist, Second Artist');
    expect(getNowPlayingTitle()).toBe('Test Song');
  });

  it('takes the track id from the bridge only when its name matches the v2 widget title', () => {
    expect(getNowPlayingTrackId()).toBeNull(); // no DOM element carries the id any more

    (window as any).spotifyState = { track: { uri: 'spotify:track:4UMIv5jd9gK98a39BQRD9X', name: 'Test Song' } };
    expect(getNowPlayingTrackId()).toBe('4UMIv5jd9gK98a39BQRD9X');

    // Bridge still on the previous track: never hand out its id.
    (window as any).spotifyState = { track: { uri: 'spotify:track:PreviousTrack0000000001', name: 'Previous Song' } };
    expect(getNowPlayingTrackId()).toBeNull();
  });

  it('returns the 7 overlay lines and the overlay themed container', () => {
    const lines = getLyricsLines();
    expect(lines).toHaveLength(7);
    expect(lines[0].textContent).toBe('Mera dil tera hai, tu kahan hai yaar');
    expect(getThemedPanelContainer()?.classList.contains('bm5I7yGVN8NXt6vH9eiC')).toBe(true);
  });

  it('excludes a Now Playing view preview by #Desktop_PanelContainer_Id, whatever the locale', () => {
    addLocalisedPreview();
    const previewLine = document.querySelector('#Desktop_PanelContainer_Id [data-testid="lyrics-line"]')!;
    expect(isPreviewLine(previewLine)).toBe(true);
    // Also outside the preview card: the sidebar id alone (no class, localised aria-label) is enough.
    const stray = document.createElement('div');
    stray.setAttribute('data-testid', 'lyrics-line');
    document.getElementById('Desktop_PanelContainer_Id')!.appendChild(stray);
    expect(isPreviewLine(stray)).toBe(true);
    // The preview has more rows than the overlay; it must still never be picked.
    const lines = getLyricsLines();
    expect(lines).toHaveLength(7);
    expect(lines.map(l => l.textContent)).not.toContain('Preview one');
    expect(getThemedPanelContainer()?.classList.contains('bm5I7yGVN8NXt6vH9eiC')).toBe(true);
  });
});

describe('p1-C domObserver song changes on the 2026-11 UI', () => {
  let observer: SlyDomObserver | null = null;
  let onSongChange: ReturnType<typeof vi.fn<(key: string) => void>>;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (window as any).browser.runtime.id = 'test-id';
    loadFixture();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    onSongChange = vi.fn<(key: string) => void>();
    observer = createDomObserver({
      onSongChange,
      onLyricsInjected: vi.fn(),
      onControlsRemoved: vi.fn(),
      onInvalidate: vi.fn(),
    });
  });

  afterEach(() => {
    observer?.disconnect();
    observer = null;
    consoleLog.mockRestore();
    document.body.innerHTML = '';
  });

  it('fires onSongChange when the v2 widget aria-label changes', async () => {
    widget().setAttribute('aria-label', 'Now playing: Next Song by Other Artist');
    await flush();
    expect(onSongChange).toHaveBeenCalledWith('Now playing: Next Song by Other Artist');
  });

  it('fires onSongChange when the v2 widget is replaced', async () => {
    const replacement = widget().cloneNode(true) as Element;
    replacement.setAttribute('aria-label', 'Now playing: Third Song by Other Artist');
    widget().replaceWith(replacement);
    await flush();
    expect(onSongChange).toHaveBeenCalledWith('Now playing: Third Song by Other Artist');
  });
});
