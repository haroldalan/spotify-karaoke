// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LineStore } from '../../src/content/lineStore';
import { View } from '../../src/content/view';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
const settle = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await frame(); } };

function lyricsDom(lines: string[]) {
  document.body.innerHTML = `<div class="list">${lines.map((l) => `<div data-testid="lyrics-line"><div>${l}</div></div>`).join('')}</div>`;
  return [...document.querySelectorAll('[data-testid="lyrics-line"]')] as HTMLElement[];
}

function setup(s: Partial<Settings>) {
  const settings = { ...DEFAULT_SETTINGS, ...s };
  const store = new LineStore(async (req) => ({
    script: 'Taml',
    romanized: req.romanize ? req.lines.map((l) => (/[஀-௿]/.test(l) ? `rom(${l})` : null)) : null,
    translated: req.translateTo ? req.lines.map((l) => `tr(${l})`) : null,
  }), settings);
  const view = new View(store, settings);
  return { store, view };
}

describe('View', () => {
  it('decorates lines by their text, whatever list they are in', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(['தங்கமே', 'oh yeah']);
    const [a, b] = lyricsDom(['தங்கமே', 'oh yeah']);
    view.start();
    await settle();
    expect(a.dataset.skMain).toBe('rom(தங்கமே)');
    expect(a.dataset.skSub).toBe('தங்கமே');
    expect(b.dataset.skMain).toBeUndefined();
    view.stop();
  });

  it('shows the restored script for romanized lines Spotify drew before restoration finished', async () => {
    const { store, view } = setup({ mode: 'original' });
    const [a] = lyricsDom(['thangamae unnatan']);
    view.start();
    await settle();
    expect(a.dataset.skMain).toBeUndefined();
    store.addAliases(['thangamae unnatan'], ['தங்கமே உன்னத்தான்']);
    store.addSong(['தங்கமே உன்னத்தான்']);
    await settle();
    expect(a.dataset.skMain).toBe('தங்கமே உன்னத்தான்');
    store.setSettings({ ...DEFAULT_SETTINGS, mode: 'romanized' });
    view.setSettings({ ...DEFAULT_SETTINGS, mode: 'romanized' });
    await settle();
    expect(a.dataset.skMain).toBe('rom(தங்கமே உன்னத்தான்)');
    expect(a.dataset.skSub).toBe('தங்கமே உன்னத்தான்');
    view.stop();
  });

  it('re-decorates a line element React reuses for another line', async () => {
    const { store, view } = setup({ mode: 'romanized' });
    store.addSong(['தங்கமே', 'வைரமே']);
    const [a] = lyricsDom(['தங்கமே']);
    view.start();
    await settle();
    a.firstElementChild!.textContent = 'வைரமே';
    await settle();
    expect(a.dataset.skMain).toBe('rom(வைரமே)');
    view.stop();
  });
});
