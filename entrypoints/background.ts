import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';
import { pinyin } from 'pinyin-pro';
import CyrillicToTranslit from 'cyrillic-to-translit-js';
import Sanscript from '@indic-transliteration/sanscript';
import { romanize as romanizeKorean } from '@romanize/korean';
import romanizeThai from '@dehoist/romanize-thai';
import { transliterate } from 'transliteration';
import { romanize as romanizeTamil } from 'tamil-romanizer';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      msg: { type: string; lines: string[]; targetLang?: string },
      _sender,
      sendResponse
    ) => {
      if (msg.type === 'PROCESS') {
        processLines(msg.lines, msg.targetLang ?? 'en')
          .then(sendResponse)
          .catch((err) => {
            console.error('[SKaraoke:BG] PROCESS failed:', err);
            // Fallback: return originals for both modes
            sendResponse({ translated: msg.lines, romanized: msg.lines });
          });
        return true;
      }
    }
  );
});

// ─── Script Detection ─────────────────────────────────────────────────────────

type ScriptType =
  | 'japanese' | 'chinese' | 'korean' | 'cyrillic'
  | 'devanagari' | 'gujarati' | 'gurmukhi' | 'telugu' | 'kannada' | 'odia'
  | 'tamil' | 'malayalam' | 'bengali'
  | 'arabic' | 'hebrew' | 'thai'
  | 'latin' | 'other';

// These scripts use Google dt=rm — no adequate local library exists
const GOOGLE_ROMANIZE_SCRIPTS = new Set<ScriptType>([
  'malayalam', 'bengali', 'arabic', 'hebrew', 'other',
]);

export function detectScript(lines: string[]): ScriptType {
  const text = lines.join('');

  // Japanese: any kana is definitive — must check before CJK
  // since Japanese text mixes kana and kanji
  if (/[\u3040-\u30FF]/.test(text)) return 'japanese';

  // Score every other script by character count, pick the dominant one
  const scores: [ScriptType, number][] = [
    ['chinese', (text.match(/[\u4E00-\u9FFF]/g) ?? []).length],
    ['korean', (text.match(/[\uAC00-\uD7AF]/g) ?? []).length],
    ['cyrillic', (text.match(/[\u0400-\u04FF]/g) ?? []).length],
    ['devanagari', (text.match(/[\u0900-\u097F]/g) ?? []).length],
    ['gujarati', (text.match(/[\u0A80-\u0AFF]/g) ?? []).length],
    ['gurmukhi', (text.match(/[\u0A00-\u0A7F]/g) ?? []).length],
    ['telugu', (text.match(/[\u0C00-\u0C7F]/g) ?? []).length],
    ['kannada', (text.match(/[\u0C80-\u0CFF]/g) ?? []).length],
    ['odia', (text.match(/[\u0B00-\u0B7F]/g) ?? []).length],
    ['tamil', (text.match(/[\u0B80-\u0BFF]/g) ?? []).length],
    ['malayalam', (text.match(/[\u0D00-\u0D7F]/g) ?? []).length],
    ['bengali', (text.match(/[\u0980-\u09FF]/g) ?? []).length],
    ['arabic', (text.match(/[\u0600-\u06FF]/g) ?? []).length],
    ['hebrew', (text.match(/[\u0590-\u05FF]/g) ?? []).length],
    ['thai', (text.match(/[\u0E00-\u0E7F]/g) ?? []).length],
  ];

  const dominant = scores.reduce((best, curr) => curr[1] > best[1] ? curr : best);
  if (dominant[1] > 0) return dominant[0];
  // No non-Latin script detected — treat as Latin if there are any letters at all.
  // This covers English, French, Spanish, Portuguese, Italian, German, etc.
  return /\p{L}/u.test(text) ? 'latin' : 'other';
}

// ─── Kuroshiro Lazy Init ──────────────────────────────────────────────────────

let kuroshiroReady: Promise<Kuroshiro> | null = null;

export async function getKuroshiro(): Promise<Kuroshiro> {
  if (!kuroshiroReady) {
    // The promise itself resolves to the initialized instance.
    // All concurrent callers await the same promise and only
    // proceed once init() has fully completed — no race condition.
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
        kuroshiroReady = null; // Allow retry on next call
        throw e;
      }
    })();
  }
  return kuroshiroReady;
}

// ─── Singletons ───────────────────────────────────────────────────────────────

const cyrillicTranslitRu = CyrillicToTranslit({ preset: 'ru' });
const cyrillicTranslitUk = CyrillicToTranslit({ preset: 'uk' });

// @indic-transliteration/sanscript scheme IDs for each Indic script
const SANSCRIPT_SCHEME: Partial<Record<ScriptType, string>> = {
  devanagari: 'devanagari',
  gujarati: 'gujarati',
  gurmukhi: 'gurmukhi',
  telugu: 'telugu',
  kannada: 'kannada',
  odia: 'oriya', // Package uses legacy name 'oriya' for Odia/Oriya script
};

