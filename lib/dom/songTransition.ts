/**
 * Song changes in the expanded lyrics view, the way Spotify does them.
 *
 * Spotify slides the previous song's view out and the next one in (each song has its own
 * slide wrapper, moved with an inline translateX; the old one is unmounted ~0.8 s later,
 * live 2026-11-08). The extension used to take its lyrics down and give Spotify's panel
 * back at the song change, in the middle of that slide: the view went blank, or the
 * previous song's Spotify lyrics showed for a moment.
 *
 * Now, when the song changes, the previous song's slide is marked as leaving: nothing in
 * it counts as the current song's panel any more (domQueries), and when our lyrics were
 * on it, a still copy of them stays there with Spotify's panel under it hidden, so it
 * slides out as it looked. The rest of the song change happens as before, out of sight.
 *
 * The mode pill is not in any slide (lyricsControls: its home is the view itself), so a
 * song change never touches it.
 */
import { LEAVING_ROOT_ATTR, LEAVING_SLIDE_ATTR, PANEL_TRACK_ATTR, PLAYING_TRACK_ATTR, getNowPlayingOverlay } from './domQueries';
import { traceEvent } from '../testHooks';

/** Longest a slide is treated as leaving (Spotify unmounts it after ~0.8 s). */
export const LEAVE_MAX_MS = 1500;
/** No new slide by then: Spotify is not sliding (nothing is left on screen). */
export const NO_SLIDE_MS = 400;

let leavingSlide: HTMLElement | null = null;
let leaveObserver: MutationObserver | null = null;
let leaveTimers: ReturnType<typeof setTimeout>[] = [];

const hasTranslate = (el: Element | null): el is HTMLElement =>
  !!el && !!(el as HTMLElement).style?.transform?.includes('translateX');

