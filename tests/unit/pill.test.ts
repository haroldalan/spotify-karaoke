// @vitest-environment happy-dom
// The switcher lives inside Spotify's lyrics view, not on body: Spotify opens the view with a
// view transition that draws the view as one layer above the page, so a switcher on body
// only showed once the animation had ended (it popped in, 2026-11-10).
import { describe, expect, it } from 'vitest';
import { Pill, noticeIdentity, type Notice } from '../../src/content/pill';

const anchor = { top: 148, centerX: 700, width: 1384, height: 538 };
const state = { mode: 'romanized' as const, modes: ['original', 'romanized', 'translated'] as ('original' | 'romanized' | 'translated')[], busy: false };

describe('the switcher', () => {
  it('goes inside the lyrics view, at the spot under its header', () => {
    document.body.innerHTML = '<div id="view"><div id="lines"></div></div>';
    const view = document.getElementById('view')!;
    const pill = new Pill(() => {});
    pill.update({ ...state, visible: true, anchor, container: view });
    expect(document.querySelector('sk-pill')?.parentElement).toBe(view);
    expect(pill.debugState().switcher).toEqual({ top: '148px', left: '700px' });
  });

  it('follows the view into the new element Spotify mounts when it is opened again', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const pill = new Pill(() => {});
    pill.update({ ...state, visible: true, anchor, container: document.getElementById('a') });
    pill.update({ ...state, visible: true, anchor, container: document.getElementById('b') });
    expect(document.querySelectorAll('sk-pill')).toHaveLength(1);
    expect(document.querySelector('sk-pill')?.parentElement?.id).toBe('b');
  });

  it('falls back to body when the view has no element of its own', () => {
    document.body.innerHTML = '';
    const pill = new Pill(() => {});
    pill.update({ ...state, visible: true, anchor, container: null });
    expect(document.querySelector('sk-pill')?.parentElement).toBe(document.body);
  });

  it('stays hidden (and out of the page) until there is a view to show it in', () => {
    document.body.innerHTML = '';
    const pill = new Pill(() => {});
    pill.update({ ...state, visible: false, anchor: null, container: null });
    expect(pill.debugState()).toMatchObject({ mounted: false, switcher: null });
  });
});

describe('the no-lyrics notice', () => {
  const search = { label: 'Search again', run: () => {} };
  const add = { label: 'Add lyrics to LRCLIB', href: 'https://lrclib.net/' };

  it('is redrawn when only the highlight moves (the buttons keep their places)', () => {
    const before: Notice = { key: 's', caption: '', actions: [search, { ...add, primary: true }] };
    const after: Notice = { key: 's', caption: '', actions: [{ ...search, primary: true }, add] };
    expect(noticeIdentity(before)).not.toBe(noticeIdentity(after));
  });

  it('takes the view\'s width, not its zero-size host\'s: no text wrapped a word to a line', () => {
    document.body.innerHTML = '<div id="view"></div>';
    const pill = new Pill(() => {});
    pill.notice({ key: 's', caption: 'Lyrics found. Spotify shows them after a reload, which stops the music.', actions: [] }, anchor, document.getElementById('view'));
    expect(pill.debugState().notice).toMatchObject({ top: '148px', left: '700px' });
    expect(pill.debugState().noticeMaxWidth).toBe('1336px');
  });
});

describe('Spotify\'s empty lyrics view under the notice', () => {
  it('finds the element that scrolls the view, and the hold is undone by clear()', async () => {
    const { viewScroller, clear } = await import('../../src/content/decorate');
    document.body.innerHTML = '<div id="view"><div id="sc" style="overflow-y: scroll; height: 600px"><div style="height: 1300px"></div></div></div>';
    const sc = document.getElementById('sc')!;
    Object.defineProperty(sc, 'clientHeight', { value: 600 });
    expect(viewScroller(document.getElementById('view'))).toBe(sc);
    sc.setAttribute('data-sk-still', '');
    clear();
    expect(sc.hasAttribute('data-sk-still')).toBe(false);
  });
});
