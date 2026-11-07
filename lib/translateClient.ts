import { chunkByCharCount } from './translate/chunkUtils';
import { googleTranslate } from './translate/googleApi';
import { myMemoryTranslate } from './translate/myMemoryApi';
import { transliterate } from 'transliteration';

// Re-export chunkByCharCount for backward compatibility
export { chunkByCharCount };

const GOOGLE_MAX_CHARS = 500;
const MYMEMORY_MAX_CHARS = 450;
// 120 ms inter-chunk delay — empirically keeps Google below its undocumented rate-limit threshold
const CHUNK_DELAY_MS = 120;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pads (with the source line) or slices a provider's output so it has exactly
 * one entry per input line of the chunk.
 */
export function alignToChunk(out: string[], chunk: string[], label = 'output'): string[] {
  if (out.length === chunk.length) return out;
  console.warn(`[SKaraoke:BG] ${label} returned ${out.length} lines for ${chunk.length}; re-aligning chunk.`);
  if (out.length > chunk.length) return out.slice(0, chunk.length);
  const aligned = out.slice();
  while (aligned.length < chunk.length) aligned.push(chunk[aligned.length]);
  return aligned;
}

export async function googleProcess(
  lines: string[],
  targetLang: string,
  includeRomanization: boolean,
  sourceLang: string = 'auto'
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
  // A chunk whose translation fails on BOTH providers rejects, so googleProcess
  // rejects as a whole: callers must never receive original lines as a "translation".
  const processChunk = async (chunk: string[], index: number) => {
    if (index >= 1) await delay(CHUNK_DELAY_MS);
    const joined = chunk.join('\n');
    try {
      const result = await googleTranslate(joined, targetLang, includeRomanization, sourceLang);
      if (!result.translated.trim()) throw new Error('Google empty translation');

      // Trim to avoid trailing newline misalignment, then pad/slice to the chunk length
      // so a merged line never shifts the lines of later chunks.
      const transLines = alignToChunk(result.translated.trim().split('\n'), chunk, 'Google translation');

      let isLowQuality = false;
      let romLines: string[];

      const romSplit = result.romanized?.trim() ? result.romanized.trim().split('\n') : null;
      if (romSplit && romSplit.length === chunk.length) {
        romLines = romSplit;
      } else {
        if (romSplit) {
          // Google collapsed (or split) the romanization lines: fall back per line.
          console.warn(`[SKaraoke:BG] Google romanization returned ${romSplit.length} lines for ${chunk.length}; using per-line transliteration.`);
        }
        // Fallback to local transliteration library (silent)
        romLines = chunk.map(l => transliterate(l));
        isLowQuality = true;
      }

      return { transLines, romLines, isLowQuality };
    } catch (googleErr) {
      console.warn('[SKaraoke:BG] Google blocked, falling back to MyMemory:', googleErr);
      const { chunks: subChunks } = chunkByCharCount(chunk, MYMEMORY_MAX_CHARS);
      const subTrans: string[] = [];
      for (let j = 0; j < subChunks.length; j++) {
        if (j > 0) await delay(CHUNK_DELAY_MS);
        const text = await myMemoryTranslate(subChunks[j].join('\n'), targetLang, sourceLang);
        subTrans.push(...alignToChunk(text.trim().split('\n'), subChunks[j], 'MyMemory translation'));
      }
      // MyMemory only translates. Its output is never a romanization: transliterate the source.
      const romLines = chunk.map(l => transliterate(l));
      return { transLines: alignToChunk(subTrans, chunk, 'MyMemory translation'), romLines, isLowQuality: true };
    }
  };

  // Run first 2 chunks in parallel, others sequentially to prevent 429 bursts.
  const results = await Promise.all([
    processChunk(chunks[0], 0),
    ...(chunks[1] ? [processChunk(chunks[1], 1)] : [])
  ]);

  for (let i = 2; i < chunks.length; i++) {
    results.push(await processChunk(chunks[i], i));
  }
  
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
