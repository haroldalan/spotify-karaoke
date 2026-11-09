// Keeps every lyrics line in a document decorated. Event-driven: a MutationObserver
// schedules one pass per animation frame; a pass is cheap and idempotent.
//
// Lines are handled per list (their parent element, one per song panel): each list is
// matched to the song it shares the most lines with, and decorated from that song only.
import type { Settings } from '../shared/types';
import { LINE_SELECTOR, apply, decoration, lineText, clear, type Decoration } from './decorate';
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
  /** Lines of lyrics currently in the document. */
  lineCount: number;
  /** The full lyrics view's switcher spot, when one is on screen. */
  anchor: Anchor | null;
  /** The song of the visible lyrics list, when known. */
  song: Song | null;
}

const NONE: Decoration = { main: null, sub: null, dir: null };
/** Lists in boxes narrower than this are previews (the sidebar's lyrics card): no lines beneath. */
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
    store.onChange(() => this.schedule());
  }

  start() {
    this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-checked'] });
    (this.doc.defaultView ?? window).addEventListener('resize', this.onResize);
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
    if (this.scheduled) return;
    this.scheduled = true;
    (this.doc.defaultView ?? window).requestAnimationFrame(() => {
      this.scheduled = false;
      this.pass();
    });
  }

  /** One decoration pass over every lyrics list in the document. Exposed for tests. */
  pass() {
    const lines = [...this.doc.querySelectorAll(LINE_SELECTOR)];
    const lists = new Map<Element | null, Element[]>();
    for (const el of lines) {
      const list = el.parentElement;
      if (!lists.has(list)) lists.set(list, []);
      lists.get(list)!.push(el);
    }
    // The visible list in the largest box is the one the listener is reading.
    let main: { song: Song; line: Element; area: number } | null = null;
    for (const els of lists.values()) {
      const texts = els.map(lineText);
      let song = this.store.songFor(texts);
      // Never seen through the network: read the whole list off the screen.
      if (!song && texts.some((t) => t)) song = this.store.addSong(texts);
      const visible = els.find((el) => (el as HTMLElement).offsetParent !== null);
      const box = visible ? scrollBox(visible) : null;
      const rect = box?.getBoundingClientRect();
      const compact = !!rect && rect.width > 0 && rect.width < COMPACT_WIDTH;
      if (song && visible) {
        this.store.touch(song);
        const area = rect ? rect.width * rect.height : 0;
        if (!main || area > main.area) main = { song, line: visible, area };
      }
      els.forEach((el, i) => {
        if (compact) el.setAttribute('data-sk-compact', '');
        else el.removeAttribute('data-sk-compact');
        const r = song ? this.store.resolve(song, texts[i]) : null;
        if (!r) return apply(el, NONE);
        const d = decoration(r.original, r.info, this.settings);
        // Restored by us after Spotify drew its romanized line: the original script is the main line.
        if (r.aliased && !d.main) d.main = r.original;
        apply(el, d);
      });
    }
    const anchor = !this.wantAnchor ? null : main ? this.anchorFor(main.line) : this.emptyViewAnchor();
    for (const fn of this.listeners) fn({ lineCount: lines.length, anchor, song: main?.song ?? null });
  }

  /**
   * The switcher's spot for the list `line` is in: 12 px under Spotify's lyrics header,
   * centred on the view. The header is the part of the view holding Spotify's media switch
   * (role=radiogroup with a value=lyrics radio); without one, the top of the lyrics box.
   */
  private anchorFor(line: Element): Anchor | null {
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
        return { top: h.bottom + ANCHOR_GAP, centerX: v.left + v.width / 2, width: boxRect.width, height: boxRect.height };
      }
    }
    return { top: boxRect.top + ANCHOR_GAP, centerX: boxRect.left + boxRect.width / 2, width: boxRect.width, height: boxRect.height };
  }

  /**
   * The spot under the header when Spotify's lyrics view is open with no lines (its "no
   * lyrics" message): the media switch says lyrics, and the header's view gives the box.
   */
  private emptyViewAnchor(): Anchor | null {
    const radio = this.doc.querySelector('[role="radiogroup"] [role="radio"][value="lyrics"][aria-checked="true"]');
    if (!radio) return null;
    let header: Element | null = radio;
    // The header is the view's child holding the switch: the first ancestor whose parent is clearly taller.
    while (header?.parentElement && header.parentElement.getBoundingClientRect().height <= header.getBoundingClientRect().height + 40) header = header.parentElement;
    const view = header?.parentElement;
    if (!header || !view) return null;
    const h = header.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    return { top: h.bottom + ANCHOR_GAP, centerX: v.left + v.width / 2, width: v.width, height: v.height };
  }

  private observe(box: Element) {
    if (!this.resizeObserver || box === this.observedBox) return;
    if (this.observedBox) this.resizeObserver.unobserve(this.observedBox);
    this.resizeObserver.observe(box);
    this.observedBox = box;
  }

  stop() {
    this.observer.disconnect();
    this.resizeObserver?.disconnect();
    (this.doc.defaultView ?? window).removeEventListener('resize', this.onResize);
    clear(this.doc);
  }
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
