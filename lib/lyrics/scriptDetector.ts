export type ScriptType =
  | 'japanese' | 'chinese' | 'korean' | 'cyrillic'
  | 'devanagari' | 'gujarati' | 'gurmukhi' | 'telugu' | 'kannada' | 'odia'
  | 'tamil' | 'malayalam' | 'bengali'
  | 'arabic' | 'hebrew' | 'thai'
  | 'latin' | 'other';

export const GOOGLE_ROMANIZE_SCRIPTS = new Set<ScriptType>([
  'malayalam', 'bengali', 'arabic', 'hebrew', 'other',
]);

export function detectScript(lines: string[]): ScriptType {
  const text = lines.join('');

  if (/[\u3040-\u30FF]/.test(text)) return 'japanese';

  const scores: [ScriptType, number][] = [
    ['chinese', (text.match(/[\u4E00-\u9FFF]/g) ?? []).length],
    ['korean', (text.match(/[\uAC00-\uD7AF]/g) ?? []).length],
    ['cyrillic', (text.match(/[\u0400-\u04FF]/g) ?? []).length],
    ['devanagari', (text.match(/[\u0900-\u097F]/g) ?? []).length],
    ['gujarati', (text.match(/[\u0A80-\u0AFF]/g) ?? []).length],
    ['gurmukhi', (text.match(/[\u0A00-\u0A7F]/g) ?? []).length],
    ['telugu', (text.match(/[\u0C00-\u0C7F]/g) ?? []).length],
    ['kannada', (text.match(/[\u0C80-\u0CFF]/g) ?? []).length],
    ['odia', (text.match(/[\u0B00-\u0B7F]/g) ?? []).length],
    ['tamil', (text.match(/[\u0B80-\u0BFF]/g) ?? []).length],
    ['malayalam', (text.match(/[\u0D00-\u0D7F]/g) ?? []).length],
    ['bengali', (text.match(/[\u0980-\u09FF]/g) ?? []).length],
    ['arabic', (text.match(/[\u0600-\u06FF]/g) ?? []).length],
    ['hebrew', (text.match(/[\u0590-\u05FF]/g) ?? []).length],
    ['thai', (text.match(/[\u0E00-\u0E7F]/g) ?? []).length],
  ];

  const dominant = scores.reduce((best, curr) => curr[1] > best[1] ? curr : best);
  if (dominant[1] > 0) return dominant[0];
  return /\p{L}/u.test(text) ? 'latin' : 'other';
}

export const SCRIPT_NATIVE_LANG: Partial<Record<ScriptType, string>> = {
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

const NON_LATIN_SCRIPT_RE =
  /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0900-\u0D7F\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F]/;

export function isLatinScript(lines: string[]): boolean {
  const text = lines.join('');
  return !NON_LATIN_SCRIPT_RE.test(text) && /\p{L}/u.test(text);
}
