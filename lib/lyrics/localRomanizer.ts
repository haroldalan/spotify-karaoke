import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';
import { pinyin } from 'pinyin-pro';
import CyrillicToTranslit from 'cyrillic-to-translit-js';
import Sanscript from '@indic-transliteration/sanscript';
import { romanize as romanizeKorean } from '@romanize/korean';
import romanizeThai from '@dehoist/romanize-thai';
import { transliterate } from 'transliteration';
import { romanize as romanizeTamil } from 'tamil-romanizer';
import type { ScriptType } from './scriptDetector';

let kuroshiroReady: Promise<Kuroshiro> | null = null;

export async function getKuroshiro(): Promise<Kuroshiro> {
  if (!kuroshiroReady) {
    kuroshiroReady = (async () => {
      try {
        const instance = new Kuroshiro();
        await instance.init(
          new KuromojiAnalyzer({
            dictPath: 'https://cdn.jsdelivr.net/npm/kuromoji/dict',
          })
        );
        return instance;
      } catch (e) {
        kuroshiroReady = null;
        throw e;
      }
    })();
  }
  return kuroshiroReady;
}

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

export async function romanizeLocally(lines: string[], script: ScriptType): Promise<string[]> {
  return Promise.all(lines.map((line) => romanizeLine(line, script)));
}

async function romanizeLine(line: string, script: ScriptType): Promise<string> {
  if (!line.trim() || !/\p{L}/u.test(line)) return line;

  try {
    switch (script) {
      case 'japanese': {
        const k = await getKuroshiro();
        return k.convert(line, { to: 'romaji', mode: 'spaced' });
      }
      case 'chinese':
        return pinyin(line, { toneType: 'symbol', type: 'string' });

      case 'korean':
        return romanizeKorean(line);

      case 'cyrillic':
        return /[іїєґ]/i.test(line) 
          ? cyrillicTranslitUk.transform(line) 
          : cyrillicTranslitRu.transform(line);

      case 'devanagari':
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
        return romanizeThai(line);

      default:
        return transliterate(line);
    }
  } catch (err) {
    console.error(`[SKaraoke:BG] Romanize '${script}' failed, using fallback:`, err);
    return transliterate(line);
  }
}
