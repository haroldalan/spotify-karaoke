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

/**
 * The previous song's slide while Spotify slides it out (songTransition.ts): "ours" when
 * a still copy of our lyrics leaves on it (Spotify's panel under it stays hidden).
 * Nothing in a leaving slide is the current song's: the queries below skip it.
 */
export const LEAVING_SLIDE_ATTR = 'data-sly-leaving';
/** The still copy of our lyrics on a leaving slide. */
export const LEAVING_ROOT_ATTR = 'data-sly-root-leaving';
export const isInLeavingSlide = (el: Element): boolean => !!el.closest(`[${LEAVING_SLIDE_ATTR}]`);

/**
 * Which song each lyrics panel belongs to. Spotify can keep earlier songs' panels mounted
 * next to the current one (live 2026-11-08: five panels, three off-screen to the left, one
 * transparent), and none of them is marked as old. The page bridge (slyBridge.ts) reads each
 * panel's track from Spotify's React props (the list's `trackUri`, the themed container's
 * `item.uri`) and writes it on the element; it writes the playing track, from the
 * now-playing widget, on <html>. Attributes are shared with the content script's world.
 */
export const PANEL_TRACK_ATTR = 'data-sly-track-uri';
export const PLAYING_TRACK_ATTR = 'data-sly-playing-uri';

/** The playing track's uri: the bridge's attribute, else the bridge's last state message. */
export const playingTrackUri = (): string =>
  document.documentElement.getAttribute(PLAYING_TRACK_ATTR) ||
  String((window as unknown as { spotifyState?: { track?: { uri?: unknown } } }).spotifyState?.track?.uri ?? '');

/**
 * A filter that drops elements inside another song's lyrics panel. It only filters when
 * panels of two or more songs are mounted (one panel is never ambiguous, and dropping it
 * while the playing uri catches up would empty the view at every song change), and never
 * when the panels carry no tags (no bridge yet, or Spotify renamed the prop): then every
 * element passes, as before tags existed.
 */
export function currentSongOnly(): (el: Element) => boolean {
  const playing = playingTrackUri();
  if (!playing) return () => true;
  const songs = new Set(Array.from(document.querySelectorAll(`[${PANEL_TRACK_ATTR}]`))
    .filter(el => !el.closest(NPV_PREVIEW))
    .map(el => el.getAttribute(PANEL_TRACK_ATTR)));
  if (songs.size < 2) return () => true;
  return (el: Element) => {
    const tagged = el.closest(`[${PANEL_TRACK_ATTR}]`);
    return !tagged || tagged.getAttribute(PANEL_TRACK_ATTR) === playing;
  };
}

const getAllNativeLineWrappers = (): Element[] => {
  const currentSong = currentSongOnly();
  return Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
    .filter(el => !el.closest('#lyrics-root-sync') && !isPreviewLine(el) && !isInLeavingSlide(el) && currentSong(el));
};

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

/**
 * True when a row's inner div still shows Spotify's own text: none of our
 * processed spans and non-empty text. data-sly-original is NOT a marker:
 * snapshotOriginals puts it on native rows, and applyLinesToDOM treats an
 * attribute without spans as a recycled native row.
 */
export const innerNeedsProcessing = (inner: Element): boolean =>
  !inner.querySelector('.sly-main-line, .sly-dual-line') && (inner.textContent ?? '').trim() !== '';

/** innerNeedsProcessing on a [data-testid="lyrics-line"] row (its inner div, or the row itself). */
export const rowNeedsProcessing = (row: Element): boolean =>
  innerNeedsProcessing(row.querySelector(':scope > div') ?? row);

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
  const currentSong = currentSongOnly();
  const candidates = Array.from(
    document.querySelectorAll('div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)')
  ).filter(el => !el.closest(NPV_PREVIEW) && !isInLeavingSlide(el) && currentSong(el));
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
  return getFallbackLayoutHost();
};

/** Spotify's media switch option for lyrics (its value attribute is not localized). */
const lyricsOption = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]');

/**
 * 2026 UI: Spotify's Now Playing overlay, the layer that fills the area above the
 * player bar while the lyrics button is on. Found through its media switch.
 */
export const getNowPlayingOverlay = (): HTMLElement | null => {
  const overlay = lyricsOption()?.closest('[data-testid="root"] > div > div') as HTMLElement | null;
  // Never mistake the app grid for the overlay (one more wrapper level in a future build
  // would make it match): the overlay holds neither the player bar nor the page or sidebar.
  if (!overlay || overlay.querySelector('[data-testid="now-playing-bar"], #main-view, #Desktop_PanelContainer_Id')) return null;
  return overlay;
};

/** True when Spotify's own media switch marks lyrics as unavailable for the current track. */
export const isLyricsOptionDisabled = (): boolean => {
  const option = lyricsOption();
  return !!option && (option.disabled || option.getAttribute('aria-disabled') === 'true');
};

/**
 * Where our root and layout classes go when Spotify shows no themed lyrics panel
 * (e.g. a track without lyrics: the overlay shows artwork). 2026 UI: the overlay,
 * never the app root or the playlist <main> (that put the HUD over the whole page,
 * player bar included). Legacy UI: main.<mainContainer>.
 */
export const getFallbackLayoutHost = (): HTMLElement | null => {
  if (getAppRoot()) return getNowPlayingOverlay();
  const mainCls = window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS';
  return document.querySelector<HTMLElement>(`main.${mainCls}`);
};

export const getLyricsPanelRoot = (): Element | null =>
  getThemedPanelContainer() ??
  getAppRoot() ??
  document.querySelector('div#main') ??
  null;

let lyricsIntentUri: string | null = null;

/**
 * The extension opened Spotify's expanded Now Playing view because the user pressed
 * the lyrics button on a track Spotify has no lyrics for (Spotify then leaves its
 * lyrics button inactive). Until that overlay closes it stands in for the lyrics view.
 */
export const setLyricsIntentOverlay = (on: boolean, uri: string | null = null): void => {
  lyricsIntentUri = on ? (uri ?? String((window as any).spotifyState?.track?.uri ?? '')) : null;
};

/**
 * Only while Spotify marks its lyrics option unavailable for the track playing: when a
 * track with Spotify lyrics plays in that overlay, Spotify's own state (its lyrics button
 * and media switch) decides; later tracks without lyrics in the same overlay count again.
 */
export const isLyricsIntentOverlayOpen = (): boolean =>
  !!lyricsIntentUri && !!lyricsOption() && isLyricsOptionDisabled();

/** The overlay the extension opened (or adopted) for lyrics is still up, whatever the track. */
export const isLyricsIntentSessionActive = (): boolean => !!lyricsIntentUri && !!lyricsOption();

/** The lyrics view is open: Spotify's lyrics button is on, or the lyrics-intent overlay is up. */
export const isLyricsButtonActive = (): boolean => {
  const btn = document.querySelector('[data-testid="lyrics-button"]');
  return btn?.getAttribute('data-active') === 'true' || btn?.getAttribute('aria-pressed') === 'true' ||
    isLyricsIntentOverlayOpen();
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
