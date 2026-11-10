// Keeps every lyrics line in a document decorated. Event-driven: a MutationObserver
// schedules one pass per animation frame; a pass is cheap and idempotent.
//
// Lines are handled per list (their parent element, one per song panel): each list is
// matched to the song it shares the most lines with, and decorated from that song only.
import type { Settings } from '../shared/types';
import { LINE_SELECTOR, NONE, apply, decoration, lineText, clear, shows } from './decorate';
import type { LineStore, Song } from './lineStore';

/** Where the switcher goes: centred under Spotify's lyrics header (3.1.6's spot). */
export interface Anchor {
  /** Viewport y of the switcher's top edge. */
  top: number;
  /** Viewport x of the lyrics view's centre. */
  centerX: number;
  /** The lyrics view's box, to tell the full view from a small card. */
  width: number;
  height: number;
}

export interface ViewState {
  /** Lines of lyrics in the document, not counting Spotify's small lyrics card in the sidebar. */
  lineCount: number;
  /** The full lyrics view's switcher spot, when one is on screen. */
  anchor: Anchor | null;
  /**
   * The element holding the lyrics view (its header and its lines), when found: the switcher
   * goes inside it, so it is drawn and animated with the view. Spotify opens the view with a
   * view transition in which the view is a layer above the rest of the page.
   */
  container: Element | null;
  /** The song of the visible lyrics list, when known. */
  song: Song | null;
}

/** Spotify's small lyrics card in the Now Playing sidebar: a preview, never the lyrics view. */
const CARD = '[data-testid="lyrics-npv-section"]';
/** Lists in boxes narrower than this (the mini player, a very narrow window) show the main line only. */
const COMPACT_WIDTH = 420;
const ANCHOR_GAP = 12;

export class View {
  private scheduled = false;
  private observer: MutationObserver;
  private resizeObserver: ResizeObserver | null = null;
  private observedBox: Element | null = null;
  private settings: Settings;
  private listeners = new Set<(s: ViewState) => void>();
  /** Whether anyone needs the switcher's spot (only when the switcher is shown). */
  private wantAnchor = true;
  private readonly onResize = () => this.schedule();
  /** A panel finished fading in or out: which list is on screen may have changed. */
  private readonly onFade = (e: Event) => {
    const t = e.target;
    if ((e as TransitionEvent).propertyName === 'opacity' && t instanceof (this.doc.defaultView ?? window).Element && t.querySelector(LINE_SELECTOR)) this.schedule();
  };
  /** Line elements a pass has already been over. */
  private seen = new WeakSet<Element>();
  private unsubscribe: () => void;
  private stopped = false;

  constructor(private store: LineStore, settings: Settings, private doc: Document = document) {
    this.settings = settings;
    const win = doc.defaultView ?? window;
    this.observer = new win.MutationObserver((records) => {
      // Our own attribute writes trigger nothing (attributes aren't observed), except
      // Spotify's media switch, which says whether the view shows lyrics.
      for (const r of records) {
        if (r.type === 'characterData' || r.addedNodes.length || r.attributeName === 'aria-checked') return this.schedule();
      }
    });
    if (typeof win.ResizeObserver === 'function') this.resizeObserver = new win.ResizeObserver(this.onResize);
    this.unsubscribe = store.onChange(() => this.schedule());
  }

  start() {
    this.stopped = false;
    this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-checked'] });
    (this.doc.defaultView ?? window).addEventListener('resize', this.onResize);
    this.doc.addEventListener('transitionend', this.onFade, true);
    this.schedule();
  }

  onUpdate(fn: (s: ViewState) => void) {
    this.listeners.add(fn);
  }

  setWantRect(want: boolean) {
    this.wantAnchor = want;
  }

  setSettings(s: Settings) {
    this.settings = s;
    this.schedule();
  }

  schedule() {
    if (this.scheduled || this.stopped) return;
    this.scheduled = true;
    (this.doc.defaultView ?? window).requestAnimationFrame(() => {
      this.scheduled = false;
      this.pass();
    });
  }

