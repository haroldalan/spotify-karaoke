// @vitest-environment happy-dom
// The switcher lives inside Spotify's lyrics view, not on body: Spotify opens the view with a
// view transition that draws the view as one layer above the page, so a switcher on body
// only showed once the animation had ended (it popped in, 2026-11-10).
import { describe, expect, it } from 'vitest';
import { Pill } from '../../src/content/pill';

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
