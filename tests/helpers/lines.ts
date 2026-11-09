// What a decorated line reads as, top to bottom, following decorate.ts's STYLE: the main
// line, then the lines beneath (Spotify's own text and our ::before / ::after, by order).
import type { Decoration } from '../../src/content/decorate';

export interface Read { main: string; beneath: string[] }

export function read(spotifyText: string, d: Decoration): Read {
  if (!d.big) return { main: spotifyText, beneath: [] };
  const slots: { key: 'a' | 'b' | 'c'; text: string | null; order: number }[] = [
    { key: 'c', text: d.hide ? null : spotifyText, order: d.alias ? 2 : 1 },
    { key: 'a', text: d.a, order: d.alias ? 1 : 2 },
    { key: 'b', text: d.b, order: 3 },
  ];
  const main = slots.find((s) => s.key === d.big)!.text ?? '';
  const beneath = slots.filter((s) => s.key !== d.big && s.text).sort((x, y) => x.order - y.order).map((s) => s.text!);
  return { main, beneath };
}

/** The same, read off a line element's attributes. */
export function readEl(el: HTMLElement): Read {
  const ds = el.dataset;
  const d: Decoration = {
    a: ds.skA ?? null,
    b: ds.skB ?? null,
    big: (ds.skBig as Decoration['big']) ?? null,
    hide: ds.skHide !== undefined,
    alias: ds.skAlias !== undefined,
    dir: (ds.skDir as Decoration['dir']) ?? null,
  };
  return read((el.firstElementChild?.textContent ?? '').trim(), d);
}
