// The on-page controls, in their own shadow root on <body>, outside React's tree:
// - the mode switcher (Original / Romanized / Translated): 3.1.6's capsule, centred 12 px
//   under Spotify's lyrics header, shown only while the lyrics view is open, offering only
//   the modes that change something for the song;
// - in the same spot, the actions for a song nothing was found for (Search again / Add to
//   LRCLIB), under Spotify's own "no lyrics" message rather than repeating it.
// Spotify's font comes from its page (@font-face applies inside shadow roots).
import type { Mode } from '../shared/types';
import type { Anchor } from './view';

const FONT = `SpotifyMixUI, CircularSp, "Circular Std", system-ui, -apple-system, "Segoe UI", sans-serif`;

const CSS = `
:host { all: initial; }
.slot {
  position: fixed; z-index: 2147483000; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  font-family: ${FONT}; pointer-events: none;
}
.slot[hidden], button[hidden] { display: none; }
.capsule {
  pointer-events: auto; display: flex; align-items: center; gap: 4px; padding: 6px;
  background: rgba(0, 0, 0, .4); -webkit-backdrop-filter: blur(4px) saturate(180%); backdrop-filter: blur(4px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, .1); border-radius: 32px; box-shadow: 0 4px 12px rgba(0, 0, 0, .2);
  transition: background .2s ease, box-shadow .2s ease;
}
.capsule:hover { background: rgba(0, 0, 0, .6); border-color: rgba(255, 255, 255, .2); }
button, a {
  all: unset; cursor: pointer; box-sizing: border-box; padding: 8px 16px; border-radius: 20px; white-space: nowrap;
  font: 400 14px/1.2 ${FONT}; color: rgba(255, 255, 255, .7);
  transition: color .2s ease, background-color .2s ease, transform .1s ease;
}
button:hover, a:hover { color: #fff; background-color: rgba(255, 255, 255, .1); }
button:active, a:active { transform: scale(.96); }
button:focus-visible, a:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
[aria-pressed="true"], .primary { background-color: #fff; color: #000; font-weight: 600; box-shadow: 0 2px 4px rgba(0, 0, 0, .1); }
[aria-pressed="true"]:hover, .primary:hover { background-color: #fff; color: #000; }
.busy [aria-pressed="true"] { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .6; } }
.caption { font: 400 12px/1.3 ${FONT}; color: rgba(255, 255, 255, .7); text-shadow: 0 1px 2px rgba(0, 0, 0, .4); }
.caption:empty { display: none; }
`;

const LABELS: [Mode, string, string][] = [['original', 'Original', 'O'], ['romanized', 'Romanized', 'R'], ['translated', 'Translated', 'T']];

export interface NoticeAction {
  label: string;
  /** A link opened in a new tab, or a function run on click. */
  href?: string;
  run?: () => void;
  primary?: boolean;
}

export interface Notice {
  /** Short status under the actions (e.g. "Still no lyrics"); empty: none. */
  caption: string;
  actions: NoticeAction[];
}

/** The full lyrics view, not Spotify's small lyrics card in the sidebar. */
const isFullView = (a: Anchor) => a.width >= 420 && a.height >= 260;

export class Pill {
  private host = document.createElement('sk-pill');
  private switcher: HTMLDivElement;
  private switcherCapsule: HTMLDivElement;
  private buttons = new Map<Mode, HTMLButtonElement>();
  private switcherCaption: HTMLDivElement;
  private noticeSlot: HTMLDivElement;
  private noticeCapsule: HTMLDivElement;
  private noticeCaption: HTMLDivElement;
  private noticeKey = '';

  constructor(onPick: (m: Mode) => void) {
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    [this.switcher, this.switcherCapsule, this.switcherCaption] = slot('Lyrics display');
    for (const [mode, label, key] of LABELS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = `${label} (${key})`;
      b.addEventListener('click', () => onPick(mode));
      this.buttons.set(mode, b);
      this.switcherCapsule.append(b);
    }
    [this.noticeSlot, this.noticeCapsule, this.noticeCaption] = slot('Lyrics not found');
    this.noticeSlot.setAttribute('role', 'status');
    shadow.append(style, this.switcher, this.noticeSlot);
  }

  mount() {
    if (!this.host.isConnected) document.body.append(this.host);
  }

  remove() {
    this.host.remove();
  }

  /**
   * `mode` is the mode in effect for this song, `modes` the ones that change something for
   * it (a Latin-script song has nothing to romanize: Original and Translated only).
   */
  update(o: { mode: Mode; modes: Mode[]; visible: boolean; anchor: Anchor | null; busy: boolean; caption?: string }) {
    for (const [m, b] of this.buttons) {
      b.setAttribute('aria-pressed', String(m === o.mode));
      b.hidden = !o.modes.includes(m);
    }
    this.switcherCapsule.classList.toggle('busy', o.busy);
    this.switcherCaption.textContent = o.caption ?? '';
    const show = o.visible && !!o.anchor && isFullView(o.anchor);
    this.switcher.hidden = !show;
    if (show) place(this.switcher, o.anchor!);
  }

  /** Actions in the switcher's spot when the lyrics view is open but empty; null hides them. */
  notice(n: Notice | null, anchor: Anchor | null) {
    if (!n || !anchor) {
      this.noticeSlot.hidden = true;
      return;
    }
    this.mount();
    const key = n.caption + n.actions.map((a) => a.label).join();
    if (key !== this.noticeKey) {
      this.noticeKey = key;
      this.noticeCapsule.replaceChildren(
        ...n.actions.map((a) => {
          const el = a.href ? document.createElement('a') : document.createElement('button');
          el.textContent = a.label;
          if (a.primary) el.className = 'primary';
          if (el instanceof HTMLAnchorElement && a.href) {
            el.href = a.href;
            el.target = '_blank';
            el.rel = 'noopener noreferrer';
          }
          if (a.run) el.addEventListener('click', () => a.run!());
          return el;
        }),
      );
      this.noticeCapsule.hidden = n.actions.length === 0;
      this.noticeCaption.textContent = n.caption;
    }
    this.noticeSlot.hidden = false;
    place(this.noticeSlot, anchor);
  }
}

function slot(label: string): [HTMLDivElement, HTMLDivElement, HTMLDivElement] {
  const outer = document.createElement('div');
  outer.className = 'slot';
  outer.hidden = true;
  const capsule = document.createElement('div');
  capsule.className = 'capsule';
  capsule.setAttribute('role', 'group');
  capsule.setAttribute('aria-label', label);
  const caption = document.createElement('div');
  caption.className = 'caption';
  outer.append(capsule, caption);
  return [outer, capsule, caption];
}

function place(el: HTMLElement, a: Anchor) {
  el.style.top = `${Math.round(a.top)}px`;
  el.style.left = `${Math.round(a.centerX)}px`;
}