// Check if the current Sanscript package actually supports the mapped keys.
// This prevents silent failure if the package updates and 'oriya' -> 'odia' happens.
const verifiedSchemes = new Set<string>();
try {
  // Sanscript.t is the primary transliteration function. If it doesn't have 
  // 'schemes' exported, we skip this runtime validation.
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

// Script types that map to exactly one Google Translate language code.
// When targetLang matches, translation returns the original text unchanged
// — so we skip the API call and return the original lines directly.
// Scripts in GOOGLE_ROMANIZE_SCRIPTS are intentionally excluded: they still
// need a fetch for dt=rm romanization, so we can't skip the call.
const SCRIPT_NATIVE_LANG: Partial<Record<ScriptType, string>> = {
  korean: 'ko',
  japanese: 'ja',
  thai: 'th',
  telugu: 'te',
  kannada: 'kn',
  gujarati: 'gu',
  gurmukhi: 'pa',
  odia: 'or',
  tamil: 'ta',
  devanagari: 'hi', // Optimized for Hindi
  cyrillic: 'ru',    // Optimized for Russian
  // Partially covered — maps to the most common language only.
  // Other variants (mr/sa/ne for devanagari, uk/bg/sr for cyrillic, zh-TW for chinese) still hit Google:
};

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export async function processLines(
  lines: string[],
  targetLang: string
): Promise<{ 
  translated: string[]; 
  romanized: string[]; 
  isLowQualityRomanization?: boolean;
  wasTruncated?: boolean;
}> {
  const script = detectScript(lines);

  if (script === 'latin') {
    // Already Roman script — romanization is a no-op. Only translate.
    const { translated, wasTruncated } = await googleProcess(lines, targetLang, false);
    return { translated, romanized: lines, wasTruncated };
  }

  // Chinese fast-path: Maps to both zh-CN and zh-TW. If matched, skip API.
  if (script === 'chinese' && (targetLang === 'zh-CN' || targetLang === 'zh-TW')) {
    const romanized = await romanizeLocally(lines, script);
    return { translated: lines, romanized };
  }

  // Translation no-op fast-path: script maps to exactly one language and it
  // matches targetLang, so Google would return the original text unchanged.
  // These scripts all have local romanizers, so we skip Google entirely.
  if (SCRIPT_NATIVE_LANG[script] === targetLang) {
    const romanized = await romanizeLocally(lines, script);
    return { translated: lines, romanized };
  }

  if (GOOGLE_ROMANIZE_SCRIPTS.has(script)) {
    // One Google call with dt=t&dt=rm → get translation AND romanization
    return googleProcess(lines, targetLang, true);
  }

  // Specialized library for romanization + Google for translation, in parallel
  const [{ translated, wasTruncated }, romanized] = await Promise.all([
    googleProcess(lines, targetLang, false),
    romanizeLocally(lines, script),
  ]);

  return { translated, romanized, wasTruncated };
}

// ─── Local Romanization ───────────────────────────────────────────────────────

async function romanizeLocally(lines: string[], script: ScriptType): Promise<string[]> {
  return Promise.all(lines.map((line) => romanizeLine(line, script)));
}

async function romanizeLine(line: string, script: ScriptType): Promise<string> {
  // Skip blank lines and lines with no linguistic content (♪, etc.)
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
        // 'iast' = International Alphabet of Sanskrit Transliteration
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

// ─── Google Translate ─────────────────────────────────────────────────────────

const GOOGLE_MAX_CHARS = 500;
const MYMEMORY_MAX_CHARS = 450;
// 120 ms inter-chunk delay — empirically keeps Google below its undocumented rate-limit threshold
const CHUNK_DELAY_MS = 120;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function googleProcess(
  lines: string[],
  targetLang: string,
  includeRomanization: boolean
): Promise<{ 
  translated: string[]; 
  romanized: string[]; 
  isLowQualityRomanization?: boolean;
  wasTruncated?: boolean;
}> {
  const translatableIndices: number[] = [];
  const translatableLines: string[] = [];

  lines.forEach((line, i) => {
    if (line.trim() && /\p{L}/u.test(line)) {
      translatableIndices.push(i);
      translatableLines.push(line);
    }
  });

  if (translatableLines.length === 0) {
    return { translated: [...lines], romanized: [...lines] };
  }

  const { chunks, wasTruncated } = chunkByCharCount(translatableLines, GOOGLE_MAX_CHARS);
  const translatedFlat: string[] = [];
  const romanizedFlat: string[] = [];
  let isLowQualityRomanization = false;

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await delay(CHUNK_DELAY_MS);
    const joined = chunks[i].join('\n');

    try {
      const result = await googleTranslate(joined, targetLang, includeRomanization);
      translatedFlat.push(...result.translated.split('\n'));
      // If Google didn't return romanization, fall back to translated text
      romanizedFlat.push(...(result.romanized ?? result.translated).split('\n'));
    } catch (googleErr) {
      console.warn('[SKaraoke:BG] Google blocked, falling back to MyMemory:', googleErr);
      isLowQualityRomanization = true;
      try {
        const { chunks: subChunks } = chunkByCharCount(chunks[i], MYMEMORY_MAX_CHARS);
        for (let j = 0; j < subChunks.length; j++) {
          if (j > 0) await delay(CHUNK_DELAY_MS);
          const text = await myMemoryTranslate(subChunks[j].join('\n'), targetLang);
          translatedFlat.push(...text.split('\n'));
          romanizedFlat.push(...text.split('\n')); // MyMemory has no dt=rm equivalent
        }
      } catch (mmErr) {
        console.error('[SKaraoke:BG] MyMemory also failed:', mmErr);
        translatedFlat.push(...chunks[i]);
        romanizedFlat.push(...chunks[i]);
      }
    }
  }

  const translatedOutput = [...lines];
  const romanizedOutput = [...lines];
  translatableIndices.forEach((originalIdx, i) => {
    translatedOutput[originalIdx] = translatedFlat[i] ?? lines[originalIdx];
    romanizedOutput[originalIdx] = romanizedFlat[i] ?? lines[originalIdx];
  });

  return { 
    translated: translatedOutput, 
    romanized: romanizedOutput, 
    isLowQualityRomanization,
    wasTruncated
  };
}

async function googleTranslate(
  text: string,
  targetLang: string,
  includeRomanization: boolean
): Promise<{ translated: string; romanized: string | null }> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLang,
    q: text,
  });
  params.append('dt', 't');
  if (includeRomanization) params.append('dt', 'rm');

  let res: Response;
  try {
    res = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params}`,
      {
        headers: {
          Referer: 'https://translate.google.com/',
          Accept: 'application/json',
        },
      }
    );
  } catch (err) {
    // Firefox TypeError on cross-origin, or network error
    throw new Error('Google network error or rate-limited');
  }

  if (res.status === 0 || !res.ok) {
    throw new Error(`Google HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new Error('Google non-JSON (captcha)');

  const data = (await res.json()) as any[];
  const allSegments = ((data[0] as any[]) ?? []) as any[][];

  // When dt=rm is present, Google appends a special romanization block as
  // the LAST element of data[0], shaped: [null, null, null, "line1\nline2\n..."]
  // All normal translation segments are shaped: ["translated", "original", ...]
  // data[8] is the language detection array — NOT romanization — and contains
  // null entries that would throw if we tried to iterate it. Never touch it.
  let segments = allSegments;
  let romanized: string | null = null;

  if (
    includeRomanization &&
    allSegments.length > 0 &&
    allSegments[allSegments.length - 1][0] === null &&
    allSegments[allSegments.length - 1][1] === null &&
    typeof allSegments[allSegments.length - 1][3] === 'string'
  ) {
    const last = allSegments[allSegments.length - 1];
    romanized = (last[3] as string | null | undefined) ?? null;
    // Exclude the romanization block so it doesn't pollute the translated text
    segments = allSegments.slice(0, -1);
  }

  const translated = segments.map((s) => (s[0] ?? '') as string).join('');

  return { translated, romanized };
}

