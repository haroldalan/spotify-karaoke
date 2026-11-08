/**
 * Opens Spotify's expanded Now Playing view for tracks Spotify has no lyrics for.
 *
 * Before the 2026 UI the bridge's Genetic Lock forced the lyrics button's props
 * (hasLyrics: true, ...) so Spotify's own click opened the lyrics page even without
 * lyrics. The 2026 UI no longer has those props: for such a track the lyrics button
 * does nothing ("Looks like we don't have the lyrics for this song"). Spotify still
 * opens its Now Playing overlay (artwork mode, lyrics option disabled) from the Now
 * Playing sidebar's "Expand" control; with the overlay open the extension fetches its
 * own lyrics (or shows its notice).
 *
 * Spotify's click always runs first: only when the lyrics view did not open does the
 * extension open the expanded view itself, so tracks with lyrics are never touched.
 * The controls are found structurally (the aria-labels are localized):
 * - the sidebar: #Desktop_PanelContainer_Id, opened with the player bar's
 *   [data-testid="cover-art-button"] when it is closed;
 * - "Expand Now Playing view": the button right after the sidebar header's
 *   [data-testid="more-button"], in the same button group.
 */
import { isLyricsButtonActive, isLyricsIntentSessionActive, isLyricsOptionDisabled, setLyricsIntentOverlay } from '../dom/domQueries';

/** How long Spotify gets to open its lyrics view after the click. */
export const NATIVE_OPEN_WAIT_MS = 700;
const SIDEBAR_WAIT_MS = 1500;
const POLL_MS = 100;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Spotify's Now Playing overlay (any mode) or its lyrics view is open. */
export function isNowPlayingViewOpen(): boolean {
  return !!document.querySelector('button[role="radio"][value="lyrics"]') || isLyricsButtonActive();
}

/** The sidebar header's "Expand Now Playing view" button, or null when the sidebar is closed. */
export function findExpandNowPlayingButton(): HTMLButtonElement | null {
  const sidebar = document.getElementById('Desktop_PanelContainer_Id');
  if (!sidebar) return null;
  const more = sidebar.querySelector('[data-testid="more-button"]');
  const group = more?.parentElement;
  if (!more || !group) return null;
  const buttons = Array.from(group.children).filter((el): el is HTMLButtonElement => el.tagName === 'BUTTON');
  const next = buttons[buttons.indexOf(more as HTMLButtonElement) + 1];
  // A plain icon button with no test id of its own, as Spotify renders it today.
  if (!next || next.hasAttribute('data-testid') || !next.querySelector('svg')) return null;
  return next;
}

/**
 * Opens the expanded Now Playing view through Spotify's own controls (opening the
 * sidebar first when needed). Returns whether the expand control was clicked.
 */
export async function openExpandedNowPlayingView(): Promise<boolean> {
  if (isNowPlayingViewOpen()) return false;
  let expand = findExpandNowPlayingButton();
  if (!expand && document.getElementById('Desktop_PanelContainer_Id')) {
    // The sidebar is there but its Expand control is not recognised (Spotify changed it):
    // the cover-art button would only toggle the sidebar closed. Leave Spotify alone.
    console.log('[sly-open] Now Playing sidebar present but its Expand control is not recognised: not opening.');
    return false;
  }
  if (!expand) {
    const cover = document.querySelector<HTMLElement>('[data-testid="cover-art-button"]');
    if (!cover) {
      console.log('[sly-open] No Now Playing sidebar and no cover-art button: cannot open the expanded view.');
      return false;
    }
    cover.click();
    openedSidebar = true;
    for (let waited = 0; waited < SIDEBAR_WAIT_MS && !expand; waited += POLL_MS) {
      await sleep(POLL_MS);
      expand = findExpandNowPlayingButton();
    }
  }
  if (!expand) {
    console.log('[sly-open] Expand control not found in the Now Playing sidebar: not opening.');
    return false;
  }
  if (isNowPlayingViewOpen()) return false;
  console.log('[sly-open] Spotify did not open lyrics for this track; opening its expanded Now Playing view instead.');
  setLyricsIntentOverlay(true);
  expand.click();
  watchIntentOverlayClose();
  return true;
}

let closeWatch: ReturnType<typeof setInterval> | null = null;
/** The extension opened the Now Playing sidebar to reach Expand: close it again afterwards. */
let openedSidebar = false;

/**
 * The overlay header's minimize control: the last button of the group that holds the
 * header's [data-testid="more-button"] (the labels are localized).
 */
export function findMinimizeNowPlayingButton(): HTMLButtonElement | null {
  const option = document.querySelector('button[role="radio"][value="lyrics"]');
  const overlay = option?.closest('[data-testid="root"] > div > div');
  const header = overlay ? Array.from(overlay.children).find((c) => c.contains(option)) : null;
  const more = header?.querySelector('[data-testid="more-button"]');
  const group = more?.parentElement;
  if (!group) return null;
  const buttons = Array.from(group.children).filter((el): el is HTMLButtonElement => el.tagName === 'BUTTON');
  const last = buttons[buttons.length - 1];
  if (!last || last === more || last.hasAttribute('data-testid') || !last.querySelector('svg')) return null;
  return last;
}

