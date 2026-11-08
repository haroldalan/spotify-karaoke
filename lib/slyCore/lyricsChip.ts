/**
 * Our lyrics inside Spotify's expanded Now Playing view, for tracks Spotify has no
 * lyrics for, follow Spotify's media switch (Artwork / Canvas / Artist image / Lyrics).
 *
 * Spotify's own Lyrics option is disabled for such tracks, so while our lyrics are
 * showing there, it is replaced by our own "Lyrics" button with the same look (its
 * classes and icon are copied; the disabled original is hidden by CSS only while our
 * button sits right after it, so it comes back as soon as ours is removed). Picking
 * another media option steps our lyrics aside; our button brings them back. The choice
 * holds until the overlay closes, like Spotify's own mode choice.
 *
 * While the extension is still looking (or found nothing), the same button carries that
 * status instead (lyricsStatus.ts): a spinner, a few words beside the switch, and a
 * popover with the details and actions (Add lyrics, Retry). Nothing covers Spotify's
 * artwork or cards.
 */
import { getNowPlayingOverlay } from '../dom/domQueries';
import { getLyricsStatus, type LyricsStatus } from './lyricsStatus';

export const LYRICS_CHIP_ID = 'sly-lyrics-chip';
export const LYRICS_STATUS_ID = 'sly-lyrics-status';
export const LYRICS_POPOVER_ID = 'sly-lyrics-popover';
const STATUS_CLASSES = ['sly-chip-searching', 'sly-chip-notfound', 'sly-chip-info'];
const TICK_MS = 500;

let steppedAside = false;
let ticker: ReturnType<typeof setInterval> | null = null;

const lyricsOption = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]');

/** True while the user has chosen another media option over our lyrics. */
export const isLyricsSteppedAside = (): boolean => steppedAside;

/** Our root showing lyrics (not a status notice) inside Spotify's overlay (its slot or a layer). */
function overlayLyricsRoot(): HTMLElement | null {
  const root = document.getElementById('lyrics-root-sync');
  const overlay = getNowPlayingOverlay();
  if (!root || !overlay || !overlay.contains(root) || root.classList.contains('sly-root-notice')) return null;
  return root;
}

/**
 * Spotify marks its selected media option with one extra class (it draws the indicator):
 * the difference between a checked and an unchecked option of the switch.
 */
function selectedClasses(option: HTMLElement): string[] {
  const radios = Array.from(option.parentElement?.querySelectorAll<HTMLElement>(':scope > button[role="radio"]') ?? []);
  const checked = radios.find((r) => r.getAttribute('aria-checked') === 'true');
  const unchecked = radios.find((r) => r.getAttribute('aria-checked') !== 'true');
  if (!checked || !unchecked) return [];
  const base = new Set(Array.from(unchecked.classList));
  return Array.from(checked.classList).filter((c) => !base.has(c));
}

const DESELECTED_ATTR = 'data-sly-deselected';

/** Gives Spotify's selected option its own selection mark back. */
function restoreSpotifySelection(): void {
  document.querySelectorAll<HTMLElement>(`[${DESELECTED_ATTR}]`).forEach((el) => {
    const classes = (el.getAttribute(DESELECTED_ATTR) || '').split(' ').filter(Boolean);
    // Only while Spotify still has it selected; a new choice re-renders its own classes.
    if (el.getAttribute('aria-checked') === 'true') el.classList.add(...classes);
    el.removeAttribute(DESELECTED_ATTR);
  });
}

/** One selected option, as in Spotify's switch: ours while our lyrics show. */
function applySelection(chip: HTMLElement, on: boolean): void {
  const option = lyricsOption();
  if (!option) return;
  restoreSpotifySelection();
  const marks = selectedClasses(option);
  if (marks.length) lastSelectedMarks = marks;
  const use = marks.length ? marks : lastSelectedMarks;
  chip.classList.remove(...lastSelectedMarks);
  if (!on || !use.length) return;
  chip.classList.add(...use);
  const checked = option.parentElement?.querySelector<HTMLElement>(':scope > button[role="radio"][aria-checked="true"]');
  if (checked) {
    checked.setAttribute(DESELECTED_ATTR, use.join(' '));
    checked.classList.remove(...use);
  }
}

let lastSelectedMarks: string[] = [];

function applyState(root: HTMLElement | null, chip: HTMLElement | null): void {
  root?.classList.toggle('sly-stepped-aside', steppedAside);
  // Spotify's artwork and cards (hidden while our lyrics sit in its slot) come back.
  getNowPlayingOverlay()?.classList.toggle('sly-lyrics-on', !steppedAside && !!root?.closest('[data-testid="root"] > div > div'));
  if (chip) {
    chip.setAttribute('aria-pressed', String(!steppedAside));
    applySelection(chip, !steppedAside);
  }
}

