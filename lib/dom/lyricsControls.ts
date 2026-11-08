import type { LyricsMode } from '../core/lyricsTypes';
import { getLyricsContainer, getNowPlayingOverlay } from './domQueries';

export const CONTROLS_ID = 'sly-lyrics-controls';

/** Gap between Spotify's overlay header and the pinned pill (the CSS default is 12px from the top). */
const PILL_GAP_PX = 12;

/**
 * In Spotify's 2026 Now Playing overlay the header (media switch, minimize) sits on top
 * of the scroll area, invisible while idle but still taking clicks: the pill goes below
 * it, or it cannot be clicked.
 */
export function alignPillBelowHeader(pill: HTMLElement): void {
  const overlay = pill.closest('[data-testid="root"] > div > div');
  const header = overlay
    ? Array.from(overlay.children).find((c) => c.querySelector('button[role="radio"]')) as HTMLElement | undefined
    : undefined;
  const height = header?.getBoundingClientRect().height ?? 0;
  pill.style.top = height > 0 ? `${Math.round(height + PILL_GAP_PX)}px` : '';
}

/** On Spotify's expanded view itself (styles: .sly-pill-docked). */
const DOCKED_CLASS = 'sly-pill-docked';

/**
 * 2026 UI: the pill's one home is Spotify's expanded view itself, under its header, not
 * the lyrics list. Spotify gives every song its own list and throws the previous one
 * away on a skip, so a pill in the list vanished with it and came back (live
 * 2026-11-08). In the view it is never touched by a skip. Legacy UI: the list.
 */
function placePill(pill: HTMLElement, container: Element): void {
  const view = getNowPlayingOverlay();
  if (view && view.contains(container)) {
    if (pill.parentElement !== view) view.appendChild(pill);
    pill.classList.add(DOCKED_CLASS);
  } else {
    pill.classList.remove(DOCKED_CLASS);
    if (pill.parentElement !== container) container.insertBefore(pill, container.firstChild);
  }
  alignPillBelowHeader(pill);
}

/** The pill is in its home on Spotify's expanded view (where a skip never touches it). */
export function isPillDocked(pill: Element | null = document.getElementById(CONTROLS_ID)): boolean {
  if (!pill?.isConnected || !pill.classList.contains(DOCKED_CLASS)) return false;
  const view = getNowPlayingOverlay();
  return !!view && pill.parentElement === view;
}

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
    // injectControls is a PLACEMENT function — it positions the pill and
    // updates button labels, but does NOT clear sly-loading.
    // Shimmer state is exclusively managed by setLoadingState(false), called
    // by whichever code path has confirmed the content is ready.
    existing.style.display = showPill ? '' : 'none';
    
    // Apply visual fakeout to prevent button highlights from visually "resetting"
    // to Original while waiting for processed lyrics to arrive.
    const displayMode =
      mode === 'original' && preferredMode !== 'original' ? preferredMode : mode;
    syncButtonStates(displayMode);

    placePill(existing, container);
    return;
  }

  const wrap = document.createElement('div');
  wrap.id = CONTROLS_ID;
  wrap.className = 'sly-lyrics-controls';
  if (!showPill) wrap.style.display = 'none';

  // Visual fakeout: show preferredMode as active even when mode is still 'original'
  // (during the loading window before processed lyrics arrive). This prevents
  // the pill buttons from visually "resetting" to Original on every song change.
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

  placePill(wrap, container);
}

export function syncButtonStates(mode: LyricsMode): void {
  document
    .getElementById(CONTROLS_ID)
    ?.querySelectorAll<HTMLElement>('.sly-lyrics-btn')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
}

export function setButtonsDisabled(disabled: boolean): void {
  document
    .getElementById(CONTROLS_ID)
    ?.querySelectorAll<HTMLButtonElement>('.sly-lyrics-btn')
    .forEach((b) => (b.disabled = disabled));
}

export function setLoadingState(loading: boolean): void {
  setButtonsDisabled(loading);
    
  const getTarget = () => {
    const customRoot = document.getElementById('lyrics-root-sync');
    return (customRoot && customRoot.style.display !== 'none') 
      ? customRoot 
      : getLyricsContainer();
  };

  if (loading) {
    getTarget()?.classList.add('sly-loading');
  } else {
    // Clear from BOTH possible containers to be safe against late-arriving results
    document.getElementById('lyrics-root-sync')?.classList.remove('sly-loading');
    getLyricsContainer()?.classList.remove('sly-loading');
    // Also clear the loading marker from the pill element itself (added by parkPill).
    document.getElementById(CONTROLS_ID)?.classList.remove('sly-loading');
  }
}
