// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LineStore, MAX_SONGS } from '../../src/content/lineStore';
import { View } from '../../src/content/view';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';

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
    expect(ja[0].dataset.skMain).toBe('ja(永遠)');
    expect(zh[0].dataset.skMain).toBe('zh(永遠)');
    expect(ja[0].dataset.skSub).toBe('永遠');
  });

  it('reads a list it has never seen off the screen', async () => {
    const { view } = setup({ mode: 'romanized' });
    const [list] = lyricsDom(['我爱你', 'oh yeah']);
    view.pass();
    await flush();
    view.pass();
    expect(list[0].dataset.skMain).toBe('zh(我爱你)');
    expect(list[1].dataset.skMain).toBeUndefined();
  });

  it('shows the restored script for romanized lines Spotify drew before restoration finished', async () => {
    const { store, view } = setup({ mode: 'original' });
    const [list] = lyricsDom(['tera hai', 'dil mera']);
    store.addRestored(['tera hai', 'dil mera'], ['तेरा है', 'दिल मेरा'], 'hi');
    await flush();
    view.pass();
    expect(list[0].dataset.skMain).toBe('तेरा है');
  });

  it('never lends a restored line to another song that shares a romanized line', async () => {
    const { store, view } = setup({ mode: 'original' });
    store.addRestored(['tera hai', 'dil mera'], ['तेरा है', 'दिल मेरा'], 'hi');
    store.addSong(['tera hai', 'kahin aur', 'kuch aur'], 'hi'); // another romanized Hindi song
    await flush();
    const [other] = lyricsDom(['tera hai', 'kahin aur', 'kuch aur']);
    view.pass();
    expect(other[0].dataset.skMain).toBeUndefined();
  });

  it('re-decorates a line element React reuses for another line', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(['我爱你', '永远'], 'zh');
    await flush();
    const [[a]] = lyricsDom(['我爱你', '永远']);
    view.pass();
    a.firstElementChild!.textContent = '永远';
    view.pass();
    expect(a.dataset.skMain).toBe('zh(永远)');
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
