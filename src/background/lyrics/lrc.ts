import type { LyricLine } from '../../shared/types';

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parses LRC text: "[01:02.34]line". Lines with several timestamps are repeated. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times: number[] = [];
    let last = 0;
    TIME.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME.exec(raw)) && m.index === last) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
      times.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + frac);
      last = TIME.lastIndex;
    }
    if (!times.length) continue;
    const text = raw.slice(last).trim();
    for (const t of times) out.push({ startMs: t, text });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export function plainLines(text: string): LyricLine[] {
  return text.split(/\r?\n/).map((t) => ({ startMs: 0, text: t.trim() }));
}
