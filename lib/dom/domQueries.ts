// Panel-aware queries for Spotify's 2026 UI (clean-DOM verified, no extension installed).
// Full lyrics panel: DIV#main > DIV#root … > DIV[style*="--lyrics-color-active"]
//   (list DIV.t3jTARRdoLQZ0LowMbxg, line DIV.MFEBmMwUCW5Qmg8VwGim…, 37 lines, NO aside ancestor).
// NPV preview: aside[aria-label="Now playing view"] (parent FOuUnTRQ4vzmdpbFOSWp, 7 lines).
// Rule: preview lives in aside; full panel never does. Exclude aside lines entirely.

const PREVIEW_ANCESTORS =
  'aside[aria-label="Now playing view"], aside.NowPlayingView, [data-testid="now-playing-bar"], footer, [data-testid="now-playing-widget"]';

const isPreviewLine = (el: Element): boolean =>
  !!el.closest(PREVIEW_ANCESTORS);

const getAllNativeLineWrappers = (): Element[] =>
  Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
    .filter(el => !el.closest('#lyrics-root-sync') && !isPreviewLine(el));

/** Group line wrappers by their parent container; pick the largest group. */
const pickPanelLines = (): Element[] => {
  const wrappers = getAllNativeLineWrappers();
  if (wrappers.length === 0) return [];
  const byParent = new Map<Element, Element[]>();
  for (const w of wrappers) {
    const parent = w.parentElement ?? w;
    const list = byParent.get(parent);
    if (list) list.push(w);
    else byParent.set(parent, [w]);
  }
  let best: Element[] = [];
  for (const group of byParent.values()) {
    if (group.length > best.length) best = group;
  }
  return best;
};

export const getLyricsLines = (): Element[] => {
  const panelWrappers = pickPanelLines();
  if (panelWrappers.length === 0) return [];
  // Native inner DIV currently has no class; fall back to wrapper itself.
  const inners: Element[] = [];
  for (const w of panelWrappers) {
    const inner = w.querySelector(':scope > div');
    inners.push((inner ?? w) as Element);
  }
  return inners;
};

export const getLyricsContainer = (): Element | null => {
  const panelWrappers = pickPanelLines();
  if (panelWrappers.length === 0) return null;
  return panelWrappers[0].parentElement ?? null;
};

/** Themed panel container carrying --lyrics-color-* variables (bm5I7yGVN8NXt6vH9eiC…).
 * Excludes NPV preview: preview lives in aside, full panel never does. */
export const getThemedPanelContainer = (): Element | null => {
  const candidates = Array.from(
    document.querySelectorAll('div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)')
  ).filter(el => !el.closest('aside[aria-label="Now playing view"], aside.NowPlayingView'));
  return candidates[0] ?? null;
};

export const getLyricsPanelRoot = (): Element | null =>
  getThemedPanelContainer() ??
  document.querySelector('div#root') ??
  document.querySelector('div#main') ??
  null;

export const isLyricsButtonActive = (): boolean => {
  const btn = document.querySelector('[data-testid="lyrics-button"]');
  return btn?.getAttribute('data-active') === 'true' || btn?.getAttribute('aria-pressed') === 'true';
};

export const getLyricsViewRoot = (): Element | null => {
  // Themed container first (holds the variables slyMirrorNativeTheme steals).
  // Must exclude NPV preview (aside) — otherwise root is always non-null and
  // HUD/takeover fire while the lyrics panel is closed.
  const themed = getThemedPanelContainer();
  if (themed) return themed;

  const hasPanelLines = getLyricsLines().length > 0;
  if (!hasPanelLines && !isLyricsButtonActive()) return null;

  const root = document.querySelector('div#root');
  if (root?.querySelector('[data-testid="lyrics-line"]')) return root;

  const appMain = document.querySelector('div#main');
  if (appMain?.querySelector('[data-testid="lyrics-line"]')) return appMain;

  // Legacy <main> tag fallback (playlist route, pre-2026).
  const scavenged = window.SPOTIFY_CLASSES?.mainContainer;
  if (scavenged) {
    const scoped = document.querySelector(`main.${scavenged}`);
    if (scoped?.querySelector('[data-testid="lyrics-line"]')) return scoped;
  }

  // Button active but lines not yet rendered — return shell so pill has a target.
  if (isLyricsButtonActive()) return root ?? appMain ?? document.querySelector('main');
  return null;
};

export const getNowPlayingKey = (): string =>
  document.querySelector('[data-testid="now-playing-widget"]')
    ?.getAttribute('aria-label') ?? '';

export const getNowPlayingTrackId = (): string | null => {
  const widget = document.querySelector('[data-testid="now-playing-widget"]');
  if (!widget) return null;
  const link = widget.querySelector<HTMLAnchorElement>('a[href*="/track/"], a[href*="spotify:track:"]');
  if (!link) return null;
  const href = link.getAttribute('href') || '';
  const match = href.match(/track[:/]([A-Za-z0-9]+)/);
  return match ? match[1] : null;
};
