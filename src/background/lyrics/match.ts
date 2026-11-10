// Does a search result describe the song Spotify is playing?

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s*[-\u2013\u2014]\s*(from|feat\.?|ft\.?|remaster(ed)?|live|radio edit|single version|mono|stereo)\b.*$/i, '')
    .replace(/\s*[([\uFF08\u3010][^)\]\uFF09\u3011]*(feat|ft\.|from|remaster|version|edit|live|original|soundtrack|ost)[^)\]\uFF09\u3011]*[)\]\uFF09\u3011]/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function normalizeArtist(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const tokens = (s: string) => new Set(s.split(' ').filter(Boolean));

function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / (A.size + B.size - n);
}

export function titleScore(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  return jaccard(x, y);
}

/** Best match between any of Spotify's artists and the candidate's artist string. */
export function artistScore(artists: string[], candidate: string): number {
  const c = normalizeArtist(candidate);
  let best = 0;
  for (const a of artists) {
    const n = normalizeArtist(a);
    if (!n || !c) continue;
    if (n === c || c.includes(n) || n.includes(c)) return 1;
    best = Math.max(best, jaccard(n, c));
  }
  return best;
}

export const DURATION_TOLERANCE_S = 3;

export function durationOk(spotifyMs: number, candidateS: number | null | undefined): boolean {
  if (!spotifyMs || candidateS == null || !Number.isFinite(candidateS)) return true;
  return Math.abs(spotifyMs / 1000 - candidateS) <= DURATION_TOLERANCE_S;
}

/**
 * A title that names a version without the singing: "(Instrumental)", "Karaoke", "Off Vocal",
 * "Backing Track", "Minus One", カラオケ, オフボーカル.
 */
export function isInstrumentalTitle(s: string): boolean {
  return /\b(instrumental|instr\.|inst\.|karaoke|off[\s-]?vocal|backing\s+track|minus\s+one)(?![\p{L}])/iu.test(s) || /カラオケ|オフボーカル|オリジナル・カラオケ/u.test(s);
}

export function isMatch(meta: { name: string; artists: string[]; durationMs: number }, c: { title: string; artist: string; durationS?: number | null }): boolean {
  // A song and its instrumental version share a title once the brackets go, and often a length:
  // never one for the other (the vocal song isn't an instrumental; the instrumental has no words).
  if (isInstrumentalTitle(meta.name) !== isInstrumentalTitle(c.title)) return false;
  return titleScore(meta.name, c.title) >= 0.8 && artistScore(meta.artists, c.artist) >= 0.5 && durationOk(meta.durationMs, c.durationS);
}

/** "4:11" / "1:02:03" -> seconds. */
export function parseClock(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return (Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3]);
}
