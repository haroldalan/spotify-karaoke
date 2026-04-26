import type { ScriptType } from './types.js';

const LETTER_RE = /\p{L}/u;

const SCRIPT_SCORES: Array<readonly [ScriptType, RegExp]> = [
  ['chinese', /[\u4E00-\u9FFF]/g],
  ['korean', /[\uAC00-\uD7AF]/g],
  ['cyrillic', /[\u0400-\u04FF]/g],
  ['devanagari', /[\u0900-\u097F]/g],
  ['gujarati', /[\u0A80-\u0AFF]/g],
  ['gurmukhi', /[\u0A00-\u0A7F]/g],
  ['telugu', /[\u0C00-\u0C7F]/g],
  ['kannada', /[\u0C80-\u0CFF]/g],
  ['odia', /[\u0B00-\u0B7F]/g],
  ['tamil', /[\u0B80-\u0BFF]/g],
  ['malayalam', /[\u0D00-\u0D7F]/g],
  ['bengali', /[\u0980-\u09FF]/g],
  ['arabic', /[\u0600-\u06FF]/g],
  ['hebrew', /[\u0590-\u05FF]/g],
  ['thai', /[\u0E00-\u0E7F]/g],
];

// Keep this range aligned with extension content script behavior for the
// "latin fast path" check used during mode switching.
export const NON_LATIN_SCRIPT_RE =
  /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0900-\u0D7F\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F]/;

export function isLatinScript(lines: readonly string[]): boolean {
  const text = lines.join('');
  return !NON_LATIN_SCRIPT_RE.test(text) && LETTER_RE.test(text);
}

export function detectScript(lines: readonly string[]): ScriptType {
  const text = lines.join('');

  // Japanese: any kana is definitive and must be checked before CJK scoring.
  if (/[\u3040-\u30FF]/.test(text)) return 'japanese';

  let best: readonly [ScriptType, number] = ['other', 0];
  for (const [script, pattern] of SCRIPT_SCORES) {
    const score = (text.match(pattern) ?? []).length;
    if (score > best[1]) best = [script, score];
  }

  if (best[1] > 0) return best[0];
  return LETTER_RE.test(text) ? 'latin' : 'other';
}
