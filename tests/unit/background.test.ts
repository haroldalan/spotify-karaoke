import { describe, it, expect } from 'vitest';
import { detectScript, chunkByCharCount, processLines } from '../../entrypoints/background.ts';

// In WXT/Vitest, wxt sets up a mock browser environment automatically.

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

describe('Background Script - chunkByCharCount', () => {
    it('chunks lines perfectly without exceeding maxChars', () => {
        const lines = ['123', '456', '789', '012'];
        // maxChars of 8 means '123\n456' is 7 chars. (123 + 456 + \n).
        const result = chunkByCharCount(lines, 8);
        expect(result.chunks).toEqual([['123', '456'], ['789', '012']]);
        expect(result.wasTruncated).toBe(false);
    });

    it('handles a single line extending beyond maxChars gracefully (truncates to maintain index alignment)', () => {
        const lines = ['1234567890', '123'];
        const result = chunkByCharCount(lines, 5);
        // It truncates the oversized line to maxChars (5) and maintains the 1:1 line mapping
        expect(result.chunks).toEqual([['12345'], ['123']]);
        expect(result.wasTruncated).toBe(true);
    });

    it('handles empty arrays', () => {
        const result = chunkByCharCount([], 10);
        expect(result.chunks).toEqual([]);
        expect(result.wasTruncated).toBe(false);
    });
});
