export const getLyricsLines = (): Element[] =>
  Array.from(document.querySelectorAll('[data-testid="lyrics-line"] > div'));

export const getLyricsContainer = (): Element | null =>
  document.querySelector('[data-testid="lyrics-line"]')?.parentElement ?? null;

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

export const hasLyrics = (): boolean =>
  document.querySelector('[data-testid="lyrics-button"]:not([disabled])') !== null;
