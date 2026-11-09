// Draws processed lines into Spotify's lyrics view without touching React's nodes:
// attributes on each line element + the stylesheet below.
import type { Settings } from '../shared/types';
import type { LineInfo } from './lineStore';

export const LINE_SELECTOR = '[data-testid="lyrics-line"]';

export const STYLE = `
${LINE_SELECTOR}[data-sk-main] > * { display: none !important; }
${LINE_SELECTOR}[data-sk-main]::before {
  content: attr(data-sk-main);
  display: block;
  unicode-bidi: plaintext;
}
${LINE_SELECTOR}[data-sk-sub]::after {
  content: attr(data-sk-sub);
  display: block;
  white-space: pre-line;
  unicode-bidi: plaintext;
  font-size: 0.56em;
  line-height: 1.4;
  font-weight: 600;
  opacity: 0.72;
  margin-top: 0.15em;
  margin-bottom: 0.1em;
}
/* Spotify's small lyrics preview card (sidebar): the main line only, nothing beneath. */
${LINE_SELECTOR}[data-sk-compact][data-sk-sub]::after { display: none; }
${LINE_SELECTOR}[data-sk-dir="ltr"] { direction: ltr; text-align: start; }
`;

export interface Decoration {
  main: string | null;
  sub: string | null;
  dir: 'ltr' | null;
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/** What a line with this text should show under these settings. Pure. */
export function decoration(original: string, info: LineInfo | undefined, s: Settings): Decoration {
  const rom = info?.romanized ?? null;
  const tr = info?.translated?.[s.targetLang] ?? null;
  let main: string | null = null;
  if (s.mode === 'romanized') main = rom;
  else if (s.mode === 'translated') main = tr;
  if (main === original) main = null;

  const subs: string[] = [];
  const add = (x: string | null) => {
    if (x && x !== original && x !== main && !subs.includes(x)) subs.push(x);
  };
  if (main) {
    if (s.showOriginal) subs.push(original);
    if (s.showRomanized && s.mode !== 'romanized') add(rom);
    if (s.showTranslation && s.mode !== 'translated') add(tr);
  } else {
    if (s.showRomanized || s.mode === 'romanized') add(rom);
    if (s.showTranslation) add(tr);
  }
  const sub = subs.length ? subs.join('\n') : null;
  const dir = main && RTL.test(original) && !RTL.test(main) ? 'ltr' : null;
  return { main, sub, dir };
}

function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** The line's own text (our ::before/::after content is not part of textContent). */
export function lineText(el: Element): string {
  return (el.textContent ?? '').trim();
}

export function apply(el: Element, d: Decoration) {
  setAttr(el, 'data-sk-main', d.main);
  setAttr(el, 'data-sk-sub', d.sub);
  setAttr(el, 'data-sk-dir', d.dir);
}

export function clear(root: ParentNode = document) {
  for (const el of root.querySelectorAll('[data-sk-main],[data-sk-sub],[data-sk-dir],[data-sk-compact]')) {
    for (const a of ['data-sk-main', 'data-sk-sub', 'data-sk-dir', 'data-sk-compact']) el.removeAttribute(a);
  }
}
