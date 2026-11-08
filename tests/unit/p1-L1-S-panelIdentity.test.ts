import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentSongOnly, getLyricsContainer, getLyricsLines, getThemedPanelContainer,
  PANEL_TRACK_ATTR, PLAYING_TRACK_ATTR,
} from '../../lib/dom/domQueries';

// Spotify kept earlier songs' lyrics panels mounted beside the current one (live 2026-11-08:
// five panels; the extension took the biggest, another song's, and Translated did nothing).
// Invented text only.

const NOW = 'spotify:track:0000000000000000000Now';
const OLD_A = 'spotify:track:00000000000000000OldA';
const OLD_B = 'spotify:track:00000000000000000OldB';

/** A themed panel with `rows` lyric rows; tagged like the bridge does when `uri` is given. */
function panel(rows: number, label: string, uri?: string): HTMLElement {
  const themed = document.createElement('div');
  themed.setAttribute('style', '--lyrics-color-active: #fff');
  const list = document.createElement('div');
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    row.setAttribute('data-testid', 'lyrics-line');
    const inner = document.createElement('div');
    inner.textContent = `${label} invented line ${i}`;
    row.appendChild(inner);
    list.appendChild(row);
  }
  themed.appendChild(list);
  if (uri) {
    themed.setAttribute(PANEL_TRACK_ATTR, uri);
    list.setAttribute(PANEL_TRACK_ATTR, uri);
  }
  document.body.appendChild(themed);
  return themed;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(PLAYING_TRACK_ATTR);
  (window as any).spotifyState = { track: null };
});

describe('the current song\'s lyrics panel, with other songs\' panels still mounted', () => {
  it('takes the playing song\'s panel even when another song\'s is bigger and comes first', () => {
    panel(54, 'older', OLD_A);
    panel(51, 'old', OLD_B);
    const mine = panel(27, 'now', NOW);
    document.documentElement.setAttribute(PLAYING_TRACK_ATTR, NOW);

    const lines = getLyricsLines();
    expect(lines).toHaveLength(27);
    expect(lines[0].textContent).toBe('now invented line 0');
    expect(getLyricsContainer()).toBe(mine.firstElementChild);
    expect(getThemedPanelContainer()).toBe(mine);
  });

  it('uses the bridge\'s last track message when <html> carries no playing uri yet', () => {
    panel(54, 'older', OLD_A);
    const mine = panel(27, 'now', NOW);
    (window as any).spotifyState = { track: { uri: NOW } };
    expect(getThemedPanelContainer()).toBe(mine);
    expect(getLyricsLines()).toHaveLength(27);
  });

  it('the playing song\'s panel not mounted yet: no rows, never another song\'s', () => {
    panel(54, 'older', OLD_A);
    panel(51, 'old', OLD_B);
    document.documentElement.setAttribute(PLAYING_TRACK_ATTR, NOW);
    expect(getLyricsLines()).toEqual([]);
    expect(getThemedPanelContainer()).toBeNull();
  });

  it('a panel the bridge has not tagged yet still counts (it may be the new song\'s)', () => {
    panel(54, 'older', OLD_A);
    panel(51, 'old', OLD_B);
    panel(20, 'fresh');
    document.documentElement.setAttribute(PLAYING_TRACK_ATTR, NOW);
    expect(getLyricsLines()[0].textContent).toBe('fresh invented line 0');
  });

  it('one song\'s panel only: used as before, even while the playing uri still names the previous song', () => {
    const only = panel(30, 'only', NOW);
    document.documentElement.setAttribute(PLAYING_TRACK_ATTR, OLD_A);
    expect(getLyricsLines()).toHaveLength(30);
    expect(getThemedPanelContainer()).toBe(only);
  });

  it('no tags (bridge not ready, or Spotify renamed the prop): the largest panel, as before', () => {
    panel(54, 'older');
    panel(27, 'now');
    document.documentElement.setAttribute(PLAYING_TRACK_ATTR, NOW);
    expect(getLyricsLines()).toHaveLength(54);
    expect(currentSongOnly()(document.body.firstElementChild!)).toBe(true);
  });

  it('the Now Playing view preview never counts as a panel', () => {
    const aside = document.createElement('aside');
    aside.setAttribute('aria-label', 'Now playing view');
    document.body.appendChild(aside);
    const preview = panel(5, 'preview', OLD_A);
    aside.appendChild(preview);
    const mine = panel(27, 'now', NOW);
    document.documentElement.setAttribute(PLAYING_TRACK_ATTR, NOW);
    // Only one song's full panel: nothing is filtered, and the preview is excluded as always.
    expect(getThemedPanelContainer()).toBe(mine);
    expect(getLyricsLines()).toHaveLength(27);
  });
});