/** Spotify's per-song slide wrapper around `el`, inside the expanded view. */
export function slideOf(el: Element | null): HTMLElement | null {
  const overlay = getNowPlayingOverlay();
  if (!el || !overlay || !overlay.contains(el)) return null;
  let node: Element | null = el.parentElement;
  while (node && node !== overlay) {
    if (hasTranslate(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** The slides in the view that hold a lyrics panel (or our lyrics). */
function songSlides(overlay: HTMLElement): HTMLElement[] {
  return Array.from(overlay.querySelectorAll<HTMLElement>('[style*="translateX"]'))
    .filter(el => !!el.querySelector('div[style*="--lyrics-color-active"], #lyrics-root-sync'));
}

/** The one slide whose rows show any of these lines (their original text). */
function slideShowing(slides: HTMLElement[], lines: readonly string[]): HTMLElement | null {
  const known = new Set(lines.map(l => l.trim()).filter(l => l.length > 1));
  if (known.size === 0) return null;
  const holding = slides.filter(sl => Array.from(sl.querySelectorAll('[data-testid="lyrics-line"] > div'))
    .some(row => known.has((row.getAttribute('data-sly-original') ?? row.textContent ?? '').trim())));
  return holding.length === 1 ? holding[0] : null;
}

/** A track uri's (or bare id's) 22-character id; '' when there is none. */
const trackIdOf = (uri: string | null | undefined): string => {
  const id = String(uri ?? '').split(':').pop() ?? '';
  return /^[A-Za-z0-9]{22}$/.test(id) ? id : '';
};

/** The track the bridge tagged this slide's lyrics panel with (domQueries PANEL_TRACK_ATTR). */
const panelTrackOf = (slide: Element): string | null =>
  slide.querySelector(`[${PANEL_TRACK_ATTR}]`)?.getAttribute(PANEL_TRACK_ATTR) ?? null;

/** Another song's slide next to this one (Spotify is sliding between songs). */
function otherSlideBeside(slide: HTMLElement): boolean {
  const parent = slide.parentElement;
  return !!parent && Array.from(parent.children).some(c => c !== slide && hasTranslate(c));
}

/** The slide of the song being left, done: copies removed, nothing marked. */
export function endLeaving(): void {
  leaveObserver?.disconnect();
  leaveObserver = null;
  leaveTimers.forEach(clearTimeout);
  leaveTimers = [];
  // Also in the slide itself: Spotify may keep an unmounted slide and mount it again when
  // the song comes back (live 2026-11-08: the copy came back with it).
  const scopes: ParentNode[] = [document];
  if (leavingSlide && !leavingSlide.isConnected) scopes.push(leavingSlide);
  for (const scope of scopes) {
    scope.querySelectorAll(`[${LEAVING_ROOT_ATTR}]`).forEach(el => el.remove());
    scope.querySelectorAll(`[${LEAVING_SLIDE_ATTR}]`).forEach(el => el.removeAttribute(LEAVING_SLIDE_ATTR));
  }
  leavingSlide?.removeAttribute(LEAVING_SLIDE_ATTR);
  leavingSlide = null;
}

/** A song change is under way in the expanded view (the previous slide is still leaving). */
export function isSongTransitionActive(): boolean {
  return !!leavingSlide?.isConnected;
}

/**
 * Call at the song change, before anything is taken down for the next song. Idempotent:
 * the second caller of the same change finds the slide already leaving.
 */
export function beginSongTransition(
  previousLines: readonly string[] = [],
  previousTrack: string | null = null,
  currentTrack: string | null = null,
): void {
  const overlay = getNowPlayingOverlay();
  if (!overlay) return;
  const root = document.getElementById('lyrics-root-sync');
  // The song being left: the slide holding our lyrics, else the slide whose panel the bridge
  // tagged with the previous track, else the only slide, else the one showing the previous
  // song's lines (Spotify may add the next slide before the song change is known; unmarked,
  // its rows were read as the new song's, live 2026-11-08). Unsure: nothing is marked.
  let slide = slideOf(root && overlay.contains(root) ? root : null);
  if (!slide) {
    const slides = songSlides(overlay);
    const prevId = trackIdOf(previousTrack);
    const ofPrevious = prevId ? slides.filter(sl => trackIdOf(panelTrackOf(sl)) === prevId) : [];
    if (ofPrevious.length === 1) slide = ofPrevious[0];
    else if (slides.length === 1) {
      // The only slide, unless it is a panel just mounted: with the bridge running (it marks
      // the playing track on <html>), a panel that has been on screen is tagged, so an
      // untagged one is the next song's, mounted at the song change.
      const fresh = document.documentElement.hasAttribute(PLAYING_TRACK_ATTR) && !panelTrackOf(slides[0]);
      slide = fresh ? null : slides[0];
    } else if (slides.length > 1) slide = slideShowing(slides, previousLines);
    // Never another song's slide: when the song being left has no lyrics panel, the only
    // panel is the next song's (live 2026-11-08: marked leaving, its rows were ignored and
    // stayed unprocessed until the 1.5 s limit).
    const tagged = slide ? trackIdOf(panelTrackOf(slide)) : '';
    if (slide && prevId && tagged && tagged !== prevId) slide = null;
    // Nor the slide of the song now playing (live 2026-11-08: after an ad, the next song's
    // panel, mounted and painted during the ad, was marked and stripped for 1.5 s).
    const curId = trackIdOf(currentTrack);
    if (slide && curId && tagged === curId) slide = null;
  }
  if (!slide || slide.hasAttribute(LEAVING_SLIDE_ATTR)) return;
  endLeaving();

  traceEvent(`leaving:${(panelTrackOf(slide) ?? 'untagged').slice(-6)}(prev ${trackIdOf(previousTrack).slice(-6) || '-'}, now ${trackIdOf(currentTrack).slice(-6) || '-'})`);
  const ours = !!root && slide.contains(root) && !root.classList.contains('sly-root-notice');
  slide.setAttribute(LEAVING_SLIDE_ATTR, ours ? 'ours' : 'spotify');
  if (ours && root?.parentElement) {
    // A still copy: the real root is rebuilt for the next song by the usual code.
    const copy = root.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    copy.setAttribute(LEAVING_ROOT_ATTR, '');
    copy.setAttribute('aria-hidden', 'true');
    root.parentElement.insertBefore(copy, root);
  }
  leavingSlide = slide;

  const parent = slide.parentElement;
  if (parent) {
    leaveObserver = new MutationObserver(() => { if (!slide.isConnected) endLeaving(); });
    leaveObserver.observe(parent, { childList: true });
  }
  leaveTimers.push(setTimeout(() => { if (leavingSlide === slide) endLeaving(); }, LEAVE_MAX_MS));
  // Spotify did not slide (no next slide beside it): nothing is left to show.
  leaveTimers.push(setTimeout(() => { if (leavingSlide === slide && !otherSlideBeside(slide)) endLeaving(); }, NO_SLIDE_MS));
}

// ─── Waiting for the view's lyrics panel ────────────────────────────────────

/** The expanded view's lyrics panel (not the sidebar preview, not a leaving slide). */
export const OVERLAY_PANEL_SELECTOR =
  '[data-testid="root"] > div > div:has(button[role="radio"][value="lyrics"]) div[style*="--lyrics-color-active"]:not(#lyrics-root-sync):not(#Desktop_PanelContainer_Id *):not([data-sly-leaving] *):not([data-sly-root-leaving])';
const PANEL_MOUNT_WAIT_MS = 2000;
let mountWait: MutationObserver | null = null;

/**
 * Runs `onMount` (by default slyCore's check, window.slyKickPoll) as soon as the
 * expanded view's lyrics panel is mounted: the view reopened, or the next song's slide
 * arrived. Our lyrics then take the panel's place in the next frame instead of at the
 * next poll tick (0.5–5 s later). A newer call replaces a waiting one.
 */
export function kickWhenPanelMounts(onMount: () => void = () => (window as any).slyKickPoll?.()): void {
  if (mountWait) mountWait.disconnect();
  mountWait = null;
  const mounted = () => !!document.querySelector(OVERLAY_PANEL_SELECTOR);
  if (mounted()) { onMount(); return; }
  const obs = new MutationObserver(() => {
    if (!mounted()) return;
    obs.disconnect();
    if (mountWait === obs) mountWait = null;
    onMount();
  });
  mountWait = obs;
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => { obs.disconnect(); if (mountWait === obs) mountWait = null; }, PANEL_MOUNT_WAIT_MS);
}

/** Tests. */
export function resetSongTransition(): void {
  endLeaving();
  mountWait?.disconnect();
  mountWait = null;
}
