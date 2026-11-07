// Panel-aware queries for Spotify's 2026 UI (clean-DOM verified, no extension installed).
// Full lyrics panel: DIV#main > DIV[data-testid="root"] … overlay … > DIV[style*="--lyrics-color-active"]
//   (themed container > list > [data-testid="lyrics-line"] rows, NO aside ancestor, NOT inside <main>).
// NPV preview: aside#Desktop_PanelContainer_Id[aria-label="Now playing view"] > [data-testid="lyrics-npv-section"].
// Rule: preview lives in aside; full panel never does. Exclude aside lines entirely.
// There is no element with id="root"; the app root is [data-testid="root"].
// 2026-11: the now-playing widget is [data-testid="now-playing-widget-v2"] (was "now-playing-widget").

/** Now-playing widget in the bar: 2026-11 testid first, then the older one. */
export const NOW_PLAYING_WIDGET =
  '[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]';

/** The Now Playing view sidebar and its lyrics preview card (locale-independent selectors first). */
const NPV_PREVIEW =
  '#Desktop_PanelContainer_Id, [data-testid="lyrics-npv-section"], aside[aria-label="Now playing view"], aside.NowPlayingView';

const PREVIEW_ANCESTORS =
  `${NPV_PREVIEW}, [data-testid="now-playing-bar"], footer, ${NOW_PLAYING_WIDGET}`;

export const isPreviewLine = (el: Element): boolean =>
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

/** Themed panel container carrying --lyrics-color-* variables.
 * Excludes NPV preview: preview lives in aside, full panel never does. */
export const getThemedPanelContainer = (): Element | null => {
  const candidates = Array.from(
    document.querySelectorAll('div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)')
  ).filter(el => !el.closest(NPV_PREVIEW));
  return candidates[0] ?? null;
};

/** App root of the 2026 UI. There is no #root element any more. */
export const getAppRoot = (): Element | null =>
  document.querySelector('[data-testid="root"]');

/**
 * Root the viewport MutationObserver binds to: div#main, which contains both the
 * playlist <main> and the lyrics overlay. The bare <main> tag is only a legacy
 * fallback; in the 2026 UI it holds the playlist page and never the lyrics.
 */
export const getViewportRoot = (): Element | null =>
  document.querySelector('div#main') ?? document.querySelector('main');

/**
 * K11: the element that carries the "sly-active" / "sly-hud-active" layout classes:
 * the themed panel container's parent, or the legacy main.<mainContainer> when no
 * themed container exists. Every add/check/remove of those classes uses this element.
 */
export const getSlyLayoutHost = (): HTMLElement | null => {
  const themed = getThemedPanelContainer();
  if (themed?.parentElement) return themed.parentElement;
  const mainCls = window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS';
  return document.querySelector<HTMLElement>(`main.${mainCls}`);
};

export const getLyricsPanelRoot = (): Element | null =>
  getThemedPanelContainer() ??
  getAppRoot() ??
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

  const root = getAppRoot();
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
  document.querySelector(NOW_PLAYING_WIDGET)
    ?.getAttribute('aria-label') ?? '';

// `\s` covers NBSP (U+00A0), U+202F, U+2000-U+200A and the ideographic space (U+3000).
const normalizeTitle = (s: string): string =>
  s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * True when two track titles name the same track once both are normalised the same
 * way (NFC, whitespace runs collapsed, trimmed, lowercased). The widget title is
 * whitespace-collapsed while the bridge's fiber `name` is raw, so never compare them
 * with `!==`. Empty titles never match.
 */
export const titlesMatch = (a: string, b: string): boolean =>
  !!a && !!b && normalizeTitle(a) === normalizeTitle(b);

/**
 * Title of the playing track as shown in the now-playing widget. Prefers the
 * title link (data, not localized UI text): the album link's text is the TRACK
 * title in both the 2026-10 and 2026-11 widgets. Falls back to parsing the
 * widget's "Now playing: <title> by <artists>" aria-label (English UI only).
 */
export const getNowPlayingTitle = (): string => {
  const widget = document.querySelector(NOW_PLAYING_WIDGET);
  if (!widget) return '';
  const titleEl =
    widget.querySelector('[data-testid="context-item-link"], [data-testid="context-item-info-title"]') ??
    widget.querySelector('a[href^="/album/"]');
  const fromLink = titleEl?.textContent?.replace(/\s+/g, ' ').trim();
  if (fromLink) return fromLink;
  const label = widget.getAttribute('aria-label') ?? '';
  return label.replace(/^Now playing:\s*/, '').split(' by ')[0]?.trim() ?? '';
};

const NPV_TRACK_LINK =
  'aside[aria-label="Now playing view"] a[href*="uri=spotify:track:"], ' +
  'aside.NowPlayingView a[href*="uri=spotify:track:"], ' +
  '#Desktop_PanelContainer_Id a[href*="uri=spotify:track:"]';

/**
 * Spotify track id (base62) of the playing track, or null when it cannot be
 * established for the track the widget is showing.
 *  1. Legacy: a /track/ or spotify:track: link inside the now-playing widget.
 *  2. 2026-10 UI: the Now Playing view's "playing from" link (?uri=spotify:track:ID).
 *  3. The MAIN-world bridge mirror (spotifyState.track.uri), only when its track
 *     name matches the widget title — the bridge lags the widget by up to ~500ms
 *     and must never hand out the previous track's id. In the 2026-11 UI no DOM
 *     element carries the track id; the bridge reads it from the React fiber
 *     (entityUri), so this is the only source there.
 */
export const getNowPlayingTrackId = (): string | null => {
  const widget = document.querySelector(NOW_PLAYING_WIDGET);
  if (widget) {
    const link = widget.querySelector<HTMLAnchorElement>('a[href*="/track/"], a[href*="spotify:track:"]');
    const match = (link?.getAttribute('href') || '').match(/track[:/]([A-Za-z0-9]+)/);
    if (match) return match[1];
  }

  const npvLink = document.querySelector<HTMLAnchorElement>(NPV_TRACK_LINK);
  const npvId = (npvLink?.getAttribute('href') || '').match(/uri=spotify(?::|%3A)track(?::|%3A)([A-Za-z0-9]+)/i)?.[1] ?? null;

  const track = (window as any).spotifyState?.track as { uri?: unknown; name?: unknown } | null | undefined;
  const uri = typeof track?.uri === 'string' ? track.uri : '';
  const name = typeof track?.name === 'string' ? track.name : '';
  const widgetTitle = getNowPlayingTitle();
  const bridgeId = uri.match(/^spotify:track:([A-Za-z0-9]+)$/)?.[1] ?? null;
  const bridgeMatchesWidget = !!bridgeId && titlesMatch(name, widgetTitle);

  if (npvId) {
    // Both sources claim the widget's track but disagree (e.g. two tracks with
    // the same title, one source lagging): the id is ambiguous. Unknown is
    // safer than loading another track's canonical hash.
    if (bridgeMatchesWidget && bridgeId !== npvId) return null;
    return npvId;
  }
  return bridgeMatchesWidget ? bridgeId : null;
};
