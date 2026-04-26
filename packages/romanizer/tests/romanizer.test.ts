import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const analyzerCtor = vi.fn(function MockKuromojiAnalyzer(this: { opts: unknown }, opts: unknown) {
    this.opts = opts;
  });
  const mockInit = vi.fn(async () => undefined);
  const mockConvert = vi.fn(async (line: string) => `jp:${line}`);
  return { analyzerCtor, mockInit, mockConvert };
});

vi.mock('@sglkc/kuroshiro-analyzer-kuromoji', () => ({
  default: hoisted.analyzerCtor,
}));

vi.mock('@sglkc/kuroshiro', () => ({
  default: class MockKuroshiro {
    init = hoisted.mockInit;
    convert = hoisted.mockConvert;
  },
}));

import { createRomanizer } from '../src/romanizer.js';
import { UnsupportedRomanizationError } from '../src/types.js';

describe('romanizer', () => {
  beforeEach(() => {
    hoisted.analyzerCtor.mockClear();
    hoisted.mockInit.mockClear();
    hoisted.mockConvert.mockClear();
  });

  it('returns no-op for latin lines', async () => {
    const romanizer = createRomanizer();
    const result = await romanizer.romanizeLines(['Hello world']);
    expect(result.script).toBe('latin');
    expect(result.lines).toEqual(['Hello world']);
  });

  it('romanizes chinese, korean, cyrillic, indic, tamil and thai locally', async () => {
    const romanizer = createRomanizer();

    const chinese = await romanizer.romanizeLines(['你好'], { script: 'chinese' });
    const korean = await romanizer.romanizeLines(['안녕하세요'], { script: 'korean' });
    const cyrillic = await romanizer.romanizeLines(['Привет'], { script: 'cyrillic' });
    const devanagari = await romanizer.romanizeLines(['नमस्ते'], { script: 'devanagari' });
    const tamil = await romanizer.romanizeLines(['வணக்கம்'], { script: 'tamil' });
    const thai = await romanizer.romanizeLines(['สวัสดี'], { script: 'thai' });

    expect(chinese.lines[0]).not.toMatch(/[\u4E00-\u9FFF]/);
    expect(korean.lines[0]).not.toMatch(/[\uAC00-\uD7AF]/);
    expect(cyrillic.lines[0]).not.toMatch(/[\u0400-\u04FF]/);
    expect(devanagari.lines[0]).not.toMatch(/[\u0900-\u097F]/);
    expect(tamil.lines[0]).not.toMatch(/[\u0B80-\u0BFF]/);
    expect(thai.lines[0]).not.toMatch(/[\u0E00-\u0E7F]/);
  });

  it('uses mocked japanese engine and custom dict path', async () => {
    const romanizer = createRomanizer({ japaneseDictPath: 'mock://dict' });
    const output = await romanizer.romanizeLine('ありがとう', { script: 'japanese' });

    expect(output).toBe('jp:ありがとう');
    expect(hoisted.analyzerCtor).toHaveBeenCalledWith({ dictPath: 'mock://dict' });
    expect(hoisted.mockInit).toHaveBeenCalledTimes(1);
    expect(hoisted.mockConvert).toHaveBeenCalledWith('ありがとう', { to: 'romaji', mode: 'spaced' });
  });

  it('throws explicit error for external scripts', async () => {
    const romanizer = createRomanizer();
    await expect(romanizer.romanizeLines(['مرحبا'], { script: 'arabic' }))
      .rejects
      .toBeInstanceOf(UnsupportedRomanizationError);
  });
});
