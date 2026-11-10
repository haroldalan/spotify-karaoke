// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LineStore, MAX_SONGS } from '../../src/content/lineStore';
import { View, currentLine } from '../../src/content/view';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';
import { readEl } from '../helpers/lines';

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

/** One <div> list per song panel, as Spotify mounts them. */
function lyricsDom(...lists: string[][]) {
  document.body.innerHTML = lists
    .map((lines) => `<div class="list">${lines.map((l) => `<div data-testid="lyrics-line"><div>${l}</div></div>`).join('')}</div>`)
    .join('');
  return [...document.querySelectorAll('.list')].map((list) => [...list.querySelectorAll('[data-testid="lyrics-line"]')] as HTMLElement[]);
}

/** A processor that romanizes by script: Han as "zh(...)" without kana, "ja(...)" with. */
function setup(s: Partial<Settings>) {
  const settings = { ...DEFAULT_SETTINGS, ...s };
  const store = new LineStore(async (req) => {
    const japanese = req.language === 'ja' || req.lines.some((l) => /[぀-ヿ]/.test(l));
    return {
      script: japanese ? 'Jpan' : 'Hani',
      romanized: req.romanize ? req.lines.map((l) => (/[^\x00-\x7f]/.test(l) ? `${japanese ? 'ja' : 'zh'}(${l})` : null)) : null,
      translated: req.translateTo ? req.lines.map((l) => `tr(${l})`) : null,
    };
  }, settings);
  const view = new View(store, settings);
  return { store, view, settings };
}

describe('View', () => {
  it('decorates each list from its own song', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(['永遠', 'さよなら'], 'ja');
    store.addSong(['永遠', '我爱你'], 'zh');
    await flush();
    const [ja, zh] = lyricsDom(['永遠', 'さよなら'], ['永遠', '我爱你']);
    view.pass();
    expect(readEl(ja[0])).toEqual({ main: 'ja(永遠)', beneath: ['永遠'] });
    expect(readEl(zh[0]).main).toBe('zh(永遠)');
  });

  it('reads a list it has never seen off the screen', async () => {
    const { view } = setup({ mode: 'romanized' });
    const [list] = lyricsDom(['我爱你', 'oh yeah']);
    view.pass();
    await flush();
    view.pass();
    expect(readEl(list[0]).main).toBe('zh(我爱你)');
    expect(list[1].dataset.skBig).toBeUndefined();
  });

  it('shows the restored script for romanized lines Spotify drew before restoration finished', async () => {
    const { store, view } = setup({ mode: 'original' });
    const [list] = lyricsDom(['tera hai', 'dil mera']);
    store.addRestored(['tera hai', 'dil mera'], ['तेरा है', 'दिल मेरा'], 'hi');
    await flush();
    view.pass();
    expect(readEl(list[0])).toEqual({ main: 'तेरा है', beneath: [] });
  });

  it('switches lines already on screen to a restored copy that came late', async () => {
    const { store, view } = setup({ mode: 'original' });
    store.addSong(['tera hai', 'dil mera'], 'hi'); // Spotify's romanized lines, drawn as they are
    await flush();
    const [list] = lyricsDom(['tera hai', 'dil mera']);
    view.pass();
    expect(list[0].dataset.skBig).toBeUndefined();
    store.addRestored(['tera hai', 'dil mera'], ['तेरा है', 'दिल मेरा'], 'hi');
    await flush();
    view.pass();
    expect(readEl(list[0])).toEqual({ main: 'तेरा है', beneath: [] });
    expect(readEl(list[1]).main).toBe('दिल मेरा');
  });

  it('reads a song it has never seen off the screen even when it shares a stray line with a known song', async () => {
    // After an extension update the new copy knows only the song it found on screen; the next
    // song (fetched before the update) reaches it through the DOM alone.
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(['我爱你', '♪', '永远', 'Oh yeah'], 'zh');
    await flush();
    const [next] = lyricsDom(['さよなら', '♪', 'ありがとう', 'Oh yeah', 'またね']);
    view.pass();
    await flush();
    view.pass();
    expect(readEl(next[0]).main).toBe('ja(さよなら)');
    expect(readEl(next[4]).main).toBe('ja(またね)');
  });

  it('never lends a restored line to another song that shares a romanized line', async () => {
    const { store, view } = setup({ mode: 'original' });
    store.addRestored(['tera hai', 'dil mera'], ['तेरा है', 'दिल मेरा'], 'hi');
    store.addSong(['tera hai', 'kahin aur', 'kuch aur'], 'hi'); // another romanized Hindi song
    await flush();
    const [other] = lyricsDom(['tera hai', 'kahin aur', 'kuch aur']);
    view.pass();
    expect(other[0].dataset.skBig).toBeUndefined();
  });

  it('re-decorates a line element React reuses for another line', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(['我爱你', '永远'], 'zh');
    await flush();
    const [[a]] = lyricsDom(['我爱你', '永远']);
    view.pass();
    a.firstElementChild!.textContent = '永远';
    view.pass();
    expect(readEl(a).main).toBe('zh(永远)');
  });

  it('reports the visible list\'s song, for the loading indicator', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    const shown = store.addSong(['我爱你'], 'zh');
    store.addSong(['さよなら'], 'ja');
    await flush();
    const [visible, hidden] = lyricsDom(['我爱你'], ['さよなら']);
    // happy-dom has no layout: mark which panel is on screen.
    Object.defineProperty(visible[0], 'offsetParent', { get: () => document.body });
    Object.defineProperty(hidden[0], 'offsetParent', { get: () => null });
    let seen: unknown;
    view.onUpdate((s) => (seen = s.song));
    view.pass();
    expect(seen).toBe(shown);
  });
});