async function myMemoryTranslate(text: string, targetLang: string): Promise<string> {
  const params = new URLSearchParams({
    q: text,
    langpair: `en|${targetLang}`,
  });
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);

  const data = (await res.json()) as {
    responseStatus: number;
    responseData: { translatedText: string };
    quotaFinished?: boolean;
  };

  if (data.quotaFinished) throw new Error('MyMemory daily quota exhausted');
  if (data.responseStatus !== 200) throw new Error(`MyMemory status ${data.responseStatus}`);
  return data.responseData.translatedText;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function chunkByCharCount(lines: string[], maxChars: number): { chunks: string[][], wasTruncated: boolean } {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  let wasTruncated = false;

  for (const line of lines) {
    if (line.length > maxChars) {
      wasTruncated = true;
      // Truncate to maxChars. Try to split at last space, else hard-slice at maxChars.
      // This maintains 1:1 index alignment for the translation/romanization result arrays.
      const truncated = line.slice(0, maxChars).replace(/\s+\S*$/, '…');
      console.warn(`[SKaraoke:BG] Line too long, truncating to maintain index alignment: ${truncated}`);
      
      if (currentLen + truncated.length + 1 > maxChars && current.length > 0) {
        chunks.push(current);
        current = [truncated];
        currentLen = truncated.length;
      } else {
        current.push(truncated);
        currentLen += truncated.length + 1;
      }
      continue;
    }
    if (currentLen + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current);
      current = [line];
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen += line.length + 1;
    }
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, wasTruncated };
}
