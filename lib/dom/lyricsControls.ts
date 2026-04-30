import type { LyricsMode } from '../core/lyricsTypes';
import { getLyricsContainer } from './domQueries';

export const CONTROLS_ID = 'sly-lyrics-controls';

export function setPillVisibility(visible: boolean): void {
  const controls = document.getElementById(CONTROLS_ID);
  if (controls) controls.style.display = visible ? '' : 'none';
}

export function injectControls(
  container: Element,
  showPill: boolean,
  mode: LyricsMode,
  preferredMode: LyricsMode,
  onModeSwitch: (m: LyricsMode) => void
): void {
  const existing = document.getElementById(CONTROLS_ID);
  if (existing) {
    existing.classList.remove('sly-loading');
    existing.style.display = showPill ? '' : 'none';
    if (existing.parentElement !== container) {
      container.insertBefore(existing, container.firstChild);
    }
    return;
  }

  const wrap = document.createElement('div');
  wrap.id = CONTROLS_ID;
  wrap.className = 'sly-lyrics-controls';
  if (!showPill) wrap.style.display = 'none';

  const displayMode =
    mode === 'original' && preferredMode !== 'original' ? preferredMode : mode;

  (['original', 'romanized', 'translated'] as LyricsMode[]).forEach((m) => {
    const btn = document.createElement('button');
    btn.className = `sly-lyrics-btn${displayMode === m ? ' active' : ''}`;
    btn.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    btn.dataset.mode = m;
    btn.addEventListener('click', () => onModeSwitch(m));
    wrap.appendChild(btn);
  });

  container.insertBefore(wrap, container.firstChild);
}

export function syncButtonStates(mode: LyricsMode): void {
  document
    .getElementById(CONTROLS_ID)
    ?.querySelectorAll<HTMLElement>('.sly-lyrics-btn')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
}

export function setLoadingState(loading: boolean): void {
  document
    .getElementById(CONTROLS_ID)
    ?.querySelectorAll<HTMLButtonElement>('.sly-lyrics-btn')
    .forEach((b) => (b.disabled = loading));
    
  const customRoot = document.getElementById('lyrics-root-sync');
  const targetContainer = (customRoot && customRoot.style.display !== 'none') 
    ? customRoot 
    : getLyricsContainer();
    
  targetContainer?.classList.toggle('sly-loading', loading);
}