describe('LineStore', () => {
  it('forgets the least recently used songs, keeping the ones on screen', async () => {
    const { store } = setup({ mode: 'romanized' });
    const first = store.addSong(['first song line'], null);
    for (let i = 0; i < MAX_SONGS - 1; i++) store.addSong([`song ${i}`], null);
    store.touch(first);
    store.addSong(['one more'], null);
    expect(store.size).toBe(MAX_SONGS);
    expect(store.songFor(['first song line'])).toBe(first);
    expect(store.songFor(['song 0'])).toBeNull();
  });

  it('tracks loading per song', async () => {
    let release!: () => void;
    const store = new LineStore(() => new Promise((r) => { release = () => r({ script: 'Hani', romanized: ['x'], translated: null }); }), { ...DEFAULT_SETTINGS, mode: 'romanized' });
    const a = store.addSong(['我'], 'zh');
    expect(store.status(a).pending).toBe(true);
    expect(store.status(null).pending).toBe(false);
    release();
    await flush();
    expect(store.status(a).pending).toBe(false);
  });
});

/**
 * A lyrics list in a scrolling box with a stand-in layout: 40 px per line, 80 px when
 * decorated (two lines of text). Classes as Spotify sets them: past, current, coming.
 */
function scrollingLyrics(texts: string[], states: string[], scrollTop: number) {
  document.body.innerHTML = `<div id="box" style="overflow-y: scroll"><div class="list">${texts
    .map((t, i) => `<div data-testid="lyrics-line" class="line ${states[i]}"><div>${t}</div></div>`)
    .join('')}</div></div>`;
  const box = document.getElementById('box')!;
  const lines = [...document.querySelectorAll('[data-testid="lyrics-line"]')] as HTMLElement[];
  const state = { scrollTop };
  const height = (el: Element) => (el.hasAttribute('data-sk-big') ? 80 : 40);
  Object.defineProperty(box, 'scrollTop', { get: () => state.scrollTop, set: (v: number) => { state.scrollTop = v; } });
  Object.defineProperty(box, 'clientHeight', { value: 200 });
  Object.defineProperty(box, 'scrollHeight', { value: 2000 });
  box.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 500, width: 500, height: 200 }) as DOMRect;
  lines.forEach((el, i) => {
    Object.defineProperty(el, 'offsetParent', { value: box });
    el.getBoundingClientRect = () => {
      const top = lines.slice(0, i).reduce((n, x) => n + height(x), 0) - state.scrollTop;
      return { top, bottom: top + height(el), left: 0, right: 500, width: 500, height: height(el) } as DOMRect;
    };
  });
  return { box, lines, state };
}

