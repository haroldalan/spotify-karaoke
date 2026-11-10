// window.postMessage channel between the page script (MAIN world) and the content script
// (isolated world). Both start at document_start in either order, so each side announces
// itself and the page holds its messages until the content script has answered.
export const TAG = 'spotify-karaoke-next';

export type Up =
  | { tag: typeof TAG; dir: 'up'; kind: 'hello' }
  | { tag: typeof TAG; dir: 'up'; kind: 'event'; type: string; data: unknown }
  | { tag: typeof TAG; dir: 'up'; kind: 'call'; id: number; type: string; data: unknown };

export type Down =
  | { tag: typeof TAG; dir: 'down'; kind: 'ready'; data: PageConfig }
  | { tag: typeof TAG; dir: 'down'; kind: 'config'; data: PageConfig }
  | { tag: typeof TAG; dir: 'down'; kind: 'reply'; id: number; data: unknown };

/** What the page script needs to know from the extension. */
export interface PageConfig {
  /** Tracks the listener sent back to Spotify ("Not this song"): leave them as Spotify has them. */
  spotifyOnly: string[];
}

/** Where a song's lyrics on screen came from. */
export type LyricsKind = 'spotify' | 'found' | 'restored' | 'upgraded';

export function isUp(data: unknown): data is Up {
  return !!data && (data as Up).tag === TAG && (data as Up).dir === 'up';
}

export function isDown(data: unknown): data is Down {
  return !!data && (data as Down).tag === TAG && (data as Down).dir === 'down';
}
