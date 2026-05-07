import { getLyricsLines, getNowPlayingKey } from './domQueries';
import type { SongCache } from '../core/lyricsTypes';

export function snapshotOriginals(cache: SongCache): void {
  const lines = getLyricsLines();
  const currentKey = getNowPlayingKey();
  console.log(`[sly-audit] 📸 snapshotOriginals executing for active songKey: "${currentKey}". Snapped ${lines.length} lines. First line preview: "${lines[0]?.textContent?.trim() || 'empty'}"`);

  lines.forEach((el) => {
    if (el.hasAttribute('data-sly-original')) return;

    const dualSub = el.querySelector<HTMLElement>('.sly-dual-line');
    if (dualSub) {
      el.setAttribute('data-sly-original', dualSub.textContent ?? '');
      return;
    }
    const mainSpan = el.querySelector<HTMLElement>('.sly-main-line');
    if (mainSpan) {
      el.setAttribute('data-sly-original', mainSpan.textContent ?? '');
      return;
    }
    el.setAttribute('data-sly-original', el.textContent ?? '');
  });

  const snapped = lines.map(
    (el) => el.getAttribute('data-sly-original') ?? ''
  );

  const hasContent = snapped.some(l => l.trim().length > 0);
  if (!hasContent) return;

  cache.original = snapped;
}

let applyResetTimeout: any = null;

export function applyLinesToDOM(
  lines: string[] | null | undefined,
  originals: string[] | undefined,
  dualLyricsEnabled: boolean,
  setApplying: (v: boolean) => void,
  targetElements?: Element[]
): void {
  if (!Array.isArray(lines)) return;

  setApplying(true);

  (targetElements ?? getLyricsLines()).forEach((el, i) => {
    if (lines[i] === undefined) return;

    if (originals?.[i] !== undefined) {
      el.setAttribute('data-sly-original', originals[i]);
    }

    const showDual =
      dualLyricsEnabled &&
      originals !== undefined &&
      originals[i] !== undefined &&
      originals[i] !== lines[i];

    if (showDual) {
      el.textContent = '';
      const mainSpan = document.createElement('span');
      mainSpan.className = 'sly-main-line';
      mainSpan.textContent = lines[i];
      el.appendChild(mainSpan);

      const subSpan = document.createElement('span');
      subSpan.className = 'sly-dual-line';
      subSpan.textContent = originals![i];
      el.appendChild(subSpan);
    } else {
      el.textContent = lines[i];
    }
  });

  // setTimeout defers the flag reset to a macrotask, ensuring the MutationObserver
  // microtask (which fires during the same synchronous task as the DOM writes above)
  // still sees isApplying=true and skips its re-apply check.
  if (applyResetTimeout) clearTimeout(applyResetTimeout);
  applyResetTimeout = setTimeout(() => { 
    setApplying(false); 
    applyResetTimeout = null;
  }, 50);
}
