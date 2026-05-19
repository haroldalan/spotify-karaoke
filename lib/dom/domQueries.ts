export const getLyricsLines = (): Element[] =>
  Array.from(document.querySelectorAll('[data-testid="lyrics-line"] > div'))
    .filter(el => !el.closest('#lyrics-root-sync'));

export const getLyricsContainer = (): Element | null => {
  const first = Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
    .find(el => !el.closest('#lyrics-root-sync'));
  return first?.parentElement ?? null;
};

export const getLyricsViewRoot = (): Element | null => {
  // Try to find the main scrollable container where lyrics are rendered
  const scavenged = window.SPOTIFY_CLASSES?.mainContainer;
  if (scavenged) return document.querySelector(`main.${scavenged}`);
  
  // Robust Fallback: find any main element that houses the native lyrics variables
  return document.querySelector('main div[style*="--lyrics-color-active"]:not(#lyrics-root-sync)')?.closest('main') ?? null;
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


