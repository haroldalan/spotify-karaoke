import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';
import { pinyin } from 'pinyin-pro';
import CyrillicToTranslit from 'cyrillic-to-translit-js';
import Sanscript from '@indic-transliteration/sanscript';
import { romanize as romanizeKorean } from '@romanize/korean';
import romanizeThai from '@dehoist/romanize-thai';
import { romanize as romanizeTamil } from 'tamil-romanizer';
import { detectScript } from './detector.js';
import type {
  RomanizeOptions,
  RomanizeResult,
  Romanizer,
  RomanizerOptions,
  ScriptType,
} from './types.js';
import { UnsupportedRomanizationError } from './types.js';

const DEFAULT_JAPANESE_DICT_PATH = 'https://cdn.jsdelivr.net/npm/kuromoji/dict';
const EXTERNAL_ROMANIZATION_SCRIPTS = new Set<ScriptType>([
  'malayalam',
  'bengali',
  'arabic',
  'hebrew',
  'other',
]);

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

export function requiresExternalRomanization(script: ScriptType): boolean {
  return EXTERNAL_ROMANIZATION_SCRIPTS.has(script);
}

class DefaultRomanizer implements Romanizer {
  private readonly japaneseDictPath: string;
  private kuroshiroReady: Promise<Kuroshiro> | null = null;

  constructor(options?: RomanizerOptions) {
    this.japaneseDictPath = options?.japaneseDictPath ?? DEFAULT_JAPANESE_DICT_PATH;
  }

  async romanizeLine(line: string, options?: RomanizeOptions): Promise<string> {
    if (!line.trim() || !/\p{L}/u.test(line)) return line;

    const script = options?.script ?? detectScript([line]);
    if (script === 'latin') return line;
    if (requiresExternalRomanization(script)) {
      throw new UnsupportedRomanizationError(script);
    }

    switch (script) {
      case 'japanese': {
        const k = await this.getKuroshiro();
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
        if (!scheme) throw new Error(`Missing Sanscript scheme mapping for '${script}'.`);
        if (!(Sanscript as any).schemes?.[scheme]) {
          throw new Error(`Sanscript does not support scheme '${scheme}' for '${script}'.`);
        }
        return Sanscript.t(line, scheme, 'iast');
      }
      case 'tamil':
        return romanizeTamil(line);
      case 'thai':
        return romanizeThai(line);
      default:
        throw new UnsupportedRomanizationError(script);
    }
  }

  async romanizeLines(lines: readonly string[], options?: RomanizeOptions): Promise<RomanizeResult> {
    const script = options?.script ?? detectScript(lines);
    if (requiresExternalRomanization(script)) {
      throw new UnsupportedRomanizationError(script);
    }
    if (script === 'latin') {
      return { script, lines: [...lines] };
    }

    const romanized = await Promise.all(lines.map((line) => this.romanizeLine(line, { script })));
    return { script, lines: romanized };
  }

  private async getKuroshiro(): Promise<Kuroshiro> {
    if (!this.kuroshiroReady) {
      this.kuroshiroReady = (async () => {
        const instance = new Kuroshiro();
        await instance.init(
          new KuromojiAnalyzer({
            dictPath: this.japaneseDictPath,
          })
        );
        return instance;
      })().catch((error) => {
        this.kuroshiroReady = null;
        throw error;
      });
    }
    return this.kuroshiroReady;
  }
}

export function createRomanizer(options?: RomanizerOptions): Romanizer {
  return new DefaultRomanizer(options);
}
