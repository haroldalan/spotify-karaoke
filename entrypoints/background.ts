import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';
import { pinyin } from 'pinyin-pro';
import CyrillicToTranslit from 'cyrillic-to-translit-js';
import Sanscript from '@indic-transliteration/sanscript';
import { romanize as romanizeKorean } from '@romanize/korean';
import romanizeThai from '@dehoist/romanize-thai';
import { transliterate } from 'transliteration';

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
            console.error('[SlyLyrics BG] PROCESS failed:', err);
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
  | 'other';

// These scripts use Google dt=rm — no adequate local library exists
const GOOGLE_ROMANIZE_SCRIPTS = new Set<ScriptType>([
  'tamil', 'malayalam', 'bengali', 'arabic', 'hebrew', 'other',
]);

function detectScript(lines: string[]): ScriptType {
  const text = lines.join('');

  // Japanese: any kana is definitive — must check before CJK
  // since Japanese text mixes kana and kanji
  if (/[\u3040-\u30FF]/.test(text)) return 'japanese';

  // Score every other script by character count, pick the dominant one
  const scores: [ScriptType, number][] = [
    ['chinese',    (text.match(/[\u4E00-\u9FFF]/g) ?? []).length],
    ['korean',     (text.match(/[\uAC00-\uD7AF]/g) ?? []).length],
    ['cyrillic',   (text.match(/[\u0400-\u04FF]/g) ?? []).length],
    ['devanagari', (text.match(/[\u0900-\u097F]/g) ?? []).length],
    ['gujarati',   (text.match(/[\u0A80-\u0AFF]/g) ?? []).length],
    ['gurmukhi',   (text.match(/[\u0A00-\u0A7F]/g) ?? []).length],
    ['telugu',     (text.match(/[\u0C00-\u0C7F]/g) ?? []).length],
    ['kannada',    (text.match(/[\u0C80-\u0CFF]/g) ?? []).length],
    ['odia',       (text.match(/[\u0B00-\u0B7F]/g) ?? []).length],
    ['tamil',      (text.match(/[\u0B80-\u0BFF]/g) ?? []).length],
    ['malayalam',  (text.match(/[\u0D00-\u0D7F]/g) ?? []).length],
    ['bengali',    (text.match(/[\u0980-\u09FF]/g) ?? []).length],
    ['arabic',     (text.match(/[\u0600-\u06FF]/g) ?? []).length],
    ['hebrew',     (text.match(/[\u0590-\u05FF]/g) ?? []).length],
    ['thai',       (text.match(/[\u0E00-\u0E7F]/g) ?? []).length],
  ];

  const dominant = scores.reduce((best, curr) => curr[1] > best[1] ? curr : best);
  return dominant[1] > 0 ? dominant[0] : 'other';
}

// ─── Kuroshiro Lazy Init ──────────────────────────────────────────────────────

let kuroshiroReady: Promise<Kuroshiro> | null = null;

async function getKuroshiro(): Promise<Kuroshiro> {
  if (!kuroshiroReady) {
    // The promise itself resolves to the initialized instance.
    // All concurrent callers await the same promise and only
    // proceed once init() has fully completed — no race condition.
    kuroshiroReady = (async () => {
      const instance = new Kuroshiro();
      await instance.init(
        new KuromojiAnalyzer({
          dictPath: 'https://cdn.jsdelivr.net/npm/kuromoji/dict',
        })
      );
      return instance;
    })();
  }
  return kuroshiroReady;
}

// ─── Singletons ───────────────────────────────────────────────────────────────

const cyrillicTranslit = CyrillicToTranslit({ preset: 'ru' });

// @indic-transliteration/sanscript scheme IDs for each Indic script
const SANSCRIPT_SCHEME: Partial<Record<ScriptType, string>> = {
  devanagari: 'devanagari',
  gujarati:   'gujarati',
  gurmukhi:   'gurmukhi',
  telugu:     'telugu',
  kannada:    'kannada',
  odia:       'oriya', // Package uses legacy name 'oriya' for Odia/Oriya script
};

// ─── Main Orchestrator ────────────────────────────────────────────────────────

async function processLines(
  lines: string[],
  targetLang: string
): Promise<{ translated: string[]; romanized: string[] }> {
  const script = detectScript(lines);

  if (GOOGLE_ROMANIZE_SCRIPTS.has(script)) {
    // One Google call with dt=t&dt=rm → get translation AND romanization
    return googleProcess(lines, targetLang, true);
  }

  // Specialized library for romanization + Google for translation, in parallel
  const [{ translated }, romanized] = await Promise.all([
    googleProcess(lines, targetLang, false),
    romanizeLocally(lines, script),
  ]);

  return { translated, romanized };
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
        return cyrillicTranslit.transform(line);

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
      case 'thai':
        return romanizeThai(line);

      default:
        return transliterate(line);
    }
  } catch (err) {
    console.error(`[SlyLyrics BG] Romanize '${script}' failed, using fallback:`, err);
    return transliterate(line);
  }
}

// ─── Google Translate ─────────────────────────────────────────────────────────

const GOOGLE_MAX_CHARS = 500;
const MYMEMORY_MAX_CHARS = 450;
const CHUNK_DELAY_MS = 120;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function googleProcess(
  lines: string[],
  targetLang: string,
  includeRomanization: boolean
): Promise<{ translated: string[]; romanized: string[] }> {
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

  const chunks = chunkByCharCount(translatableLines, GOOGLE_MAX_CHARS);
  const translatedFlat: string[] = [];
  const romanizedFlat: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await delay(CHUNK_DELAY_MS);
    const joined = chunks[i].join('\n');

    try {
      const result = await googleTranslate(joined, targetLang, includeRomanization);
      translatedFlat.push(...result.translated.split('\n'));
      // If Google didn't return romanization, fall back to translated text
      romanizedFlat.push(...(result.romanized ?? result.translated).split('\n'));
    } catch (googleErr) {
      console.warn('[SlyLyrics BG] Google blocked, falling back to MyMemory:', googleErr);
      try {
        const subChunks = chunkByCharCount(chunks[i], MYMEMORY_MAX_CHARS);
        for (let j = 0; j < subChunks.length; j++) {
          if (j > 0) await delay(CHUNK_DELAY_MS);
          const text = await myMemoryTranslate(subChunks[j].join('\n'), targetLang);
          translatedFlat.push(...text.split('\n'));
          romanizedFlat.push(...text.split('\n')); // MyMemory has no dt=rm equivalent
        }
      } catch (mmErr) {
        console.error('[SlyLyrics BG] MyMemory also failed:', mmErr);
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

  return { translated: translatedOutput, romanized: romanizedOutput };
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

  const res = await fetch(
    `https://translate.googleapis.com/translate_a/single?${params}`,
    {
      redirect: 'manual',
      headers: {
        Referer: 'https://translate.google.com/',
        Accept: 'application/json',
      },
    }
  );

  if (res.type === 'opaqueredirect' || res.status === 0) {
    throw new Error('Google rate-limited (redirect to /sorry)');
  }
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
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
    allSegments[allSegments.length - 1][0] === null
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
    langpair: `autodetect|${targetLang}`,
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

function chunkByCharCount(lines: string[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
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
  return chunks;
}
