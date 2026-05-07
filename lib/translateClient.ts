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

  // Optimization: Parallelize the first two chunks to reduce "Time to First Lyric"
  // Subsequent chunks remain serial with a delay to prevent 429s.
  const processChunk = async (chunk: string[], index: number) => {
    if (index >= 2) await delay(CHUNK_DELAY_MS);
    const joined = chunk.join('\n');
    try {
      const result = await googleTranslate(joined, targetLang, includeRomanization);
      const transLines = result.translated.split('\n');
      const romLines = (result.romanized && result.romanized.trim()) 
        ? result.romanized.split('\n') 
        : transLines; // Fallback to translated if romanization is empty/invalid

      return { transLines, romLines, isLowQuality: false };
    } catch (googleErr) {
      console.warn('[SKaraoke:BG] Google blocked, falling back to MyMemory:', googleErr);
      const { chunks: subChunks } = chunkByCharCount(chunk, MYMEMORY_MAX_CHARS);
      const subTrans: string[] = [];
      const subRom: string[] = [];
      for (let j = 0; j < subChunks.length; j++) {
        if (j > 0) await delay(CHUNK_DELAY_MS);
        const text = await myMemoryTranslate(subChunks[j].join('\n'), targetLang);
        subTrans.push(...text.split('\n'));
        subRom.push(...text.split('\n'));
      }
      return { transLines: subTrans, romLines: subRom, isLowQuality: true };
    }
  };

  // Run first 2 chunks in parallel, others sequentially
  const results = await Promise.all(chunks.map((c, i) => processChunk(c, i)));
  
  results.forEach(res => {
    translatedFlat.push(...res.transLines);
    romanizedFlat.push(...res.romLines);
    if (res.isLowQuality) isLowQualityRomanization = true;
  });

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
