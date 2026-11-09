// The on-page controls, in their own shadow root on <body>, outside React's tree:
// - the mode switcher (Original / Romanized / Translated), pinned to the lyrics view's
//   bottom-right corner while lyrics are on screen;
// - a notice ("No lyrics found" with Search again / Add to LRCLIB), above Spotify's
//   Lyrics button, when the lyrics view is open but nothing was found.
import type { Mode } from '../shared/types';

const CSS = `
:host { all: initial; }
.pill, .notice {
  position: fixed; z-index: 2147483000; border-radius: 999px; background: rgba(0,0,0,.6); backdrop-filter: blur(12px);
  font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
  box-shadow: 0 4px 18px rgba(0,0,0,.35); user-select: none;
}
.pill { display: flex; gap: 2px; padding: 4px; }
.notice { display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 14px; border-radius: 18px; max-width: 420px; }
[hidden] { display: none !important; }
button, a {
  all: unset; cursor: pointer; padding: 8px 12px; border-radius: 999px; color: rgba(255,255,255,.8); white-space: nowrap;
}
button:hover, a:hover { color: #fff; background: rgba(255,255,255,.12); }
button:focus-visible, a:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.pill button[aria-pressed="true"] { background: #fff; color: #000; }
.busy button[aria-pressed="true"] { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .55; } }
.note { align-self: center; padding: 0 8px; font-weight: 500; color: #ffb4a8; max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note:empty { display: none; }
.notice .text { font-weight: 500; line-height: 1.3; padding-right: 6px; }
.notice .primary { background: #fff; color: #000; }
`;

const LABELS: [Mode, string][] = [['original', 'Original'], ['romanized', 'Romanized'], ['translated', 'Translated']];

export interface NoticeAction {
  label: string;
  /** A link opened in a new tab, or a function run on click. */
  href?: string;
  run?: () => void;
  primary?: boolean;
}

export interface Notice {
  text: string;
  actions: NoticeAction[];
}

export class Pill {
  private host = document.createElement('sk-pill');
  private root: HTMLDivElement;
  private buttons = new Map<Mode, HTMLButtonElement>();
  private note: HTMLSpanElement;
  private noticeEl: HTMLDivElement;
  private noticeKey = '';

  constructor(onPick: (m: Mode) => void) {
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root = document.createElement('div');
    this.root.className = 'pill';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Lyrics display');
    this.root.hidden = true;
    for (const [mode, label] of LABELS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => onPick(mode));
      this.buttons.set(mode, b);
      this.root.append(b);
    }
    this.note = document.createElement('span');
    this.note.className = 'note';
    this.root.append(this.note);
    this.noticeEl = document.createElement('div');
    this.noticeEl.className = 'notice';
    this.noticeEl.setAttribute('role', 'status');
    this.noticeEl.hidden = true;
    shadow.append(style, this.root, this.noticeEl);
  }

  mount() {
    if (!this.host.isConnected) document.body.append(this.host);
  }

  update(o: { mode: Mode; visible: boolean; rect: DOMRect | null; busy: boolean; note?: string }) {
    for (const [m, b] of this.buttons) b.setAttribute('aria-pressed', String(m === o.mode));
    this.root.classList.toggle('busy', o.busy);
    this.note.textContent = o.note ?? '';
    this.note.title = o.note ?? '';
    // Only on the full lyrics view, not on Spotify's small lyrics card in the sidebar.
    const show = o.visible && !!o.rect && o.rect.width >= 420 && o.rect.height >= 260;
    this.root.hidden = !show;
    if (show && o.rect) {
      this.root.style.right = `${Math.max(12, window.innerWidth - o.rect.right + 20)}px`;
      this.root.style.bottom = `${Math.max(12, window.innerHeight - o.rect.bottom + 20)}px`;
    }
  }

  /** Shows a notice above `anchor` (Spotify's Lyrics button), or hides it (null). */
  notice(n: Notice | null, anchor: DOMRect | null) {
    if (!n || !anchor) {
      this.noticeEl.hidden = true;
      this.noticeKey = '';
      return;
    }
    this.mount();
    const key = n.text + n.actions.map((a) => a.label).join();
    if (key !== this.noticeKey) {
      this.noticeKey = key;
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = n.text;
      const parts: HTMLElement[] = [text];
      for (const a of n.actions) {
        const el = a.href ? document.createElement('a') : document.createElement('button');
        el.textContent = a.label;
        if (a.primary) el.className = 'primary';
        if (a.href && el instanceof HTMLAnchorElement) {
          el.href = a.href;
          el.target = '_blank';
          el.rel = 'noopener noreferrer';
        }
        if (a.run) el.addEventListener('click', () => a.run!());
        parts.push(el);
      }
      this.noticeEl.replaceChildren(...parts);
    }
    this.noticeEl.hidden = false;
    this.noticeEl.style.right = `${Math.max(12, window.innerWidth - anchor.right)}px`;
    this.noticeEl.style.bottom = `${Math.max(12, window.innerHeight - anchor.top + 12)}px`;
  }
}
