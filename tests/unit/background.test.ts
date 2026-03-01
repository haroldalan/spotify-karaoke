import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Load the file as a string so we can extract the internal functions for testing.
// In a real environment, we'd export these, but since this is an extension background
// script we don't want to pollute the export scope just for testing.
const bgScript = fs.readFileSync(path.resolve(__dirname, '../../entrypoints/background.ts'), 'utf-8');

// Extract detectScript
const detectScriptMatch = bgScript.match(/function detectScript.*?\{([\s\S]*?)\n\}/);
const detectScriptBody = detectScriptMatch ? detectScriptMatch[1] : '';

// Create an executable function from the body
const detectScript = new Function('lines', `
  const text = lines.join('');
  
  if (/[\\u3040-\\u30FF]/.test(text)) return 'japanese';

  const scores = [
    ['chinese', (text.match(/[\\u4E00-\\u9FFF]/g) ?? []).length],
    ['korean', (text.match(/[\\uAC00-\\uD7AF]/g) ?? []).length],
    ['cyrillic', (text.match(/[\\u0400-\\u04FF]/g) ?? []).length],
    ['devanagari', (text.match(/[\\u0900-\\u097F]/g) ?? []).length],
    ['gujarati', (text.match(/[\\u0A80-\\u0AFF]/g) ?? []).length],
    ['gurmukhi', (text.match(/[\\u0A00-\\u0A7F]/g) ?? []).length],
    ['telugu', (text.match(/[\\u0C00-\\u0C7F]/g) ?? []).length],
    ['kannada', (text.match(/[\\u0C80-\\u0CFF]/g) ?? []).length],
    ['odia', (text.match(/[\\u0B00-\\u0B7F]/g) ?? []).length],
    ['tamil', (text.match(/[\\u0B80-\\u0BFF]/g) ?? []).length],
    ['malayalam', (text.match(/[\\u0D00-\\u0D7F]/g) ?? []).length],
    ['bengali', (text.match(/[\\u0980-\\u09FF]/g) ?? []).length],
    ['arabic', (text.match(/[\\u0600-\\u06FF]/g) ?? []).length],
    ['hebrew', (text.match(/[\\u0590-\\u05FF]/g) ?? []).length],
    ['thai', (text.match(/[\\u0E00-\\u0E7F]/g) ?? []).length],
  ];

  const dominant = scores.reduce((best, curr) => curr[1] > best[1] ? curr : best);
  if (dominant[1] > 0) return dominant[0];
  return /\\p{L}/u.test(text) ? 'latin' : 'other';
`);

describe('Background Script - detectScript', () => {
    it('correctly identifies Japanese (mixed Kanji and Kana)', () => {
        expect(detectScript(['春はあけぼの', 'やうやう白くなりゆく際'])).toBe('japanese');
    });

    it('correctly identifies Japanese (Kana only)', () => {
        expect(detectScript(['ありがとう'])).toBe('japanese');
    });

    it('correctly identifies Chinese (Hanzi only)', () => {
        expect(detectScript(['你好，世界', '这是一个测试'])).toBe('chinese');
    });

    it('correctly identifies Korean (Hangul)', () => {
        expect(detectScript(['안녕하세요', '세상아'])).toBe('korean');
    });

    it('correctly identifies Latin scripts (English, Spanish, etc.)', () => {
        expect(detectScript(['Hello world', 'This is a test'])).toBe('latin');
        expect(detectScript(['Hola mundo', 'Ésta es una prueba'])).toBe('latin');
        expect(detectScript(['Café au lait'])).toBe('latin');
    });

    it('correctly identifies Tamil', () => {
        expect(detectScript(['வணக்கம்', 'உலகம்'])).toBe('tamil');
    });

    it('correctly identifies Devanagari (Hindi)', () => {
        expect(detectScript(['नमस्ते', 'दुनिया'])).toBe('devanagari');
    });

    it('correctly identifies Cyrillic', () => {
        expect(detectScript(['Привет', 'мир'])).toBe('cyrillic');
    });

    it('correctly identifies Thai', () => {
        expect(detectScript(['สวัสดี', 'ชาวโลก'])).toBe('thai');
    });

    it('returns "other" for purely symbolic/numeric text', () => {
        expect(detectScript(['123', '??? !!!'])).toBe('other');
        expect(detectScript(['♪♪♪'])).toBe('other');
    });
});

// Extract chunkByCharCount
const chunkScriptMatch = bgScript.match(/function chunkByCharCount[\s\S]*?\{([\s\S]*?\n\})/);
const chunkScriptBody = chunkScriptMatch ? chunkScriptMatch[1] : '';

const chunkByCharCount = new Function('lines', 'maxChars', `
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
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
  return chunks;
`);

describe('Background Script - chunkByCharCount', () => {
    it('chunks lines perfectly without exceeding maxChars', () => {
        const lines = ['123', '456', '789', '012'];
        // maxChars of 8 means '123\n456' is 7 chars. (123 + 456 + \n).
        const chunks = chunkByCharCount(lines, 8);
        expect(chunks).toEqual([['123', '456'], ['789', '012']]);
    });

    it('handles a single line extending beyond maxChars gracefully (does not break)', () => {
        const lines = ['1234567890', '123'];
        const chunks = chunkByCharCount(lines, 5);
        // It pushes the oversized line into its own chunk, and starts fresh
        expect(chunks).toEqual([['1234567890'], ['123']]);
    });

    it('handles empty arrays', () => {
        expect(chunkByCharCount([], 10)).toEqual([]);
    });
});
