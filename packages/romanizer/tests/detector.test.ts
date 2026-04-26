import { describe, expect, it } from 'vitest';
import { detectScript, isLatinScript } from '../src/detector.js';

describe('detector', () => {
  it('detects japanese', () => {
    expect(detectScript(['春はあけぼの', 'やうやう白くなりゆく際'])).toBe('japanese');
  });

  it('detects chinese', () => {
    expect(detectScript(['你好，世界', '这是一个测试'])).toBe('chinese');
  });

  it('detects korean', () => {
    expect(detectScript(['안녕하세요', '세상아'])).toBe('korean');
  });

  it('detects cyrillic', () => {
    expect(detectScript(['Привет', 'мир'])).toBe('cyrillic');
  });

  it('detects devanagari', () => {
    expect(detectScript(['नमस्ते', 'दुनिया'])).toBe('devanagari');
  });

  it('detects tamil', () => {
    expect(detectScript(['வணக்கம்', 'உலகம்'])).toBe('tamil');
  });

  it('detects thai', () => {
    expect(detectScript(['สวัสดี', 'ชาวโลก'])).toBe('thai');
  });

  it('detects latin and symbols', () => {
    expect(detectScript(['Hello world', 'Café au lait'])).toBe('latin');
    expect(detectScript(['123', '??? !!!'])).toBe('other');
  });

  it('matches latin fast-path expectations', () => {
    expect(isLatinScript(['Hello world'])).toBe(true);
    expect(isLatinScript(['안녕하세요'])).toBe(false);
    expect(isLatinScript(['♪♪♪'])).toBe(false);
  });
});