describe('the line being sung holds still', () => {
  const zh = ['我爱你', '永远', '再见', '你好', '谢谢', '朋友', '明天'];

  it('finds the line Spotify highlights: the last one before the lines still to come', () => {
    const { lines } = scrollingLyrics(zh, ['past', 'past', 'now', 'coming', 'coming', 'coming', 'coming'], 0);
    expect(currentLine(lines)).toBe(lines[2]);
    // Nothing sung yet, or lyrics that aren't synced: every line looks the same.
    expect(currentLine(scrollingLyrics(zh, zh.map(() => 'coming'), 0).lines)).toBeNull();
    // A wordless last line (♪) has a class of its own: it is not the run of coming lines.
    const withNote = scrollingLyrics([...zh, '♪'], ['past', 'now', 'coming', 'coming', 'coming', 'coming', 'coming', 'note'], 0);
    expect(currentLine(withNote.lines)).toBe(withNote.lines[1]);
  });

  it('scrolls by however far the highlighted line moved when the mode changes line heights', async () => {
    const { store, view, settings } = setup({ mode: 'original' });
    store.addSong(zh, 'zh');
    await flush();
    const { lines, state } = scrollingLyrics(zh, ['past', 'past', 'now', 'coming', 'coming', 'coming', 'coming'], 40);
    view.pass();
    const top = lines[2].getBoundingClientRect().top;
    expect(top).toBe(40);
    // Original -> Romanized: the two lines above it double in height.
    const romanized = { ...settings, mode: 'romanized' as const };
    store.setSettings(romanized);
    await flush();
    view.setSettings(romanized);
    view.pass();
    expect(lines[0].dataset.skBig).toBe('a');
    expect(lines[2].getBoundingClientRect().top).toBe(top);
    expect(state.scrollTop).toBe(120);
    // And back: they shrink again.
    view.setSettings(settings);
    view.pass();
    expect(lines[0].dataset.skBig).toBeUndefined();
    expect(lines[2].getBoundingClientRect().top).toBe(top);
    expect(state.scrollTop).toBe(40);
    // A pass that changes nothing never touches the scroll position.
    state.scrollTop = 55;
    view.pass();
    expect(state.scrollTop).toBe(55);
  });

  it('never scrolls for elements new to it: Spotify replaces a line when it becomes current, and scrolls to it itself', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(zh, 'zh');
    await flush();
    const { lines, state } = scrollingLyrics(zh, ['past', 'past', 'now', 'coming', 'coming', 'coming', 'coming'], 40);
    view.pass(); // first sight of every element: decorated, heights change, no scroll of ours
    expect(lines[0].dataset.skBig).toBe('a');
    expect(state.scrollTop).toBe(40);
    // Spotify re-renders two lines as new, undecorated elements (the one just sung, the one sung now).
    for (const i of [1, 2]) {
      lines[i].removeAttribute('data-sk-big');
      lines[i].removeAttribute('data-sk-a');
    }
    const fresh = new WeakSet([lines[1], lines[2]]);
    // Stand-in for "new elements": a second view has never seen any of them.
    const second = new View(store, { ...DEFAULT_SETTINGS, mode: 'romanized' });
    second.pass();
    expect(fresh.has(lines[1]) && lines[1].dataset.skBig).toBe('a');
    expect(state.scrollTop).toBe(40);
  });

  it('counts only lyrics on screen: a faded-out panel left under Spotify\'s "no lyrics" message is not the lyrics view', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(zh, 'zh');
    await flush();
    const { lines } = scrollingLyrics(zh, zh.map(() => 'coming'), 0);
    let state: { lineCount: number; song: unknown } = { lineCount: -1, song: null };
    view.onUpdate((s) => { state = s; });
    view.pass();
    expect(state.lineCount).toBe(zh.length);
    expect(state.song).not.toBeNull();
    // Spotify fades the panel out (opacity 0 on an ancestor) and leaves it mounted.
    for (const el of lines) (el as unknown as { checkVisibility: () => boolean }).checkVisibility = () => false;
    view.pass();
    expect(state.lineCount).toBe(0);
    expect(state.song).toBeNull();
    // Still decorated: if the panel fades back in, it is right at once.
    expect(lines[0].dataset.skBig).toBe('a');
  });

  it('holds what the listener is reading when the highlighted line is out of view', async () => {
    const { store, view, settings } = setup({ mode: 'original' });
    store.addSong(zh, 'zh');
    await flush();
    // The listener scrolled back to the top; the song is at its last lines, below the box.
    const { lines, state } = scrollingLyrics(zh, ['past', 'past', 'past', 'past', 'past', 'past', 'now'], 0);
    view.pass();
    const romanized = { ...settings, mode: 'romanized' as const };
    store.setSettings(romanized);
    await flush();
    view.setSettings(romanized);
    view.pass();
    expect(lines[0].getBoundingClientRect().top).toBe(0);
    expect(state.scrollTop).toBe(0);
  });
});
