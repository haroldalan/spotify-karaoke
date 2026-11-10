// Shape checks for what the page script sends. The page world is Spotify's: anything there
// can post messages, so the content script accepts only well-formed, bounded requests.
import type { TrackMeta } from './types';

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const strs = (v: unknown, n: number, max: number): v is string[] => Array.isArray(v) && v.length <= n && v.every((x) => str(x, max));

export function isTrackMeta(v: unknown): v is TrackMeta {
  const m = v as TrackMeta;
  return (
    !!m && typeof m === 'object' &&
    typeof m.id === 'string' && /^[0-9A-Za-z]{22}$/.test(m.id) &&
    str(m.name, 500) && m.name.length > 0 &&
    strs(m.artists, 30, 300) &&
    str(m.album, 500) &&
    typeof m.durationMs === 'number' && m.durationMs >= 0 && m.durationMs < 6 * 3600_000 &&
    strs(m.languages, 10, 20) &&
    typeof m.hasLyrics === 'boolean' &&
    (m.isrc === undefined || str(m.isrc, 20))
  );
}

export interface NativeRequestShape {
  meta: TrackMeta;
  lines: string[];
  times: number[];
  synced: boolean;
}

export function isNativeRequest(v: unknown): v is NativeRequestShape {
  const r = v as NativeRequestShape;
  return (
    !!r && typeof r === 'object' &&
    isTrackMeta(r.meta) &&
    strs(r.lines, 2000, 1000) &&
    Array.isArray(r.times) && r.times.length === r.lines.length && r.times.every((t) => typeof t === 'number' && t >= 0) &&
    typeof r.synced === 'boolean'
  );
}
