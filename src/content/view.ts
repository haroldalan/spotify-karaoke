// Keeps every lyrics line on the page decorated. Event-driven: a MutationObserver
// schedules one pass per animation frame; a pass is cheap and idempotent.
import type { Settings } from '../shared/types';
import { LINE_SELECTOR, apply, decoration, lineText, clear } from './decorate';
import type { LineStore } from './lineStore';

export interface ViewState {
  /** Lines of lyrics currently in the document. */
  lineCount: number;
  /** The lyrics view's box, for placing the mode switcher. */
  rect: DOMRect | null;
}

export class View {
  private scheduled = false;
  private observer: MutationObserver;
  private settings: Settings;
  /** Lyrics lists already handed to the store from the screen, by their text. */
  private seenLists = new Set<string>();
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

  private pass() {
    const lines = document.querySelectorAll(LINE_SELECTOR);
    const unknownLists = new Map<Element, string[]>();
    for (const el of lines) {
      const shown = lineText(el);
      // Romanized by Spotify, restored by us after Spotify had drawn it: treat it as the original.
      const native = shown ? this.store.alias(shown) : undefined;
      const text = native ?? shown;
      const info = text ? this.store.get(text) : undefined;
      if (text && !info && !native && el.parentElement) {
        // Never seen through the network: read the whole list off the screen once.
        if (!unknownLists.has(el.parentElement)) unknownLists.set(el.parentElement, []);
      }
      const d = text ? decoration(text, info, this.settings) : { main: null, sub: null, dir: null };
      if (native && !d.main) d.main = native;
      apply(el, d);
    }
    for (const list of unknownLists.keys()) {
      const texts = [...list.querySelectorAll(LINE_SELECTOR)].map(lineText);
      const sig = texts.join('\n');
      if (this.seenLists.has(sig)) continue;
      this.seenLists.add(sig);
      this.store.addSong(texts);
    }
    let rect: DOMRect | null = null;
    const visible = [...lines].find((l) => (l as HTMLElement).offsetParent !== null);
    if (visible) rect = scrollBox(visible)?.getBoundingClientRect() ?? null;
    for (const fn of this.listeners) fn({ lineCount: lines.length, rect });
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
