import { pinyin } from 'pinyin-pro';
import CyrillicToTranslit from 'cyrillic-to-translit-js';
import Sanscript from '@indic-transliteration/sanscript';
import { romanizeHindiLine } from './hindiRomanizer';
import { romanizeThaiLine } from './thaiRomanizer';
import { romanizeJapaneseLines } from './japaneseRomanizer';
import { romanize as romanizeKorean } from '@romanize/korean';
import { transliterate } from 'transliteration';
import { romanize as romanizeTamil } from 'tamil-romanizer';
import type { ScriptType } from './scriptDetector';

const cyrillicTranslitRu = CyrillicToTranslit({ preset: 'ru' });
const cyrillicTranslitUk = CyrillicToTranslit({ preset: 'uk' });

const SANSCRIPT_SCHEME: Partial<Record<ScriptType, string>> = {
  devanagari: 'devanagari',
  gujarati: 'gujarati',
  gurmukhi: 'gurmukhi',
  telugu: 'telugu',
  kannada: 'kannada',
  odia: 'oriya',
};

const verifiedSchemes = new Set<string>();
try {
  const schemes = (Sanscript as any).schemes;
  if (schemes) {
    Object.entries(SANSCRIPT_SCHEME).forEach(([script, scheme]) => {
      if (!schemes[scheme]) {
        console.warn(`[SKaraoke:BG] Script mapping mismatch: '${script}' maps to '${scheme}' but Sanscript doesn't recognize it.`);
      } else {
        verifiedSchemes.add(script);
      }
    });
  }
} catch { /* ignore validation error */ }

/**
 * Romanizes lines with the bundled engines. Rejects when Japanese cannot be
 * romanized (its dictionary did not load): a per-line transliteration would read
 * kanji as Chinese, so the caller must flag it or use another source.
 */
export async function romanizeLocally(lines: string[], script: ScriptType): Promise<string[]> {
  if (script === 'japanese') return romanizeJapaneseLines(lines);
  return Promise.all(lines.map((line) => romanizeLine(line, script)));
}

async function romanizeLine(line: string, script: ScriptType): Promise<string> {
  if (!line.trim() || !/\p{L}/u.test(line)) return line;

  try {
    switch (script) {
      case 'chinese':
        return pinyin(line, { toneType: 'none', type: 'string', nonZh: 'consecutive' }).replace(/\s+/g, ' ');

      case 'korean':
        return romanizeKorean(line);

      case 'cyrillic':
        return /[іїєґ]/i.test(line)
          ? cyrillicTranslitUk.transform(line)
          : cyrillicTranslitRu.transform(line);

      case 'devanagari':
        // Hindi as it is written in Latin letters (schwa deletion), not Sanskrit IAST.
        return romanizeHindiLine(line);

      case 'gujarati':
      case 'gurmukhi':
      case 'telugu':
      case 'kannada':
      case 'odia': {
        const scheme = SANSCRIPT_SCHEME[script];
        return scheme ? Sanscript.t(line, scheme, 'iast') : transliterate(line);
      }
      case 'tamil':
        return romanizeTamil(line);

      case 'thai':
        return romanizeThaiLine(line);

      default:
        return transliterate(line);
    }
  } catch (err) {
    console.error(`[SKaraoke:BG] Romanize '${script}' failed, using fallback:`, err);
    return transliterate(line);
  }
}
