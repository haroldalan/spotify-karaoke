/**
 * The extension's lyrics status for the current song, kept apart from where it is drawn.
 *
 * StatusEngine decides the status (searching, not found, found-but-not-shown) and the
 * place: inside Spotify's lyrics panel it draws its full status screen; in Spotify's
 * expanded Now Playing view (a song Spotify has no lyrics for: its artwork and cards fill
 * the view) it sets this record, which the extension's Lyrics button in Spotify's media
 * switch shows (lyricsChip.ts: spinner, short label, popover with the actions). Nothing is
 * drawn over Spotify's content. Without that switch, a toast says it.
 */

export type LyricsStatusKind = 'searching' | 'notFound' | 'info';

export interface LyricsStatusAction {
  label: string;
  /** A link (opened in a new tab), or… */
  href?: string;
  /** …a function run on click. */
  run?: () => void;
  primary?: boolean;
}

export interface LyricsStatus {
  kind: LyricsStatusKind;
  /** The track the status is about. */
  uri: string;
  /** A few words beside the Lyrics button ("Finding lyrics…"). */
  label: string;
  /** The popover's first line, and the toast's text. */
  message: string;
  subtext: string;
  actions: LyricsStatusAction[];
}

let current: LyricsStatus | null = null;

export const getLyricsStatus = (): LyricsStatus | null => current;

/** Same status as now (actions compared by label and link: their functions are rebuilt each time). */
export function sameLyricsStatus(a: LyricsStatus | null, b: LyricsStatus | null): boolean {
  const key = (s: LyricsStatus | null) => s && JSON.stringify([s.kind, s.uri, s.label, s.message, s.subtext,
    s.actions.map(x => [x.label, x.href ?? '', !!x.primary])]);
  return key(a) === key(b);
}

/** Replaces the status (null: none). Returns true when it changed. */
export function setLyricsStatus(next: LyricsStatus | null): boolean {
  const changed = !sameLyricsStatus(current, next);
  // Keep the newest actions (their functions close over the latest track data).
  current = next;
  return changed;
}
