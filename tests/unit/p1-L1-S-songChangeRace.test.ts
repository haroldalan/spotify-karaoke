/**
 * Song change race (live 2026-11-08): Pipeline B paints the new song from memory at
 * +30–40 ms, then slyCore's track-switch reset (it noticed the change later, through the
 * bridge) released and purged everything: the song just painted showed its original
 * lines for ~0.5 s, in both skip directions. The reset now keeps what B painted for the
 * song now playing. Invented text only.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createModeController } from '../../lib/core/modeController';
import { createLifecycleController, setupSlyBridge } from '../../lib/core/lifecycleController';
import { StateStore } from '../../lib/core/store';
import '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import '../../lib/slyCore/ui';
// After the controllers: lyricsDOM first would change the order of a circular import.
import { purgeSlyDOM, watchPanelSongChanges } from '../../lib/dom/lyricsDOM';
import { resetSongTransition } from '../../lib/dom/songTransition';

const NEW_ID = '0000000000000000000New';
const NEW_URI = `spotify:track:${NEW_ID}`;
const OLD_URI = 'spotify:track:0000000000000000000Old';
const w = window as any;

const store = new StateStore();
beforeAll(() => {
  const mc = createModeController({ store });
  createLifecycleController({ store, switchMode: mc.switchMode, reapplyMode: mc.reapplyMode, autoSwitchIfNeeded: mc.autoSwitchIfNeeded });
  setupSlyBridge(store, mc.switchMode, mc.autoSwitchIfNeeded, () => {});
});

/** A painted lyrics panel (rows with our spans and the original kept), tagged with its track. */
function paintedPanel(uri: string | null, label: string): HTMLElement {
  const themed = document.createElement('div');
  themed.setAttribute('style', '--lyrics-color-active: #fff');
  if (uri) themed.setAttribute('data-sly-track-uri', uri);
  const list = document.createElement('div');
  if (uri) list.setAttribute('data-sly-track-uri', uri);
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.setAttribute('data-testid', 'lyrics-line');
    const inner = document.createElement('div');
    inner.setAttribute('data-sly-original', `${label} original ${i}`);
    inner.innerHTML = `<span class="sly-main-line">${label} romanized ${i}</span><span class="sly-dual-line">${label} original ${i}</span>`;
    row.appendChild(inner);
    list.appendChild(row);
  }
  themed.appendChild(list);
  document.body.appendChild(themed);
  return list;
}

const painted = (list: HTMLElement) => list.querySelectorAll('.sly-main-line').length;

beforeEach(() => {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  document.body.innerHTML = '';
  document.documentElement.setAttribute('data-sly-playing-uri', NEW_URI);
  Object.assign(store, new StateStore());
  store.songKey = 'Now playing: New Invented Song by Invented Artist';
  store.lyricsAppliedForKey = store.songKey;
  store.preferredMode = 'romanized';
  store.mode = 'romanized';
  store.trackId = NEW_ID;
});

describe('slyPaintedCurrentSong: has Pipeline B painted the song the reset names?', () => {
  it('by track id when known', () => {
    expect(w.slyPaintedCurrentSong(NEW_URI, 'Anything')).toBe(true);
    expect(w.slyPaintedCurrentSong(OLD_URI, 'New Invented Song')).toBe(false);
  });

  it('by title while the id is not resolved yet', () => {
    store.trackId = null;
    expect(w.slyPaintedCurrentSong(NEW_URI, 'New Invented Song')).toBe(true);
    expect(w.slyPaintedCurrentSong(NEW_URI, 'Previous Invented Song')).toBe(false);
  });

  it('never when nothing is painted for the current key, or the painted mode is original', () => {
    store.lyricsAppliedForKey = '';
    expect(w.slyPaintedCurrentSong(NEW_URI, 'New Invented Song')).toBe(false);
    store.lyricsAppliedForKey = store.songKey;
    store.mode = 'original';
    expect(w.slyPaintedCurrentSong(NEW_URI, 'New Invented Song')).toBe(false);
  });
});

describe('sly:release', () => {
  it('a track switch that keeps the paint leaves the painted mode alone', () => {
    document.dispatchEvent(new CustomEvent('sly:release', { detail: { reason: 'trackSwitch', keepPainted: true } }));
    expect(store.mode).toBe('romanized');
  });

  it('any other release still resets the painted mode (the panel close → reopen fix relies on it)', () => {
    document.dispatchEvent(new CustomEvent('sly:release'));
    expect(store.mode).toBe('original');
  });
});