  /** One decoration pass over every lyrics list in the document. Exposed for tests. */
  pass() {
    // A pass already scheduled when this view was stopped (a newer copy took over, the mini
    // player closed) must not run: it would decorate from a store nobody uses any more.
    if (this.stopped) return;
    const lines = [...this.doc.querySelectorAll(LINE_SELECTOR)];
    const lists = new Map<Element | null, Element[]>();
    for (const el of lines) {
      const list = el.parentElement;
      if (!lists.has(list)) lists.set(list, []);
      lists.get(list)!.push(el);
    }
    // The visible list in the largest box is the one the listener is reading. The sidebar's
    // card is never it: the switcher and O / R / T belong to the lyrics view.
    let main: { song: Song; line: Element; area: number } | null = null;
    let lineCount = 0;
    for (const els of lists.values()) {
      const inCard = !!els[0]?.closest(CARD);
      const texts = els.map(lineText);
      let song = this.store.songFor(texts);
      // Never seen through the network: read the whole list off the screen.
      if (!song && texts.some((t) => t)) song = this.store.addSong(texts);
      // On screen: laid out, and not inside a panel Spotify has faded out. It keeps the last
      // song's lyrics mounted, fully transparent, under its "no lyrics" message.
      const visible = els.find(onScreen);
      if (!inCard && visible) lineCount += els.length;
      const box = visible ? scrollBox(visible) : null;
      const rect = box?.getBoundingClientRect();
      const compact = inCard || (!!rect && rect.width > 0 && rect.width < COMPACT_WIDTH);
      if (song && visible && !inCard) {
        this.store.touch(song);
        const area = rect ? rect.width * rect.height : 0;
        if (!main || area > main.area) main = { song, line: visible, area };
      }
      const next = els.map((_, i) => {
        const r = song ? this.store.resolve(song, texts[i]) : null;
        return r ? decoration(r.original, r.info, this.settings, r.aliased) : NONE;
      });
      // Lines are about to change height (a mode switch, a translation arriving, a list we
      // decorate for the first time, e.g. the lyrics view opened mid-song after Spotify put
      // the current line in the middle): the line being sung stays where it is.
      // Not for single elements new to us in a list we know: Spotify replaces a line's element
      // when it becomes the current or a past line, and scrolls to it smoothly at that
      // moment; a scroll of ours would cut that short.
      const newList = els.every((el) => !this.seen.has(el));
      const changes = els.some((el, i) => (newList || this.seen.has(el)) && (el.hasAttribute('data-sk-compact') !== compact || !shows(el, next[i])));
      const settle = changes && box ? holdLine(els, box) : null;
      els.forEach((el, i) => {
        if (compact) el.setAttribute('data-sk-compact', '');
        else el.removeAttribute('data-sk-compact');
        apply(el, next[i]);
        this.seen.add(el);
      });
      settle?.();
    }
    const spot = !this.wantAnchor ? null : main ? this.anchorFor(main.line) : this.emptyViewAnchor();
    for (const fn of this.listeners) fn({ lineCount, anchor: spot?.anchor ?? null, container: spot?.container ?? null, song: main?.song ?? null });
  }

  /**
   * The switcher's spot for the list `line` is in: 12 px under Spotify's lyrics header,
   * centred on the view. The header is the part of the view holding Spotify's media switch
   * (role=radiogroup with a value=lyrics radio); without one, the top of the lyrics box.
   */
  private anchorFor(line: Element): { anchor: Anchor; container: Element | null } | null {
    const box = scrollBox(line);
    if (!box) return null;
    this.observe(box);
    const boxRect = box.getBoundingClientRect();
    const radio = this.doc.querySelector('[role="radiogroup"] [role="radio"][value="lyrics"]');
    if (radio) {
      // Walk up from the media switch to the child of the element that also holds the lyrics.
      let header: Element | null = radio;
      while (header?.parentElement && !header.parentElement.contains(box)) header = header.parentElement;
      const view = header?.parentElement;
      if (header && view) {
        const h = header.getBoundingClientRect();
        const v = view.getBoundingClientRect();
        return { anchor: { top: h.bottom + ANCHOR_GAP, centerX: v.left + v.width / 2, width: boxRect.width, height: boxRect.height }, container: view };
      }
    }
    return { anchor: { top: boxRect.top + ANCHOR_GAP, centerX: boxRect.left + boxRect.width / 2, width: boxRect.width, height: boxRect.height }, container: null };
  }

