import {
  createRomanizer,
  detectScript,
  requiresExternalRomanization,
  type ScriptType,
} from '@spotify-karaoke/romanizer';

const romanizer = createRomanizer();

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
            sendResponse({ translated: msg.lines, romanized: msg.lines });
          });
        return true;
      }
    }
  );
});

// Script types that map to exactly one Google Translate language code.
// When targetLang matches, translation returns the original text unchanged.
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
  devanagari: 'hi',
  cyrillic: 'ru',
};

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
    const { translated, wasTruncated } = await googleProcess(lines, targetLang, false);
    return { translated, romanized: lines, wasTruncated };
  }

  if (script === 'chinese' && (targetLang === 'zh-CN' || targetLang === 'zh-TW')) {
    const { lines: romanized } = await romanizer.romanizeLines(lines, { script });
    return { translated: lines, romanized };
  }

  if (SCRIPT_NATIVE_LANG[script] === targetLang) {
    const { lines: romanized } = await romanizer.romanizeLines(lines, { script });
    return { translated: lines, romanized };
  }

  if (requiresExternalRomanization(script)) {
    return googleProcess(lines, targetLang, true);
  }

  const [{ translated, wasTruncated }, localRomanized] = await Promise.all([
    googleProcess(lines, targetLang, false),
    romanizer.romanizeLines(lines, { script }),
  ]);

  return { translated, romanized: localRomanized.lines, wasTruncated };
}

const GOOGLE_MAX_CHARS = 500;
const MYMEMORY_MAX_CHARS = 450;
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
          romanizedFlat.push(...text.split('\n'));
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
    wasTruncated,
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
  } catch (_err) {
    throw new Error('Google network error or rate-limited');
  }

  if (res.status === 0 || !res.ok) {
    throw new Error(`Google HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new Error('Google non-JSON (captcha)');

  const data = (await res.json()) as any[];
  const allSegments = ((data[0] as any[]) ?? []) as any[][];

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

export function chunkByCharCount(
  lines: string[],
  maxChars: number
): { chunks: string[][]; wasTruncated: boolean } {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  let wasTruncated = false;

  for (const line of lines) {
    if (line.length > maxChars) {
      wasTruncated = true;
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