describe('slyResetPlayerState after Pipeline B painted the new song', () => {
  it('keeps the new song\'s painted rows and leaves the song being left as it is (it is still sliding out)', () => {
    const old = paintedPanel(OLD_URI, 'old');
    const now = paintedPanel(NEW_URI, 'new');
    const releases: unknown[] = [];
    const onRelease = (e: Event) => releases.push((e as CustomEvent).detail);
    document.addEventListener('sly:release', onRelease);
    w.slyResetPlayerState('New Invented Song', NEW_URI);
    document.removeEventListener('sly:release', onRelease);

    expect(painted(now)).toBe(3);
    expect(now.querySelector('[data-sly-original]')).not.toBeNull();
    expect(painted(old)).toBe(3);
    expect(releases).toEqual([{ reason: 'trackSwitch', keepPainted: true }]);
    expect(store.mode).toBe('romanized');
  });

  it('when the reset comes first (nothing painted for the new song yet), the mode is released; the old panel keeps its paint', () => {
    store.songKey = 'Now playing: Previous Invented Song by Invented Artist';
    store.lyricsAppliedForKey = store.songKey;
    store.trackId = '0000000000000000000Old';
    const old = paintedPanel(OLD_URI, 'old');
    w.slyResetPlayerState('New Invented Song', NEW_URI);
    expect(painted(old)).toBe(3);
    expect(store.mode).toBe('original');
  });

  it('untagged rows and an unpainted panel of the new song are cleaned as before', () => {
    store.lyricsAppliedForKey = '';
    const untagged = paintedPanel(null, 'unknown');
    const stale = paintedPanel(NEW_URI, 'stale');
    w.slyResetPlayerState('New Invented Song', NEW_URI);
    expect(painted(untagged)).toBe(0);
    expect(untagged.querySelector('[data-sly-original]')).toBeNull();
    expect(painted(stale)).toBe(0);
  });

  it('an ad starting leaves the song being left painted; untagged rows are cleaned', () => {
    const old = paintedPanel(OLD_URI, 'old');
    const untagged = paintedPanel(null, 'unknown');
    w.slyResetPlayerState('AD_SILENCED', 'ad');
    expect(painted(old)).toBe(3);
    expect(painted(untagged)).toBe(0);
  });
});

describe('panels handed to another song', () => {
  beforeAll(() => watchPanelSongChanges());

  it('a panel whose tag changes to another track is cleaned (its paint and markers were the previous song\'s)', async () => {
    const list = paintedPanel(OLD_URI, 'old');
    list.setAttribute('data-sly-track-uri', NEW_URI);
    await new Promise(r => setTimeout(r, 0));
    expect(painted(list)).toBe(0);
    expect(list.querySelector('[data-sly-original]')).toBeNull();
    expect(list.textContent).toContain('old original 0');
  });

  it('first tagging (none → a track) or losing the tag leaves the paint alone', async () => {
    const list = paintedPanel(null, 'fresh');
    list.setAttribute('data-sly-track-uri', NEW_URI);
    await new Promise(r => setTimeout(r, 0));
    expect(painted(list)).toBe(3);
    list.removeAttribute('data-sly-track-uri');
    await new Promise(r => setTimeout(r, 0));
    expect(painted(list)).toBe(3);
  });

  it('purgeSlyDOM without options still cleans everything (mode switch to Original)', () => {
    const old = paintedPanel(OLD_URI, 'old');
    const now = paintedPanel(NEW_URI, 'new');
    purgeSlyDOM();
    expect(painted(old) + painted(now)).toBe(0);
  });
});

describe('the song after an ad keeps its slide (live 2026-11-08: marked leaving, unprocessed for 1.5 s)', () => {
  // The expanded view with one song slide (as in p1-L1-F-songTransition).
  const oneSlideView = (uri: string | null) => `<div data-testid="root"><div><div class="overlay">
    <div class="header"><button role="radio" value="lyrics" aria-checked="true"></button></div>
    <div class="content"><div class="slides"><div class="slide" style="transform: translateX(0%)">
      <div class="panel" style="--lyrics-color-active: #fff"><div class="list"${uri ? ` data-sly-track-uri="${uri}"` : ''}>
        <div data-testid="lyrics-line"><div>Invented line</div></div></div></div></div></div></div>
  </div></div></div>`;
  const marked = () => document.querySelector('[data-sly-leaving]');

  beforeEach(() => {
    resetSongTransition();
    document.documentElement.removeAttribute('data-sly-playing-uri');
    w.slyInternalState.lastTitle = 'Previous Invented Song';
    w.slyInternalState.lastUri = OLD_URI;
  });

  it('an ad seen moments ago: the reset for the next song marks nothing', () => {
    document.body.innerHTML = oneSlideView(null);
    w.slyInternalState.lastAdSeenAt = Date.now() - 600;
    w.slyInternalState.lastTitle = 'AD_SILENCED';
    w.slyResetPlayerState('New Invented Song', NEW_URI);
    expect(marked()).toBeNull();
  });

  it('an ad starting still lets the song before it leave with its slide', () => {
    document.body.innerHTML = oneSlideView(OLD_URI);
    w.slyInternalState.lastAdSeenAt = Date.now();
    w.slyResetPlayerState('AD_SILENCED', 'ad');
    expect(marked()).not.toBeNull();
  });

  it('no ad recently: an ordinary track switch marks the song being left, as before', () => {
    document.body.innerHTML = oneSlideView(OLD_URI);
    w.slyInternalState.lastAdSeenAt = Date.now() - 60_000;
    w.slyResetPlayerState('New Invented Song', NEW_URI);
    expect(marked()).not.toBeNull();
  });
});
