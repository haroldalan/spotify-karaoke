// Keeps every lyrics line on the page decorated. Event-driven: a MutationObserver
// schedules one pass per animation frame; a pass is cheap and idempotent.
//
// Lines are handled per list (their parent element, one per song panel): each list is
// matched to the song it shares the most lines with, and decorated from that song only.
import type { Settings } from '../shared/types';
import { LINE_SELECTOR, apply, decoration, lineText, clear, type Decoration } from './decorate';
import type { LineStore, Song } from './lineStore';

export interface ViewState {
  /** Lines of lyrics currently in the document. */
  lineCount: number;
  /** The lyrics view's box, for placing the mode switcher. */
  rect: DOMRect | null;
  /** The song of the visible lyrics list, when known. */
  song: Song | null;
}

const NONE: Decoration = { main: null, sub: null, dir: null };

export class View {
  private scheduled = false;
  private observer: MutationObserver;
  private settings: Settings;
  private listeners = new Set<(s: ViewState) => void>();

  constructor(private store: LineStore, settings: Settings) {
    this.settings = settings;
    this.observer = new MutationObserver((records) => {
      // Our own attribute writes trigger nothing (attributes aren't observed).
      for (const r of records) {
        if (r.type === 'characterData' || r.addedNodes.length) return this.schedule();
      }
    });
    store.onChange(() => this.schedule());
  }

  start() {
    this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    this.schedule();
  }

  onUpdate(fn: (s: ViewState) => void) {
    this.listeners.add(fn);
  }

  setSettings(s: Settings) {
    this.settings = s;
    this.schedule();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.pass();
    });
  }

  /** One decoration pass over every lyrics list in the document. Exposed for tests. */
  pass() {
    const lines = [...document.querySelectorAll(LINE_SELECTOR)];
    const lists = new Map<Element | null, Element[]>();
    for (const el of lines) {
      const list = el.parentElement;
      if (!lists.has(list)) lists.set(list, []);
      lists.get(list)!.push(el);
    }
    let visibleSong: Song | null = null;
    let visibleLine: Element | null = null;
    for (const els of lists.values()) {
      const texts = els.map(lineText);
      let song = this.store.songFor(texts);
      // Never seen through the network: read the whole list off the screen.
      if (!song && texts.some((t) => t)) song = this.store.addSong(texts);
      const visible = els.find((el) => (el as HTMLElement).offsetParent !== null);
      if (song && visible) {
        this.store.touch(song);
        visibleSong = song;
        visibleLine = visible;
      }
      els.forEach((el, i) => {
        const r = song ? this.store.resolve(song, texts[i]) : null;
        if (!r) return apply(el, NONE);
        const d = decoration(r.original, r.info, this.settings);
        // Restored by us after Spotify drew its romanized line: the original script is the main line.
        if (r.aliased && !d.main) d.main = r.original;
        apply(el, d);
      });
    }
    const rect = visibleLine ? scrollBox(visibleLine)?.getBoundingClientRect() ?? null : null;
    for (const fn of this.listeners) fn({ lineCount: lines.length, rect, song: visibleSong });
  }

  stop() {
    this.observer.disconnect();
    clear();
  }
}

/** Nearest scrolling ancestor: the lyrics view's visible box. */
function scrollBox(el: Element): Element | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.clientHeight > 0) return p;
  }
  return el.parentElement;
}
