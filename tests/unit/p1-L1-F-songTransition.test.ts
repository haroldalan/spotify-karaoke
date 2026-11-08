import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Live 2026-11-08: Spotify slides from one song's view to the next (each song has its own
// slide wrapper, moved with an inline translateX). The extension took its lyrics down in
// the middle of that slide (blank view, the previous song's Spotify lyrics for a moment),
// and the mode pill, inside the old song's list, left with it and came back.

const panel = (text: string) => `<div class="slot"><div class="panel" style="--lyrics-color-active: #fff">
  <div class="list"><div data-testid="lyrics-line"><div>${text}</div></div></div></div></div>`;

function view(inner: string): string {
  return `<div data-testid="root"><div><div class="overlay" style="position: relative">
    <div class="header"><button role="radio" value="lyrics" aria-checked="true"></button></div>
    <div class="content"><div class="slides">${inner}</div></div>
  </div></div></div>`;
}
const slide = (inner: string, x = '0%') => `<div class="slide" style="transform: translateX(${x})">${inner}</div>`;
const PREV_URI = 'spotify:track:000000000000000000Prev';
const NEXT_URI = 'spotify:track:000000000000000000Next';
/** A panel the bridge tagged with its track (the list carries data-sly-track-uri). */
const tagged = (html: string, uri: string) => html.replace('<div class="list">', `<div class="list" data-sly-track-uri="${uri}">`);

