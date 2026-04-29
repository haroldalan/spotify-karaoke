export function chunkByCharCount(lines: string[], maxChars: number): { chunks: string[][], wasTruncated: boolean } {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  let wasTruncated = false;

  for (const line of lines) {
    if (line.length > maxChars) {
      wasTruncated = true;
      // Truncate to maxChars. Try to split at last space for readability; always append '…'.
      // This maintains 1:1 index alignment for the translation/romanization result arrays.
      const sliced = line.slice(0, maxChars);
      const wordBoundary = sliced.replace(/\s+\S*$/, '');
      const truncated = (wordBoundary || sliced.slice(0, -1)) + '…';
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
