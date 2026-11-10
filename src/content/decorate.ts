// Draws processed lines into Spotify's lyrics view without touching React's nodes:
// attributes on each line element + the stylesheet below.
//
// A Spotify lyrics line is one block holding one text block. A decorated line becomes a
// column of three slots: Spotify's own text, our ::before, our ::after. Spotify's text is
// the original line (or, for a restored song, Spotify's romanization); ::before holds the
// other of the two; ::after holds the translation. Flex `order` puts the main line first,
// then whatever is shown beneath in one fixed order: original, romanization, translation.
import type { Settings } from '../shared/types';
import type { LineInfo } from './lineStore';

export const LINE_SELECTOR = '[data-testid="lyrics-line"]';
const L = LINE_SELECTOR;

export const STYLE = `
${L}[data-sk-big] { display: flex !important; flex-direction: column; }
${L}[data-sk-big] > * { order: 1; }
${L}[data-sk-a]::before { content: attr(data-sk-a); order: 2; }
${L}[data-sk-b]::after { content: attr(data-sk-b); order: 3; }
${L}[data-sk-alias] > * { order: 2; }
${L}[data-sk-alias][data-sk-a]::before { order: 1; }
${L}[data-sk-a]::before, ${L}[data-sk-b]::after { display: block; white-space: pre-line; unicode-bidi: plaintext; }
${L}[data-sk-hide] > * { display: none !important; }
/* The main line first, at Spotify's size. */
${L}[data-sk-big="a"]::before, ${L}[data-sk-big="b"]::after, ${L}[data-sk-big="c"] > * { order: 0; }
/* Lines beneath: smaller and quieter. */
${L}[data-sk-big]:not([data-sk-big="c"]) > *,
${L}[data-sk-big]:not([data-sk-big="a"])::before,
${L}[data-sk-big]:not([data-sk-big="b"])::after {
  font-size: 0.56em !important;
  line-height: 1.4;
  font-weight: 600;
  opacity: 0.72;
  margin-top: 0.15em;
}
/* The translation beneath reads differently from the lines in the song's own words. */
${L}[data-sk-big]:not([data-sk-big="b"])::after { font-weight: 400; opacity: 0.8; margin-top: 0.35em; }
/* Spotify's small lyrics card (sidebar) and narrow views: the main line only. A line we don't
   decorate keeps its own text: it has no slots to choose between. */
${L}[data-sk-compact][data-sk-big]:not([data-sk-big="c"]) > *,
${L}[data-sk-compact][data-sk-big]:not([data-sk-big="a"])::before,
${L}[data-sk-compact][data-sk-big]:not([data-sk-big="b"])::after { display: none !important; }
${L}[data-sk-dir="ltr"] { direction: ltr; text-align: start; }
/* The browser's own scroll anchoring holds the top visible line when ours change height; the
   line that must hold still is the one being sung (see holdLine in view.ts). */
${L} { overflow-anchor: none; }
`;

export interface Decoration {
  /** ::before: the romanization (the original script, on a restored song's line). */
  a: string | null;
  /** ::after: the translation. */
  b: string | null;
  /** Which slot is the main line: a, b, or c (Spotify's own text). null: not decorated. */
  big: 'a' | 'b' | 'c' | null;
  /** Spotify's own text is not shown. */
  hide: boolean;
  /** Spotify's own text is its romanization of a song we restored (a then holds the original). */
  alias: boolean;
  dir: 'ltr' | null;
}

export const NONE: Decoration = { a: null, b: null, big: null, hide: false, alias: false, dir: null };

// Hebrew, Arabic, Syriac, Thaana, NKo (U+0590-08FF) and the Hebrew/Arabic presentation forms.
// Escapes on purpose: a literal U+FB1D was once rewritten as two characters, which stretched the
// class over every script up to U+FDFF.
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * What a line should show under these settings. Pure. Two lines (the main line, the original
 * beneath; Original mode is Spotify as it is), or all three in every mode. `aliased`: Spotify's text on screen
 * is its romanization of `original` (a restored song). In translated mode, a line whose
 * translation hasn't arrived (or can't be had) shows as in romanized mode, never bare.
 */
export function decoration(original: string, info: LineInfo | undefined, s: Settings, aliased = false): Decoration {
  // No words (an instrumental "♪"): nothing to romanize or translate. Left as Spotify draws it.
  if (!/\p{L}/u.test(original)) return NONE;
  const differs = (x: string | null | undefined) => (x && x !== original ? x : null);
  const rom = differs(info?.romanized);
  const tr = differs(info?.translated?.[s.targetLang]);
  const big: 'O' | 'R' | 'T' =
    s.mode === 'translated' ? (tr ? 'T' : rom ? 'R' : 'O') : s.mode === 'romanized' && rom ? 'R' : 'O';
  // The original is always on screen: as the main line, or beneath it. Romanization and
  // translation join it beneath only when all three lines are on.
  const showO = true;
  // A translation equal to the romanization (a name, a number, a vocalise) is shown once: as the
  // main line when it is the main line, otherwise not beneath the romanization again.
  const same = !!tr && tr === rom;
  const showR = !!rom && (big === 'R' || (s.allLines && !(big === 'T' && same)));
  const showT = !!tr && (big === 'T' || (s.allLines && !same));
  const bigText = big === 'R' ? rom! : big === 'T' ? tr! : original;
  const dir = RTL.test(original) && !RTL.test(bigText) ? 'ltr' : null;
  const b = showT ? tr : null;
  if (!aliased) {
    if (big === 'O' && !showR && !showT) return NONE;
    return { a: showR ? rom : null, b, big: big === 'O' ? 'c' : big === 'R' ? 'a' : 'b', hide: !showO, alias: false, dir };
  }
  // Spotify's text is the romanization; the original script goes in ::before.
  if (big === 'R' && !showO && !showT) return NONE;
  return { a: showO ? original : null, b, big: big === 'O' ? 'a' : big === 'R' ? 'c' : 'b', hide: !showR, alias: true, dir };
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

/** Whether the line already shows this decoration (nothing to write, nothing moves). */
export function shows(el: Element, d: Decoration): boolean {
  const on = !!d.big;
  return (
    el.getAttribute('data-sk-a') === d.a &&
    el.getAttribute('data-sk-b') === d.b &&
    el.getAttribute('data-sk-big') === d.big &&
    el.hasAttribute('data-sk-hide') === (d.hide && on) &&
    el.hasAttribute('data-sk-alias') === (d.alias && on) &&
    el.getAttribute('data-sk-dir') === (on ? d.dir : null)
  );
}

export function apply(el: Element, d: Decoration) {
  setAttr(el, 'data-sk-a', d.a);
  setAttr(el, 'data-sk-b', d.b);
  setAttr(el, 'data-sk-big', d.big);
  setAttr(el, 'data-sk-hide', d.hide && d.big ? '' : null);
  setAttr(el, 'data-sk-alias', d.alias && d.big ? '' : null);
  setAttr(el, 'data-sk-dir', d.big ? d.dir : null);
}

const ATTRS = ['data-sk-a', 'data-sk-b', 'data-sk-big', 'data-sk-hide', 'data-sk-alias', 'data-sk-dir', 'data-sk-compact'];

export function clear(root: ParentNode = document) {
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    for (const a of ATTRS) el.removeAttribute(a);
  }
}