function buildChip(option: HTMLButtonElement): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.id = LYRICS_CHIP_ID;
  chip.type = 'button';
  chip.className = option.className; // Spotify's own button look
  chip.setAttribute('aria-label', 'Lyrics (Spotify Karaoke)');
  chip.title = 'Lyrics (Spotify Karaoke)';
  const icon = option.querySelector('svg');
  if (icon) chip.appendChild(icon.cloneNode(true));
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // A status, not lyrics: the button opens its details.
    if (!overlayLyricsRoot() && getLyricsStatus()) {
      togglePopover();
      return;
    }
    steppedAside = false;
    // Place again: Spotify may have swapped the slot's media (Canvas, artist image), and
    // that node must be hidden too, as the artwork was.
    (window as any).slyPrepareContainer?.({ forLyrics: true });
    applyState(document.getElementById('lyrics-root-sync'), chip);
  });
  return chip;
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/** Our button right after Spotify's Lyrics option (rebuilt if Spotify re-rendered the switch). */
function placeChip(option: HTMLButtonElement): HTMLButtonElement {
  let chip = document.getElementById(LYRICS_CHIP_ID) as HTMLButtonElement | null;
  if (!chip || chip.previousElementSibling !== option) {
    chip?.remove();
    chip = buildChip(option);
    option.insertAdjacentElement('afterend', chip);
  }
  return chip;
}

/** The status look on our button (none: its plain look). */
function setChipStatus(chip: HTMLElement | null, status: LyricsStatus | null): void {
  if (!chip) return;
  chip.classList.remove(...STATUS_CLASSES);
  if (status) chip.classList.add(status.kind === 'searching' ? 'sly-chip-searching' : status.kind === 'notFound' ? 'sly-chip-notfound' : 'sly-chip-info');
  const name = status ? `Lyrics (Spotify Karaoke): ${status.label}` : 'Lyrics (Spotify Karaoke)';
  if (chip.getAttribute('aria-label') !== name) {
    chip.setAttribute('aria-label', name);
    chip.title = name;
  }
  if (status) {
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-expanded', String(!!document.getElementById(LYRICS_POPOVER_ID)));
  } else {
    chip.removeAttribute('aria-haspopup');
    chip.removeAttribute('aria-expanded');
  }
}

/** The few words beside Spotify's media switch (a live region: screen readers announce changes). */
function placeLabel(option: HTMLButtonElement, status: LyricsStatus): void {
  const group = option.parentElement;
  const row = group?.parentElement;
  if (!group || !row) return;
  let label = document.getElementById(LYRICS_STATUS_ID);
  if (!label || label.nextElementSibling !== group) {
    label?.remove();
    label = document.createElement('div');
    label.id = LYRICS_STATUS_ID;
    label.setAttribute('role', 'status');
    label.setAttribute('aria-live', 'polite');
    label.addEventListener('click', (e) => { e.stopPropagation(); togglePopover(); });
    row.insertBefore(label, group);
  }
  label.dataset.kind = status.kind;
  if (label.textContent !== status.label) label.textContent = status.label;
}

function removeStatusUi(): void {
  document.getElementById(LYRICS_STATUS_ID)?.remove();
  closePopover();
}

/** Opens or closes the status details under our button. */
function togglePopover(): void {
  if (document.getElementById(LYRICS_POPOVER_ID)) closePopover();
  else openPopover();
}

function closePopover(): void {
  document.getElementById(LYRICS_POPOVER_ID)?.remove();
  document.getElementById(LYRICS_CHIP_ID)?.setAttribute('aria-expanded', 'false');
}

function openPopover(): void {
  const status = getLyricsStatus();
  const chip = document.getElementById(LYRICS_CHIP_ID);
  if (!status || !chip) return;
  const pop = document.createElement('div');
  pop.id = LYRICS_POPOVER_ID;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Spotify Karaoke');
  const title = document.createElement('div');
  title.className = 'sly-pop-title';
  title.textContent = status.message;
  const text = document.createElement('div');
  text.className = 'sly-pop-text';
  text.textContent = status.subtext;
  pop.append(title, text);
  if (status.actions.length) {
    const row = document.createElement('div');
    row.className = 'sly-pop-actions';
    for (const action of status.actions) {
      const el = action.href ? document.createElement('a') : document.createElement('button');
      el.className = action.primary ? 'sly-pop-primary' : 'sly-pop-secondary';
      el.textContent = action.label;
      if (el instanceof HTMLAnchorElement) {
        el.href = action.href!;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      } else {
        el.type = 'button';
      }
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (action.run) { e.preventDefault(); action.run(); }
        closePopover();
      });
      row.appendChild(el);
    }
    pop.appendChild(row);
  }
  document.body.appendChild(pop);
  positionPopover(pop, chip);
  chip.setAttribute('aria-expanded', 'true');
  (pop.querySelector('a, button') as HTMLElement | null)?.focus({ preventScroll: true });
}

