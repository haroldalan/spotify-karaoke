// The on-page mode switcher: Original / Romanized / Translated. Lives in its own shadow
// root on <body>, outside React's tree, pinned to the lyrics view's bottom-right corner.
import type { Mode } from '../shared/types';

const CSS = `
:host { all: initial; }
.pill {
  position: fixed; z-index: 2147483000; display: flex; gap: 2px; padding: 4px;
  border-radius: 999px; background: rgba(0,0,0,.55); backdrop-filter: blur(12px);
  font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
  box-shadow: 0 4px 18px rgba(0,0,0,.35); transition: opacity .2s; user-select: none;
}
.pill[hidden] { display: none; }
button {
  all: unset; cursor: pointer; padding: 8px 12px; border-radius: 999px; color: rgba(255,255,255,.75);
}
button:hover { color: #fff; background: rgba(255,255,255,.1); }
button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
button[aria-pressed="true"] { background: #fff; color: #000; }
.busy button[aria-pressed="true"] { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .55; } }
.note { align-self: center; padding: 0 8px; font-weight: 500; color: #ffb4a8; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note:empty { display: none; }
`;

const LABELS: [Mode, string][] = [['original', 'Original'], ['romanized', 'Romanized'], ['translated', 'Translated']];

export class Pill {
  private host = document.createElement('sk-pill');
  private root: HTMLDivElement;
  private buttons = new Map<Mode, HTMLButtonElement>();
  private note: HTMLSpanElement;

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
    shadow.append(style, this.root);
  }

  mount() {
    if (!this.host.isConnected) document.body.append(this.host);
  }

  update(o: { mode: Mode; visible: boolean; rect: DOMRect | null; busy: boolean; note?: string }) {
    for (const [m, b] of this.buttons) b.setAttribute('aria-pressed', String(m === o.mode));
    this.root.classList.toggle('busy', o.busy);
    this.note.textContent = o.note ?? '';
    this.note.title = o.note ?? '';
    const show = o.visible && !!o.rect && o.rect.width > 200 && o.rect.height > 120;
    this.root.hidden = !show;
    if (show && o.rect) {
      this.root.style.right = `${Math.max(12, window.innerWidth - o.rect.right + 20)}px`;
      this.root.style.bottom = `${Math.max(12, window.innerHeight - o.rect.bottom + 20)}px`;
    }
  }
}
