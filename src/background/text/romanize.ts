// Romanization, routed by script. Local engines first (instant, offline); Google's
// romanization for scripts without a good local engine (Arabic-script languages, Hebrew,
// Thai, ...), with a generic transliteration as the last resort.
import { pinyin } from 'pinyin-pro';
import { romanize as romanizeHangul } from '@romanize/korean';
import CyrillicToTranslit from 'cyrillic-to-translit-js';
import { romanize as romanizeTamil } from 'tamil-romanizer';
import { transliterate } from 'transliteration';
import { lineHas, type Script } from '../../shared/scripts';
import { romanizeIndic, supportsIndic } from './indic';
import { romanizeJapanese } from './japanese';

/** Scripts Google romanizes better than any local engine we have. */
export const GOOGLE_PREFERRED = new Set<Script>(['Arab', 'Hebr', 'Thai', 'Laoo', 'Khmr', 'Mymr', 'Sinh', 'Ethi']);

const ru = new CyrillicToTranslit();
const uk = new CyrillicToTranslit({ preset: 'uk' });

function stripMarks(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

/** Line-level local romanization; null when no local engine handles the script. */
async function localLines(lines: string[], script: Script): Promise<(string | null)[] | null> {
  switch (script) {
    case 'Jpan':
      return romanizeJapanese(lines);
    case 'Hani':
      return lines.map((l) => pinyin(l, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' }).replace(/\s{2,}/g, ' ').trim());
    case 'Kore':
      // The library throws on anything outside its ranges (emoji, "…"): romanize Hangul runs only.
      return lines.map((l) => l.replace(/[가-힯ᄀ-ᇿ㄰-㆏]+/g, (run) => romanizeHangul(run)));
    case 'Cyrl':
      return lines.map((l) => (/[єїіґЄЇІҐ]/.test(l) ? uk : ru).transform(l));
    case 'Taml':
      return lines.map((l) => romanizeTamil(l));
    case 'Grek': case 'Geor': case 'Armn':
      return lines.map((l) => transliterate(l));
    default:
      if (supportsIndic(script)) return lines.map((l) => romanizeIndic(l, script));
      return null;
  }
}

export interface RomanizeDeps {
  /** Google romanization for lines; null when unavailable. */
  google: (lines: string[]) => Promise<(string | null)[] | null>;
}

/**
 * Romanizes a song's lines. Lines without any letters of the song's script are left as
 * they are (null), e.g. English lines in a K-pop song.
 */
export async function romanizeLines(lines: string[], script: Script, deps: RomanizeDeps): Promise<(string | null)[]> {
  const out: (string | null)[] = lines.map(() => null);
  if (script === 'Latn' || script === 'Other') return out;
  const idx = lines.map((l, i) => (lineHas(l, script) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return out;
  const work = idx.map((i) => lines[i]);

  let result: (string | null)[] | null = null;
  if (GOOGLE_PREFERRED.has(script)) {
    result = await deps.google(work).catch(() => null);
    if (result) result = result.map((r) => (r ? stripMarks(r) : r));
  }
  if (!result) {
    try {
      result = await localLines(work, script);
    } catch {
      result = null;
    }
  }
  if (!result) result = await deps.google(work).catch(() => null);
  if (!result) result = work.map((l) => transliterate(l));

  idx.forEach((i, k) => {
    const r = result![k]?.trim();
    out[i] = r && r !== lines[i] ? r : null;
  });
  return out;
}