let mod: typeof import('../../lib/dom/songTransition');
let queries: typeof import('../../lib/dom/domQueries');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
  mod = await import('../../lib/dom/songTransition');
  queries = await import('../../lib/dom/domQueries');
});
afterEach(() => {
  mod.resetSongTransition();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Our lyrics (takeover) in the current slide, Spotify's panel hidden under them, the pill in them. */
function takeoverView(): void {
  document.body.innerHTML = view(slide(`<div class="slot">
    <div id="lyrics-root-sync" style="--lyrics-color-active: #fff"><div class="list">
      <div id="sly-lyrics-controls" class="sly-lyrics-controls"><button>Original</button></div>
      <div class="line">An invented line of ours</div></div></div>
    <div class="panel" style="--lyrics-color-active: #fff; display: none"><div class="list"><div data-testid="lyrics-line"><div>Spotify line</div></div></div></div>
  </div>`));
}

describe('the previous song leaves with Spotify\'s slide', () => {
  it('our lyrics: a still copy stays on the leaving slide; the slide is out of every query', () => {
    takeoverView();
    const old = document.querySelector('.slide') as HTMLElement;
    mod.beginSongTransition();
    expect(old.getAttribute('data-sly-leaving')).toBe('ours');
    const copy = old.querySelector('[data-sly-root-leaving]');
    expect(copy?.textContent).toContain('An invented line of ours');
    expect(copy?.id).toBe('');
    expect(copy?.querySelector('[id]')).toBeNull();
    // The real root is still there for the usual code to take down.
    expect(document.getElementById('lyrics-root-sync')).not.toBeNull();
    // Nothing on the leaving slide is the current song's panel.
    expect(queries.getThemedPanelContainer()).toBeNull();
    expect(queries.getLyricsLines()).toHaveLength(0);
  });

  it('Spotify unmounts the leaving slide: done (copies gone, nothing marked)', () => {
    takeoverView();
    mod.beginSongTransition();
    const slides = document.querySelector('.slides')!;
    slides.insertAdjacentHTML('beforeend', slide(panel('Next song line'), '100%'));
    // The next song's panel is the current one.
    expect(queries.getThemedPanelContainer()?.textContent).toContain('Next song line');
    document.querySelector('[data-sly-leaving]')!.remove();
    return Promise.resolve().then(() => {
      expect(mod.isSongTransitionActive()).toBe(false);
      expect(document.querySelector('[data-sly-root-leaving], [data-sly-leaving]')).toBeNull();
    });
  });

  it('Spotify keeps the unmounted slide and mounts it again later: the copy is gone from it', async () => {
    takeoverView();
    const old = document.querySelector('.slide') as HTMLElement;
    mod.beginSongTransition();
    const slides = document.querySelector('.slides')!;
    slides.insertAdjacentHTML('beforeend', slide(panel('Next song line'), '100%'));
    old.remove();
    await Promise.resolve();
    expect(mod.isSongTransitionActive()).toBe(false);
    expect(old.querySelector('[data-sly-root-leaving]')).toBeNull();
    expect(old.hasAttribute('data-sly-leaving')).toBe(false);
  });

  it('no next slide (Spotify did not slide): ended after NO_SLIDE_MS', () => {
    takeoverView();
    mod.beginSongTransition();
    vi.advanceTimersByTime(mod.NO_SLIDE_MS + 10);
    expect(document.querySelector('[data-sly-root-leaving], [data-sly-leaving]')).toBeNull();
  });

  it('Spotify\'s own lyrics leaving: the slide is marked, no copy is made', () => {
    document.body.innerHTML = view(slide(panel('Spotify line')));
    mod.beginSongTransition();
    expect(document.querySelector('.slide')!.getAttribute('data-sly-leaving')).toBe('spotify');
    expect(document.querySelector('[data-sly-root-leaving]')).toBeNull();
  });

  it('the next slide is already there: the one showing the previous song\'s lines is marked', () => {
    document.body.innerHTML = view(slide(panel('Next song line'), '-100%') + slide(panel('Previous song line')));
    mod.beginSongTransition(['Previous song line']);
    const marked = document.querySelector('[data-sly-leaving]');
    expect(marked?.textContent).toContain('Previous song line');
    expect(queries.getLyricsLines().map(el => el.textContent)).toEqual(['Next song line']);
  });

  it('two slides and no known lines: nothing is marked', () => {
    document.body.innerHTML = view(slide(panel('Next song line'), '-100%') + slide(panel('Previous song line')));
    mod.beginSongTransition();
    expect(document.querySelector('[data-sly-leaving]')).toBeNull();
  });

  it('the song being left had no lyrics: the only panel is the next song\'s and is not marked (live: ignored for 1.5 s)', () => {
    document.body.innerHTML = view(slide(tagged(panel('Next song line'), NEXT_URI), '100%'));
    mod.beginSongTransition([], PREV_URI);
    expect(document.querySelector('[data-sly-leaving]')).toBeNull();
    expect(queries.getLyricsLines().map(el => el.textContent)).toEqual(['Next song line']);
  });

  it('the previous track is known: its tagged slide is marked, whatever the lines (also given as a bare id)', () => {
    document.body.innerHTML = view(slide(tagged(panel('Next song line'), NEXT_URI), '-100%') + slide(tagged(panel('Previous song line'), PREV_URI)));
    mod.beginSongTransition([], PREV_URI.split(':').pop()!);
    expect(document.querySelector('[data-sly-leaving]')?.textContent).toContain('Previous song line');
  });

  it('the only panel belongs to the song now playing (after an ad, mounted during it): not marked (live)', () => {
    document.body.innerHTML = view(slide(tagged(panel('Next song line'), NEXT_URI)));
    mod.beginSongTransition(['Next song line'], null, NEXT_URI.split(':').pop()!);
    expect(document.querySelector('[data-sly-leaving]')).toBeNull();
  });

  it('untagged panels (no bridge yet): the only slide is marked, as before', () => {
    document.body.innerHTML = view(slide(panel('Spotify line')));
    mod.beginSongTransition([], PREV_URI);
    expect(document.querySelector('.slide')!.getAttribute('data-sly-leaving')).toBe('spotify');
  });

  it('bridge running and the only panel not tagged yet: it was just mounted (the next song\'s), not marked (live)', () => {
    document.documentElement.setAttribute('data-sly-playing-uri', PREV_URI);
    try {
      document.body.innerHTML = view(slide(panel('Next song line'), '100%'));
      mod.beginSongTransition([], PREV_URI);
      expect(document.querySelector('[data-sly-leaving]')).toBeNull();
      // The previous song's lines on it are still evidence enough.
      document.body.innerHTML = view(slide(panel('Previous song line')) + slide(panel('Next song line'), '100%'));
      mod.beginSongTransition(['Previous song line'], PREV_URI);
      expect(document.querySelector('[data-sly-leaving]')?.textContent).toContain('Previous song line');
    } finally {
      document.documentElement.removeAttribute('data-sly-playing-uri');
    }
  });

  it('idempotent: a second call for the same change does nothing more', () => {
    takeoverView();
    mod.beginSongTransition();
    mod.beginSongTransition();
    expect(document.querySelectorAll('[data-sly-root-leaving]')).toHaveLength(1);
  });

  it('view closed (no expanded view): nothing happens', () => {
    document.body.innerHTML = '<div id="lyrics-root-sync"></div>';
    mod.beginSongTransition();
    expect(document.querySelector('[data-sly-leaving]')).toBeNull();
  });
});

describe('the pill has one home on the view: a song change never touches it', () => {
  async function controls() {
    return import('../../lib/dom/lyricsControls');
  }

  it('placed for a song\'s list, it goes on the view itself (outside the slides), under the header', async () => {
    document.body.innerHTML = view(slide(panel('A line')));
    const { injectControls, isPillDocked } = await controls();
    injectControls(document.querySelector('.list')!, true, 'original', 'original', () => {});
    const pill = document.getElementById('sly-lyrics-controls')!;
    expect(pill.parentElement?.classList.contains('overlay')).toBe(true);
    expect(pill.closest('.slide')).toBeNull();
    expect(isPillDocked(pill)).toBe(true);
  });

  it('Spotify throws the old song\'s slide away: the same pill is still there', async () => {
    document.body.innerHTML = view(slide(panel('A line')));
    const { injectControls } = await controls();
    injectControls(document.querySelector('.list')!, true, 'original', 'original', () => {});
    const pill = document.getElementById('sly-lyrics-controls')!;
    mod.beginSongTransition();
    const slides = document.querySelector('.slides')!;
    slides.insertAdjacentHTML('beforeend', slide(panel('Next song line'), '100%'));
    document.querySelector('[data-sly-leaving]')!.remove();
    expect(document.getElementById('sly-lyrics-controls')).toBe(pill);
    expect(pill.isConnected).toBe(true);
    // Placed for the next song: not moved.
    injectControls(Array.from(document.querySelectorAll('.list')).at(-1)!, true, 'original', 'original', () => {});
    expect(document.getElementById('sly-lyrics-controls')).toBe(pill);
    expect(pill.parentElement?.classList.contains('overlay')).toBe(true);
  });

  it('our lyrics: the pill is not in them (rebuilding them does not take it away)', async () => {
    takeoverView();
    document.getElementById('sly-lyrics-controls')!.remove();
    const { injectControls } = await controls();
    injectControls(document.querySelector('#lyrics-root-sync .list')!, true, 'original', 'original', () => {});
    const pill = document.getElementById('sly-lyrics-controls')!;
    expect(document.getElementById('lyrics-root-sync')!.contains(pill)).toBe(false);
  });

  it('parkPill (song change without cached lyrics) leaves it on the view, in its loading look', async () => {
    document.body.innerHTML = view(slide(panel('A line')));
    const { injectControls } = await controls();
    injectControls(document.querySelector('.list')!, true, 'original', 'original', () => {});
    const pill = document.getElementById('sly-lyrics-controls')!;
    const { parkPill } = await import('../../lib/dom/pillStateManager');
    parkPill('original', true);
    expect(pill.parentElement?.classList.contains('overlay')).toBe(true);
    expect(pill.classList.contains('sly-loading')).toBe(true);
  });

  it('legacy layout (no expanded view): in the list, as before', async () => {
    document.body.innerHTML = '<main><div class="list"><div class="line"></div></div></main>';
    const { injectControls, isPillDocked } = await controls();
    injectControls(document.querySelector('.list')!, true, 'original', 'original', () => {});
    const pill = document.getElementById('sly-lyrics-controls')!;
    expect(pill.parentElement?.classList.contains('list')).toBe(true);
    expect(isPillDocked(pill)).toBe(false);
  });
});

describe('waiting for the next song\'s lyrics panel', () => {
  it('runs the given step once the panel mounts (not for the leaving slide\'s panel)', async () => {
    document.body.innerHTML = view(slide(panel('Old line')));
    mod.beginSongTransition();
    const onMount = vi.fn();
    mod.kickWhenPanelMounts(onMount);
    expect(onMount).not.toHaveBeenCalled();
    document.querySelector('.slides')!.insertAdjacentHTML('beforeend', slide(panel('Next song line'), '100%'));
    await Promise.resolve();
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
