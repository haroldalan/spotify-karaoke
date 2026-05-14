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

  const hasContent = snapped.filter(l => l.trim().length > 0).length >= 3;
  if (!hasContent) return;

  cache.original = snapped;
}

/**
 * Capitalizes the first alphabetic character in a string, preserving any leading
 * non-alphabetic characters (e.g., "(dha" -> "(Dha").
 */
export function capitalizeLine(line: string): string {
  if (!line) return line;
  return line.replace(/^([^a-zA-Z]*)([a-z])/, (match, prefix, firstChar) => {
    return prefix + firstChar.toUpperCase();
  });
}

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
    // BUG-15 Fix: If the element is no longer connected to the DOM, skip it.
    // This happens if a panel close -> reopen occurred during an async fetch.
    // We allow 'lyrics-root-sync' even if not yet connected (during initial injection).
    if (!el || (!el.isConnected && el.id !== 'lyrics-root-sync')) return;
    if (lines[i] === undefined) return;

    if (originals?.[i] !== undefined) {
      el.setAttribute('data-sly-original', originals[i]);
    }

    const processedLine = capitalizeLine(lines[i]);

    const showDual =
      dualLyricsEnabled &&
      originals !== undefined &&
      originals[i] !== undefined &&
      originals[i] !== lines[i];

    if (showDual) {
      el.textContent = '';
      const mainSpan = document.createElement('span');
      mainSpan.className = 'sly-main-line';
      mainSpan.textContent = processedLine;
      el.appendChild(mainSpan);

      const subSpan = document.createElement('span');
      subSpan.className = 'sly-dual-line';
      subSpan.textContent = originals![i];
      el.appendChild(subSpan);
    } else {
      el.textContent = processedLine;
    }
  });

  // setTimeout defers the flag reset to a macrotask, ensuring the MutationObserver
  // microtask (which fires during the same synchronous task as the DOM writes above)
  // still sees isApplying=true and skips its re-apply check.
  setTimeout(() => { setApplying(false); }, 50);
}