  /**
   * The spot under the header when Spotify's lyrics view is open with no lines (its "no
   * lyrics" message): the media switch says lyrics, and the header's view gives the box.
   */
  private emptyViewAnchor(): { anchor: Anchor; container: Element | null } | null {
    const radio = this.doc.querySelector('[role="radiogroup"] [role="radio"][value="lyrics"][aria-checked="true"]');
    if (!radio) return null;
    let header: Element | null = radio;
    // The header is the view's child holding the switch: the first ancestor whose parent is clearly taller.
    while (header?.parentElement && header.parentElement.getBoundingClientRect().height <= header.getBoundingClientRect().height + 40) header = header.parentElement;
    const view = header?.parentElement;
    if (!header || !view) return null;
    const h = header.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    return { anchor: { top: h.bottom + ANCHOR_GAP, centerX: v.left + v.width / 2, width: v.width, height: v.height }, container: view };
  }

  private observe(box: Element) {
    if (!this.resizeObserver || box === this.observedBox) return;
    if (this.observedBox) this.resizeObserver.unobserve(this.observedBox);
    this.resizeObserver.observe(box);
    this.observedBox = box;
  }

  stop() {
    this.stopped = true;
    this.unsubscribe();
    this.observer.disconnect();
    this.resizeObserver?.disconnect();
    (this.doc.defaultView ?? window).removeEventListener('resize', this.onResize);
    this.doc.removeEventListener('transitionend', this.onFade, true);
    clear(this.doc);
  }
}

/** Laid out and not transparent (itself or through an ancestor). */
function onScreen(el: Element): boolean {
  if ((el as HTMLElement).offsetParent === null) return false;
  const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  return typeof check === 'function' ? check.call(el, { opacityProperty: true, visibilityProperty: true }) : true;
}

const HAS_WORDS = /\p{L}/u;

/**
 * The line Spotify highlights: the last one before the run of lines still to come (Spotify
 * gives past, current and coming lines different classes). null when it can't be told: no
 * line sung yet, or lyrics that aren't synced.
 */
export function currentLine(els: Element[]): Element | null {
  const worded = els.filter((el) => HAS_WORDS.test(el.textContent ?? ''));
  if (worded.length < 2) return null;
  const coming = worded[worded.length - 1].className;
  let i = worded.length - 1;
  while (i >= 0 && worded[i].className === coming) i--;
  return i >= 0 ? worded[i] : null;
}

/**
 * Call before changing a list's lines; call the result after. It scrolls the box by however
 * far the line being sung moved, so that line doesn't move on screen.
 *
 * Why: Spotify follows the song only while the highlighted line is in view. Our lines change
 * height when the mode changes or a translation arrives; that used to push the highlighted
 * line out of view, and Spotify then stopped following until its Sync button was pressed
 * (found live, 2026-11-10). When the highlighted line isn't in view (the listener scrolled
 * away), the first line in view is held instead: what they are reading stays put.
 */
function holdLine(els: Element[], box: Element): (() => void) | null {
  if (box.scrollHeight <= box.clientHeight) return null;
  const view = box.getBoundingClientRect();
  const inView = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.bottom > view.top && r.top < view.bottom;
  };
  const current = currentLine(els);
  const held = current && inView(current) ? current : els.find(inView);
  if (!held) return null;
  const top = held.getBoundingClientRect().top;
  return () => {
    const moved = held.getBoundingClientRect().top - top;
    if (Math.abs(moved) >= 1) box.scrollTop += moved;
  };
}

/** Nearest scrolling ancestor: the lyrics view's visible box. */
function scrollBox(el: Element): Element | null {
  const win = el.ownerDocument.defaultView ?? window;
  for (let p = el.parentElement; p && p !== el.ownerDocument.body; p = p.parentElement) {
    const o = win.getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.clientHeight > 0) return p;
  }
  return el.parentElement;
}
