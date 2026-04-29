import { chunkByCharCount } from './translate/chunkUtils';
import { googleTranslate } from './translate/googleApi';
import { myMemoryTranslate } from './translate/myMemoryApi';

// Re-export chunkByCharCount for backward compatibility
export { chunkByCharCount };

const GOOGLE_MAX_CHARS = 500;
const MYMEMORY_MAX_CHARS = 450;
// 120 ms inter-chunk delay — empirically keeps Google below its undocumented rate-limit threshold
const CHUNK_DELAY_MS = 120;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function googleProcess(
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
