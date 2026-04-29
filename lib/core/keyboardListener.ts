import { getLyricsContainer } from '../dom/domQueries';
import type { LyricsMode } from './lyricsTypes';

export function setupKeyboardShortcuts(switchMode: (mode: LyricsMode) => Promise<void>): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return; // ignore modified combos
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;
    if (!getLyricsContainer()) return; // Only active when lyrics panel is open

    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      switchMode('original');
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      switchMode('romanized');
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      switchMode('translated');
    }
  });
}
