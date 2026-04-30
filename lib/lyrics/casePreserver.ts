export function preserveCasing(original: string, romanized: string): string {
  const latinWords = [...original.matchAll(/[a-zA-Z]+/g)].map(m => m[0]);
  if (latinWords.length === 0) return romanized;

  let wordIndex = 0;
  return romanized.replace(/[a-zA-Z]+/g, (match) => {
    if (wordIndex < latinWords.length && match.toLowerCase() === latinWords[wordIndex].toLowerCase()) {
      return latinWords[wordIndex++];
    }
    return match;
  });
}