/**
 * The lyrics button pressed again while the view the extension opened is up: Spotify's
 * button does nothing for such a track, so close that view with Spotify's own control.
 */
export function closeIntentOverlay(): boolean {
  if (!isLyricsIntentSessionActive()) return false;
  const minimize = findMinimizeNowPlayingButton();
  if (!minimize) {
    console.log('[sly-open] Minimize control not recognised: leaving the expanded view open.');
    return false;
  }
  console.log('[sly-open] Lyrics button pressed again: closing the expanded Now Playing view the extension opened.');
  minimize.click();
  return true;
}

/**
 * Spotify's lyrics button never turns on for this overlay, so the usual close signal
 * (the button losing data-active) never fires: watch the overlay itself and run the
 * same cleanup (sly:panel_close) when the user closes it.
 */
function watchIntentOverlayClose(): void {
  if (closeWatch) clearInterval(closeWatch);
  let seenOpen = false;
  let waited = 0;
  closeWatch = setInterval(() => {
    waited += POLL_MS * 5;
    if (isLyricsIntentSessionActive()) { seenOpen = true; return; }
    if (!seenOpen && waited < SIDEBAR_WAIT_MS * 2) return; // still opening
    clearInterval(closeWatch!);
    closeWatch = null;
    setLyricsIntentOverlay(false);
    if (seenOpen) {
      console.log('[sly-open] Expanded Now Playing view closed.');
      document.dispatchEvent(new CustomEvent('sly:panel_close'));
    }
    if (openedSidebar) {
      openedSidebar = false;
      // Back as the user had it: the sidebar was closed before the extension opened it.
      if (document.getElementById('Desktop_PanelContainer_Id')) document.querySelector<HTMLElement>('[data-testid="cover-art-button"]')?.click();
    }
  }, POLL_MS * 5);
}

let pendingCheck: ReturnType<typeof setTimeout> | null = null;

/**
 * The press was a close: events.ts's pointerdown CLOSE hijack sets this cooldown, and the
 * bridge clears the button's attributes before the click arrives, so the click alone
 * cannot tell a close from an open.
 */
export const isClosingPress = (): boolean =>
  Date.now() < Number((window as any).slyInternalState?.panelIntentCooldown || 0);

/**
 * Spotify's lyrics for the current music track are already known to be missing: its
 * color-lyrics request came back empty (404), a status was saved earlier, or the
 * detector's no-lyrics guess fired (all recorded as nativeStatus MISSING).
 */
export function spotifyKnownToLackLyrics(): boolean {
  const uri = String((window as any).spotifyState?.track?.uri ?? '');
  if (!uri.startsWith('spotify:track:')) return false;
  const entry = (window as any).slyPreFetchRegistry?.getState?.(uri);
  return entry?.nativeStatus === 'MISSING' && entry?.heuristic !== true;
}

/** Spotify's click got its handling time before the extension acts on what it knows. */
const KNOWN_MISSING_WAIT_MS = 150;

/**
 * Called on a click of the (inactive) lyrics button, before Spotify handles it. When
 * Spotify is known to have no lyrics for the track, open the expanded Now Playing view
 * right after its (no-op) click; otherwise give Spotify NATIVE_OPEN_WAIT_MS to open its
 * lyrics view and open the expanded view only if it did not. Music tracks only.
 */
export function openIfSpotifyDoesNot(): void {
  if (pendingCheck) clearTimeout(pendingCheck);
  // A press on the lyrics button while Spotify's own expanded view is already open on a
  // track without lyrics: adopt that view as the lyrics view.
  if (!isLyricsIntentSessionActive() && document.querySelector('button[role="radio"][value="lyrics"]') && isLyricsOptionDisabled()) {
    console.log('[sly-open] Expanded Now Playing view already open on a track without Spotify lyrics: showing lyrics there.');
    setLyricsIntentOverlay(true);
    watchIntentOverlayClose();
    return;
  }
  const delay = spotifyKnownToLackLyrics() ? KNOWN_MISSING_WAIT_MS : NATIVE_OPEN_WAIT_MS;
  pendingCheck = setTimeout(() => {
    pendingCheck = null;
    if (isClosingPress()) return;
    if (isNowPlayingViewOpen()) return;
    const uri = String((window as any).spotifyState?.track?.uri ?? '');
    if (!uri.startsWith('spotify:track:')) return;
    void openExpandedNowPlayingView();
  }, delay);
}

/** Test hook. */
export function cancelPendingOpen(): void {
  if (pendingCheck) clearTimeout(pendingCheck);
  pendingCheck = null;
  if (closeWatch) clearInterval(closeWatch);
  closeWatch = null;
  openedSidebar = false;
  setLyricsIntentOverlay(false);
}