/** Under the button, right-aligned with it, kept inside the window. */
function positionPopover(pop: HTMLElement, chip: Element): void {
  const r = chip.getBoundingClientRect();
  const width = pop.offsetWidth || 320;
  const left = Math.max(16, Math.min(r.right - width, window.innerWidth - width - 16));
  pop.style.top = `${Math.round(r.bottom + 8)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

/**
 * Keeps the button and our root in line with the current state. Called when a takeover
 * goes live or the status changes, then every TICK_MS while Spotify's overlay is open.
 * Returns true when the current status is on show on our button.
 */
export function syncLyricsChip(): boolean {
  const option = lyricsOption();
  const root = document.getElementById('lyrics-root-sync');
  if (!option || !getNowPlayingOverlay()) {
    // The overlay closed: forget the choice, like Spotify does.
    document.getElementById(LYRICS_CHIP_ID)?.remove();
    removeStatusUi();
    root?.classList.remove('sly-stepped-aside');
    steppedAside = false;
    restoreSpotifyContent();
    stopTicker();
    return false;
  }
  const lyricsRoot = overlayLyricsRoot();
  const status = getLyricsStatus();
  let shown = false;
  if (lyricsRoot && option.disabled) {
    // Our lyrics are on show: the button selects them.
    removeStatusUi();
    const chip = placeChip(option);
    setChipStatus(chip, null);
    applyState(lyricsRoot, chip);
  } else if (!lyricsRoot && status && option.disabled) {
    // Still looking, or nothing found: the button and a few words beside it say so.
    const chip = placeChip(option);
    applySelection(chip, false);
    chip.setAttribute('aria-pressed', 'false');
    setChipStatus(chip, status);
    placeLabel(option, status);
    const pop = document.getElementById(LYRICS_POPOVER_ID);
    if (pop) positionPopover(pop, chip);
    shown = true;
  } else {
    // No lyrics of ours on show, or Spotify has its own lyrics again: its option is back.
    const chip = document.getElementById(LYRICS_CHIP_ID);
    if (chip) restoreSpotifySelection();
    chip?.remove();
    removeStatusUi();
    root?.classList.remove('sly-stepped-aside');
    // Spotify's own mode choice governs again once it has lyrics.
    if (!option.disabled) steppedAside = false;
    if (!lyricsRoot) restoreSpotifyContent();
  }
  if (!ticker) ticker = setInterval(syncLyricsChip, TICK_MS);
  return shown;
}

// The popover closes on a click elsewhere or Escape.
document.addEventListener('click', (e: Event) => {
  const pop = document.getElementById(LYRICS_POPOVER_ID);
  if (!pop) return;
  const t = e.target as Node | null;
  if (t && (pop.contains(t) || document.getElementById(LYRICS_CHIP_ID)?.contains(t) || document.getElementById(LYRICS_STATUS_ID)?.contains(t))) return;
  closePopover();
}, true);
// Escape closes only the popover (the topmost thing), never Spotify's view under it:
// window capture runs before Spotify's own key handlers.
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || !document.getElementById(LYRICS_POPOVER_ID)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  closePopover();
  (document.getElementById(LYRICS_CHIP_ID) as HTMLElement | null)?.focus();
}, true);

// Spotify's other media options step our lyrics aside (capture: before React handles it).
document.addEventListener('click', (e: Event) => {
  const radio = (e.target as HTMLElement | null)?.closest?.('button[role="radio"]') as HTMLButtonElement | null;
  if (!radio) return;
  const option = lyricsOption();
  if (!option || radio.parentElement !== option.parentElement) return;
  restoreSpotifySelection(); // Spotify's own choice: its own selection mark
  if (radio === option) { steppedAside = false; return; } // the user chose Spotify's Lyrics
  const root = overlayLyricsRoot();
  if (!root) return;
  steppedAside = true;
  applyState(root, document.getElementById(LYRICS_CHIP_ID));
}, true);

/** Spotify's Now Playing content back as it was (same as domEngine.slyRestoreOverlayContent). */
function restoreSpotifyContent(): void {
  restoreSpotifySelection();
  document.querySelectorAll('[data-sly-hide]').forEach(el => el.removeAttribute('data-sly-hide'));
  document.querySelectorAll('.sly-lyrics-on').forEach(el => el.classList.remove('sly-lyrics-on'));
}

/** Test hook. */
export function resetLyricsChip(): void {
  stopTicker();
  steppedAside = false;
  document.getElementById(LYRICS_CHIP_ID)?.remove();
  removeStatusUi();
}
