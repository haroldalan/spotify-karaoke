/**
 * Live round 2: on today's Spotify the lyrics button does nothing for a track without
 * lyrics (the old Genetic Lock relied on props Spotify removed). The extension then
 * opens Spotify's expanded Now Playing view through the sidebar's Expand control.
 * Synthetic DOM shaped like the 2026-11 web player; no real names or ids.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spotifyState, slyInternalState } from '../../lib/slyCore/state';
import {
  NATIVE_OPEN_WAIT_MS,
  cancelPendingOpen,
  findExpandNowPlayingButton,
  openIfSpotifyDoesNot,
} from '../../lib/slyCore/nowPlayingOpener';
import { isLyricsButtonActive } from '../../lib/dom/domQueries';
import '../../lib/slyCore/events';

const TRACK_URI = 'spotify:track:0000000000000000000Opn';
const icon = () => '<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"></path></svg>';

function sidebarHtml(afterMore = `<button class="tertiary" aria-label="Expand (localized)">${icon()}</button>`): string {
  return `<aside id="Desktop_PanelContainer_Id"><div class="header">
      <button aria-label="Hide (localized)">${icon()}</button>
      <div class="group"><button data-testid="more-button" aria-label="More">${icon()}</button>${afterMore}</div>
    </div></aside>`;
}

function loadPage(withSidebar = true, afterMore?: string): void {
  document.body.innerHTML = `<div id="main"><div data-testid="root"><div class="wrap">
      ${withSidebar ? sidebarHtml(afterMore) : ''}
      <aside data-testid="now-playing-bar">
        <div data-testid="now-playing-widget-v2" aria-label="Now playing: Invented Song by Invented Artist">
          <button data-testid="cover-art-button" aria-label="Now playing view"></button>
        </div>
        <button data-testid="lyrics-button" data-active="false" aria-pressed="false" aria-label="No lyrics (localized)"></button>
      </aside>
    </div></div></div>`;
}

const expandButton = () => document.querySelector('#Desktop_PanelContainer_Id .group button:not([data-testid])') as HTMLButtonElement | null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  (spotifyState as any).track = { uri: TRACK_URI, name: 'Invented Song' };
  (slyInternalState as any).panelIntentCooldown = 0;
});

afterEach(() => {
  cancelPendingOpen();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('opening the expanded Now Playing view when Spotify opens nothing', () => {
  it('finds Expand as the button after the sidebar header\'s more-button (labels are localized)', () => {
    loadPage();
    expect(findExpandNowPlayingButton()).toBe(expandButton());
  });

  it('refuses an unexpected button after more-button (has its own test id)', () => {
    loadPage(true, `<button data-testid="something-else">${icon()}</button>`);
    expect(findExpandNowPlayingButton()).toBeNull();
  });

  it('clicks Expand once when the lyrics view did not open', async () => {
    loadPage();
    const clicks = vi.fn();
    expandButton()!.addEventListener('click', clicks);
    openIfSpotifyDoesNot();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS - 50);
    expect(clicks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('leaves tracks with lyrics alone: Spotify opened its view in the meantime', async () => {
    loadPage();
    const clicks = vi.fn();
    expandButton()!.addEventListener('click', clicks);
    openIfSpotifyDoesNot();
    document.querySelector('[data-testid="lyrics-button"]')!.setAttribute('data-active', 'true');
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 100);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('opens the sidebar first (cover-art button) when it is closed', async () => {
    loadPage(false);
    const cover = document.querySelector('[data-testid="cover-art-button"]')!;
    const expandClicks = vi.fn();
    cover.addEventListener('click', () => {
      // Spotify mounts the sidebar a moment later.
      setTimeout(() => {
        document.querySelector('.wrap')!.insertAdjacentHTML('afterbegin', sidebarHtml());
        expandButton()!.addEventListener('click', expandClicks);
      }, 250);
    });
    openIfSpotifyDoesNot();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 600);
    expect(expandClicks).toHaveBeenCalledTimes(1);
  });

  it('the expanded view it opened counts as the lyrics view until it closes, then runs the close cleanup', async () => {
    loadPage();
    expandButton()!.addEventListener('click', () => {
      // Spotify mounts its overlay (artwork mode, lyrics option disabled); its lyrics button stays off.
      document.querySelector('.wrap')!.insertAdjacentHTML('beforeend',
        '<div id="np-overlay"><div role="radiogroup"><button role="radio" value="artwork" aria-checked="true"></button><button role="radio" value="lyrics" aria-checked="false" disabled></button></div></div>');
    });
    const closes = vi.fn();
    document.addEventListener('sly:panel_close', closes);
    expect(isLyricsButtonActive()).toBe(false);

    openIfSpotifyDoesNot();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 100);
    expect(document.querySelector('[data-testid="lyrics-button"]')!.getAttribute('data-active')).toBe('false');
    expect(isLyricsButtonActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(closes).not.toHaveBeenCalled();

    document.getElementById('np-overlay')!.remove(); // the user minimizes it
    await vi.advanceTimersByTimeAsync(600);
    expect(isLyricsButtonActive()).toBe(false);
    expect(closes).toHaveBeenCalledTimes(1);
    document.removeEventListener('sly:panel_close', closes);
  });

  it('an overlay the user opened with Spotify\'s own Expand control is not treated as the lyrics view', () => {
    loadPage();
    document.querySelector('.wrap')!.insertAdjacentHTML('beforeend',
      '<div><div role="radiogroup"><button role="radio" value="lyrics" disabled></button></div></div>');
    expect(isLyricsButtonActive()).toBe(false);
  });

  it('a mouse close of a lyrics view never opens the expanded view (the close hijack clears the button first)', async () => {
    loadPage();
    const clicks = vi.fn();
    expandButton()!.addEventListener('click', clicks);
    const coverClicks = vi.fn();
    document.querySelector('[data-testid="cover-art-button"]')!.addEventListener('click', coverClicks);
    const lyricsButton = document.querySelector<HTMLElement>('[data-testid="lyrics-button"]')!;
    lyricsButton.setAttribute('data-active', 'true');
    lyricsButton.dispatchEvent(new Event('pointerdown', { bubbles: true })); // close press: cooldown set
    lyricsButton.setAttribute('data-active', 'false'); // the bridge's nuke() before the click
    lyricsButton.setAttribute('aria-pressed', 'false');
    lyricsButton.click();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 100);
    expect(clicks).not.toHaveBeenCalled();
    expect(coverClicks).not.toHaveBeenCalled();
  });

  it('never toggles the sidebar when it is there but Expand is not recognised', async () => {
    loadPage(true, `<button data-testid="something-else">${icon()}</button>`);
    const coverClicks = vi.fn();
    document.querySelector('[data-testid="cover-art-button"]')!.addEventListener('click', coverClicks);
    openIfSpotifyDoesNot();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 2000);
    expect(coverClicks).not.toHaveBeenCalled();
  });

  it('adopts an expanded view the user opened on a track without lyrics', () => {
    loadPage();
    document.querySelector('.wrap')!.insertAdjacentHTML('beforeend',
      '<div><div role="radiogroup"><button role="radio" value="lyrics" disabled></button></div></div>');
    expect(isLyricsButtonActive()).toBe(false);
    document.querySelector<HTMLElement>('[data-testid="lyrics-button"]')!.click();
    expect(isLyricsButtonActive()).toBe(true);
  });

  it('a track WITH Spotify lyrics in that overlay (option enabled) is not treated as the extension\'s lyrics view', async () => {
    loadPage();
    expandButton()!.addEventListener('click', () => {
      document.querySelector('.wrap')!.insertAdjacentHTML('beforeend',
        '<div id="np-overlay"><div role="radiogroup"><button role="radio" value="lyrics" disabled></button></div></div>');
    });
    openIfSpotifyDoesNot();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 100);
    expect(isLyricsButtonActive()).toBe(true);
    document.querySelector<HTMLButtonElement>('#np-overlay button[value="lyrics"]')!.disabled = false; // next track has lyrics
    expect(isLyricsButtonActive()).toBe(false);
    document.querySelector<HTMLButtonElement>('#np-overlay button[value="lyrics"]')!.disabled = true; // a later track without
    expect(isLyricsButtonActive()).toBe(true);
  });

  it('a second press closes the view it opened (Spotify\'s minimize) and closes the sidebar it opened', async () => {
    loadPage(false);
    const cover = document.querySelector('[data-testid="cover-art-button"]')!;
    cover.addEventListener('click', () => {
      const side = document.getElementById('Desktop_PanelContainer_Id');
      if (side) { side.remove(); return; } // toggles the sidebar closed
      document.querySelector('.wrap')!.insertAdjacentHTML('afterbegin', sidebarHtml());
      expandButton()!.addEventListener('click', () => {
        document.querySelector('.wrap')!.insertAdjacentHTML('beforeend', `<div id="np-overlay"><div class="hdr"><div role="radiogroup"><button role="radio" value="lyrics" disabled></button></div><div class="grp"><button data-testid="more-button">${icon()}</button><button class="min">${icon()}</button></div></div></div>`);
        document.querySelector('#np-overlay .min')!.addEventListener('click', () => document.getElementById('np-overlay')!.remove());
      });
    });
    openIfSpotifyDoesNot();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 600);
    expect(document.getElementById('np-overlay')).not.toBeNull();
    expect(document.getElementById('Desktop_PanelContainer_Id')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-testid="lyrics-button"]')!.click(); // pressed again
    await vi.advanceTimersByTimeAsync(400);
    expect(document.getElementById('np-overlay')).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect(document.getElementById('Desktop_PanelContainer_Id')).toBeNull(); // back as the user had it
  });

  it('does nothing for episodes (not a music track)', async () => {
    loadPage();
    (spotifyState as any).track = { uri: 'spotify:episode:0000000000000000000Epi' };
    const clicks = vi.fn();
    expandButton()!.addEventListener('click', clicks);
    openIfSpotifyDoesNot();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 100);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('a click on the inactive lyrics button arms it (events.ts click handler)', async () => {
    loadPage();
    const clicks = vi.fn();
    expandButton()!.addEventListener('click', clicks);
    const lyricsButton = document.querySelector<HTMLElement>('[data-testid="lyrics-button"]')!;
    lyricsButton.click();
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 100);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('a click that closes the lyrics view never opens anything', async () => {
    loadPage();
    const clicks = vi.fn();
    expandButton()!.addEventListener('click', clicks);
    const lyricsButton = document.querySelector<HTMLElement>('[data-testid="lyrics-button"]')!;
    lyricsButton.setAttribute('data-active', 'true');
    lyricsButton.click();
    lyricsButton.setAttribute('data-active', 'false'); // closed
    await vi.advanceTimersByTimeAsync(NATIVE_OPEN_WAIT_MS + 100);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('opens almost at once (150 ms, not 0.7 s) when Spotify is known to have no lyrics for the track', async () => {
    loadPage();
    (window as any).slyPreFetchRegistry = { getState: (uri: string) => (uri === TRACK_URI ? { nativeStatus: 'MISSING' } : undefined) };
    try {
      const clicks = vi.fn();
      expandButton()!.addEventListener('click', clicks);
      document.querySelector<HTMLElement>('[data-testid="lyrics-button"]')!.click();
      await vi.advanceTimersByTimeAsync(200);
      expect(clicks).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as any).slyPreFetchRegistry;
    }
  });
});
