// Port of: lyric-test/modules/common/forensics.js

export interface ForensicsResult {
  nativeCount: number;
  latinCount: number;
  isActuallyNative: boolean;
  hasAnyNative: boolean;
}

export interface SlyForensics {
  nativeRegex: RegExp;
  analyzeText(input: unknown): ForensicsResult;
}

declare global {
  interface Window {
    slyForensics: SlyForensics;
  }
}

/**
 * Standardized text analysis engine for native script detection.
 * Counts native-script vs latin characters in a lyric sample to determine
 * whether a track's lyrics are genuinely in a native script or are romanized.
 */
export const slyForensics: SlyForensics = {
  // Covers: Devanagari, Indic scripts, Hiragana, Katakana, CJK, Hangul,
  //         Cyrillic, Arabic/Persian, Thai, Hebrew, Greek, Armenian, Georgian, Ethiopic
  nativeRegex: /[\u0900-\u0DFF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u05D0-\u05FF\u0370-\u03FF\u0530-\u058F\u10A0-\u10FF\u1200-\u137F]/g,

  analyzeText(input: unknown): ForensicsResult {
    // Accept either a raw string or an array of lyric line objects
    const text = Array.isArray(input)
      ? (input as Record<string, unknown>[])
          .slice(0, 15)
          .map(l => l.words || l.text || l)
          .join(' ')
      : (input as string || '');

    const nativeMatches = text.match(this.nativeRegex);
    const latinMatches = text.match(/[A-Za-z]/g);
    const nativeCount = nativeMatches ? nativeMatches.length : 0;
    const latinCount = latinMatches ? latinMatches.length : 0;

    return {
      nativeCount,
      latinCount,
      isActuallyNative: nativeCount > 10,
      hasAnyNative: nativeCount > 0,
    };
  },
};

window.slyForensics = slyForensics;
