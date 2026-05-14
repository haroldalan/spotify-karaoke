/**
 * pillStateManager.ts
 *
 * Single source of truth for the mode-pill's visibility lifecycle.
 *
 * The pill transitions through four named states:
 *
 *   PARKED   — pill is on document.body, visible, in loading style.
 *              Used during song transitions (no container exists yet).
 *   LOADING  — pill is in its normal container but shows the shimmer.
 *              Used while a background PROCESS fetch is in flight.
 *   VISIBLE  — pill is in its normal container, shimmer off, buttons enabled.
 *   GONE     — pill has been removed from the DOM entirely (context teardown).
 *
 * Rules:
 *   • parkPill() NEVER sets display:none — the pill must remain visible during
 *     song transitions so the user never sees it disappear.
 *   • Only destroyPill() calls pill.remove(). No other site in the codebase
 *     should call pill.remove() directly.
 *   • All transitions are idempotent — safe to call multiple times.
 *   • parkPill() and loadingPill() respect store.showPill: if the user has
 *     disabled the pill in preferences it stays hidden even during loading.
 */

import { CONTROLS_ID, syncButtonStates, setButtonsDisabled } from './lyricsControls';
import type { LyricsMode } from '../core/lyricsTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPill(): HTMLElement | null {
  return document.getElementById(CONTROLS_ID);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Park the pill on document.body in a loading state.
 *
 * Called from `sly:release` (replacing the previous display:none + rescue) and
 * from `onSongChange` when there is no hot cache (replacing orphan.remove()).
 *
 * The pill remains VISIBLE so the user never sees it disappear.
 * Buttons are disabled to prevent interaction while content is loading.
 * Button labels are updated to reflect preferredMode so the active button
 * stays highlighted even before processed lyrics arrive.
 *
 * @param preferredMode   The mode the user has set as their preference.
 * @param showPill        Whether the user preference allows the pill to be shown.
 */
export function parkPill(preferredMode: LyricsMode, showPill: boolean): void {
  const pill = getPill();
  if (!pill) return;

  // Respect user preference: if they've hidden the pill, keep it hidden.
  pill.style.display = showPill ? '' : 'none';
  pill.classList.add('sly-loading');
  setButtonsDisabled(true);
  // Keep the preferred-mode button highlighted so the pill looks intentional.
  syncButtonStates(preferredMode);

  // Move to body only if it isn't already there.
  if (pill.parentElement !== document.body) {
    document.body.appendChild(pill);
  }
}

/**
 * Enter the loading/shimmer visual while the pill is already in its container.
 *
 * Idempotent — safe to call even while the pill is already in PARKED state.
 * The shimmer CSS (`.sly-loading` on the lyrics container) is applied by
 * `setLoadingState(true)` in `lyricsControls.ts`; this function only manages
 * the pill element itself.
 *
 * @param showPill  Whether the user preference allows the pill to be shown.
 */
export function enterLoadingPill(showPill: boolean): void {
  const pill = getPill();
  if (!pill) return;

  pill.style.display = showPill ? '' : 'none';
  pill.classList.add('sly-loading');
  setButtonsDisabled(true);
}

/**
 * Remove the pill from the DOM entirely.
 *
 * This is the ONLY authorised call site for pill.remove() in the codebase.
 * Only call this when the extension context is being torn down or when an
 * explicit "no pill" decision has been made for the current context.
 */
export function destroyPill(): void {
  getPill()?.remove();
}
