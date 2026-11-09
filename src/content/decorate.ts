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

/**
 * What a line with this text should show. Pure. One line beneath at most, chosen here:
 * - romanized: the romanization, the original beneath;
 * - translated: the translation, the romanization beneath (the original when the line has
 *   none, i.e. it is already in Latin script); until the translation arrives, or when it
 *   can't be had, the line shows as in romanized mode rather than falling back to bare text;
 * - original: nothing of ours.
 */
export function decoration(original: string, info: LineInfo | undefined, s: Settings): Decoration {
  const differs = (x: string | null | undefined) => (x && x !== original ? x : null);
  const rom = differs(info?.romanized);
  const tr = differs(info?.translated?.[s.targetLang]);
  let main: string | null = null;
  let sub: string | null = null;
  if (s.mode === 'translated' && tr) {
    main = tr;
    sub = rom && rom !== tr ? rom : original;
  } else if (s.mode !== 'original' && rom) {
    main = rom;
    sub = original;
  }
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
