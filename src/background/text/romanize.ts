// Romanization, routed by script, line by line. Local engines first (instant, offline);
// Google's romanization for scripts without a good local engine (Arabic-script languages,
// Hebrew, ...), and for Japanese lines the dictionary can't read. Generic transliteration
// is the last resort.
import { pinyin } from 'pinyin-pro';
import { romanize as romanizeHangul } from '@romanize/korean';
import CyrillicToTranslit from 'cyrillic-to-translit-js';
import { romanize as romanizeTamil } from 'tamil-romanizer';
import { transliterate } from 'transliteration';
import { charScript, lineHas, type Script } from '../../shared/scripts';
import { romanizeIndic, supportsIndic } from './indic';
import { romanizeJapanese } from './japanese';
import { romanizeThaiLine } from './thai';

/** Scripts Google romanizes better than any local engine we have. */
export const GOOGLE_PREFERRED = new Set<Script>(['Arab', 'Hebr', 'Laoo', 'Khmr', 'Mymr', 'Sinh', 'Ethi']);

const ru = new CyrillicToTranslit();
const uk = new CyrillicToTranslit({ preset: 'uk' });

function stripMarks(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036F]/g, '').normalize('NFC');
}

/** A kanji left in a Japanese romanization: the dictionary had no reading for it. */
const UNREAD_KANJI = /\p{Script=Han}/u;

export interface RomanizeDeps {
  /** Google romanization for lines; null when unavailable. */
  google: (lines: string[]) => Promise<(string | null)[] | null>;
}

/** Japanese: local by word; Google for lines with an unread kanji, or all lines without the dictionary. */
async function japanese(lines: string[], deps: RomanizeDeps): Promise<(string | null)[] | null> {
  let local: string[];
  try {
    local = await romanizeJapanese(lines);
  } catch {
    return deps.google(lines).catch(() => null);
  }
  const unread = local.flatMap((r, i) => (UNREAD_KANJI.test(r) ? [i] : []));
  if (!unread.length) return local;
  const google = await deps.google(unread.map((i) => lines[i])).catch(() => null);
  if (google) unread.forEach((i, k) => { if (google[k]) local[i] = google[k]!; });
  return local;
}

/** Local romanization for one script; null when no local engine handles it. */
async function localLines(lines: string[], script: Script, deps: RomanizeDeps): Promise<(string | null)[] | null> {
  switch (script) {
    case 'Jpan':
      return japanese(lines, deps);
    case 'Hani':
      return lines.map((l) => pinyin(l, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' }).replace(/\s{2,}/g, ' ').trim());
    case 'Kore':
      // The library throws on anything outside its ranges (emoji, "…"): romanize Hangul runs only.
      return lines.map((l) => l.replace(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]+/g, (run) => romanizeHangul(run)));
    case 'Cyrl':
      return lines.map((l) => (/[\u0454\u0457\u0456\u0491\u0404\u0407\u0406\u0490]/.test(l) ? uk : ru).transform(l));
    case 'Taml':
      return lines.map((l) => romanizeTamil(l));
    case 'Thai':
      return lines.map((l) => romanizeThaiLine(l));
    case 'Grek': case 'Geor': case 'Armn':
      return lines.map((l) => transliterate(l));
    default:
      if (supportsIndic(script)) return lines.map((l) => romanizeIndic(l, script));
      return null;
  }
}

/**
 * The script a line is romanized as: the song's script when the line has it, otherwise
 * the line's own main non-Latin script (a Japanese line in a K-pop song). null: nothing
 * to romanize (English lines, numbers).
 */
export function lineScript(line: string, songScript: Script): Script | null {
  // A Japanese line in a Chinese song: read as Japanese, not as pinyin.
  if (songScript === 'Hani' && /[\u3041-\u3096\u30A1-\u30FA]/.test(line)) return 'Jpan';
  if (songScript !== 'Latn' && songScript !== 'Other' && lineHas(line, songScript)) return songScript;
  const counts = new Map<Script, number>();
  let kana = false;
  for (const ch of line) {
    const s = charScript(ch);
    if (!s || s === 'Latn') continue;
    if (s === 'Jpan') kana = true;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (kana && counts.has('Hani')) {
    counts.set('Jpan', (counts.get('Jpan') ?? 0) + counts.get('Hani')!);
    counts.delete('Hani');
  }
  let best: Script | null = null;
  let n = 0;
  for (const [s, c] of counts) if (c > n) { best = s; n = c; }
  return best;
}

/**
 * complete: false when the result is a stopgap worth replacing later (generic
 * transliteration, Google unreachable for a script that needs it, kanji left unread).
 */
async function romanizeGroup(lines: string[], script: Script, deps: RomanizeDeps): Promise<{ result: (string | null)[]; complete: boolean }> {
  let result: (string | null)[] | null = null;
  if (GOOGLE_PREFERRED.has(script)) {
    result = await deps.google(lines).catch(() => null);
    // Google answered but has no romanization for this language: generic transliteration is
    // the answer, and it is final (asking again gets the same nothing).
    if (result && !result.some(Boolean)) return { result: lines.map((l) => transliterate(l)), complete: true };
    if (result) result = result.map((r) => (r ? stripMarks(r) : r));
  }
  if (!result) {
    try {
      result = await localLines(lines, script, deps);
    } catch {
      result = null;
    }
  }
  if (!result) result = await deps.google(lines).catch(() => null);
  if (!result) return { result: lines.map((l) => transliterate(l)), complete: false };
  // Japanese with a kanji still unread means Google couldn't be asked: worth another try.
  const complete = !(script === 'Jpan' && result.some((r) => r && UNREAD_KANJI.test(r)));
  return { result, complete };
}

/** Romanizes a song's lines. Lines with nothing to romanize stay null. */
export async function romanizeLines(lines: string[], songScript: Script, deps: RomanizeDeps): Promise<(string | null)[]> {
  return (await romanizeLinesDetailed(lines, songScript, deps)).lines;
}

/** romanizeLines, also saying whether the result is final (see romanizeGroup). */
export async function romanizeLinesDetailed(lines: string[], songScript: Script, deps: RomanizeDeps): Promise<{ lines: (string | null)[]; complete: boolean }> {
  let complete = true;
  const out: (string | null)[] = lines.map(() => null);
  const groups = new Map<Script, number[]>();
  lines.forEach((l, i) => {
    const s = lineScript(l, songScript);
    if (s && s !== 'Other') groups.set(s, [...(groups.get(s) ?? []), i]);
  });
  await Promise.all(
    [...groups].map(async ([script, idx]) => {
      const { result, complete: groupComplete } = await romanizeGroup(idx.map((i) => lines[i]), script, deps);
      if (!groupComplete) complete = false;
      idx.forEach((i, k) => {
        const r = result[k]?.trim();
        out[i] = r && r !== lines[i] ? r : null;
      });
    }),
  );
  return { lines: out, complete };
}
