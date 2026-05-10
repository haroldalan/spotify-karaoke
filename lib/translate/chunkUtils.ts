export function chunkByCharCount(lines: string[], maxChars: number): { chunks: string[][], wasTruncated: boolean } {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  let wasTruncated = false;

  for (const line of lines) {
    const lineLen = line.length;
    if (lineLen > maxChars) {
      wasTruncated = true;
      // Truncate to maxChars. Try to split at last space, else hard-slice at maxChars.
      const sliced = line.slice(0, maxChars);
      const truncated = sliced.includes(' ') ? sliced.replace(/\s+\S*$/, '…') : sliced;
      console.warn(`[SKaraoke:BG] Line too long (${lineLen} chars), truncating: ${truncated}`);
      
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
    if (currentLen + lineLen + 1 > maxChars && current.length > 0) {
      chunks.push(current);
      current = [line];
      currentLen = lineLen;
    } else {
      current.push(line);
      currentLen += lineLen + 1;
    }
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, wasTruncated };
}
