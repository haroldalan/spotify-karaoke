import { describe, it, expect, vi, beforeEach } from 'vitest';

// Synthetic text only (no song lyrics).
vi.mock('../../lib/translateClient', () => ({
  googleProcess: vi.fn(),
  googleRomanize: vi.fn(),
}));
vi.mock('../../lib/lyrics/localRomanizer', () => ({
  romanizeLocally: vi.fn(),
}));

import { googleProcess } from '../../lib/translateClient';
import { romanizeLocally } from '../../lib/lyrics/localRomanizer';
import { processLines, resolveSourceLang, cleanRomanizedLine } from '../../lib/lyrics/lyricsProcessor';

const mockGoogle = googleProcess as unknown as ReturnType<typeof vi.fn>;
const mockLocal = romanizeLocally as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGoogle.mockReset();
  mockLocal.mockReset();
});

describe('processLines — translation failure keeps local romanization (K1)', () => {
  it('returns translated:null + translationFailed with the local romanization when the translator throws', async () => {
    const lines = ['テストです', '', 'もうひとつ'];
    mockGoogle.mockRejectedValue(new Error('Google HTTP 429'));
    mockLocal.mockResolvedValue(['tesuto desu', '', 'mou hitotsu']);

    const res = await processLines(lines, 'en');

    expect(res.translated).toBeNull();
    expect(res.translationFailed).toBe(true);
    expect(res.romanized).toEqual(['tesuto desu', '', 'mou hitotsu']);
    expect(res.romanized).toHaveLength(lines.length);
  });

  it('never echoes the original lines as a translation for Latin-script lyrics', async () => {
    const lines = ['hello test line', 'second test line'];
    mockGoogle.mockRejectedValue(new Error('offline'));

    const res = await processLines(lines, 'es');

    expect(res.translated).toBeNull();
    expect(res.translationFailed).toBe(true);
    expect(res.romanized).toEqual(lines);
  });

  it('falls back to local romanization when Google-romanized scripts fail entirely', async () => {
    const lines = ['আমি পরীক্ষা'];
    mockGoogle.mockRejectedValue(new Error('Google non-JSON (captcha)'));
    mockLocal.mockResolvedValue(['ami porikkha']);

    const res = await processLines(lines, 'en');

    expect(res.translated).toBeNull();
    expect(res.translationFailed).toBe(true);
    expect(res.isLowQualityRomanization).toBe(true);
    expect(res.romanized).toEqual(['ami porikkha']);
  });

  it('returns the translation when it succeeds', async () => {
    const lines = ['テストです'];
    mockGoogle.mockResolvedValue({ translated: ['It is a test'], romanized: lines });
    mockLocal.mockResolvedValue(['tesuto desu']);

    const res = await processLines(lines, 'en');

    expect(res.translated).toEqual(['It is a test']);
    expect(res.translationFailed).toBeUndefined();
    expect(res.romanized).toEqual(['tesuto desu']);
  });
});

describe('resolveSourceLang — Spotify language is only a hint (K1)', () => {
  it('never uses the hint for Latin-script text', () => {
    expect(resolveSourceLang('latin', 'id')).toBe('auto');
    expect(resolveSourceLang('latin', 'hi')).toBe('auto');
  });

  it('uses a hint that is plausible for the detected script', () => {
    expect(resolveSourceLang('devanagari', 'mr')).toBe('mr');
    expect(resolveSourceLang('cyrillic', 'uk')).toBe('uk');
    expect(resolveSourceLang('arabic', 'ur')).toBe('ur');
    expect(resolveSourceLang('bengali', 'as')).toBe('as');
    expect(resolveSourceLang('cyrillic', 'UK-ua')).toBe('uk');
  });

  it('keeps the per-script default when the hint does not fit the script', () => {
    expect(resolveSourceLang('arabic', 'id')).toBe('ar');
    expect(resolveSourceLang('cyrillic', 'hi')).toBe('ru');
    expect(resolveSourceLang('devanagari', null)).toBe('hi');
    expect(resolveSourceLang('japanese', 'ko')).toBe('ja');
  });

  it('translates a Marathi-tagged Devanagari song into Hindi (shortcut uses the resolved source)', async () => {
    const lines = ['परीक्षा ओळ'];
    mockGoogle.mockResolvedValue({ translated: ['परीक्षा पंक्ति'], romanized: lines });
    mockLocal.mockResolvedValue(['pariksha oli']);

    const res = await processLines(lines, 'hi', 'mr');

    expect(mockGoogle).toHaveBeenCalledWith(lines, 'hi', false, 'mr');
    expect(res.translated).toEqual(['परीक्षा पंक्ति']);
  });

  it('skips translation when the resolved source already is the target', async () => {
    const lines = ['परीक्षा पंक्ति'];
    mockLocal.mockResolvedValue(['pariksha pankti']);

    const res = await processLines(lines, 'hi');

    expect(mockGoogle).not.toHaveBeenCalled();
    expect(res.translated).toEqual(lines);
    expect(res.romanized).toEqual(['pariksha pankti']);
  });

  it('passes auto (not the wrong Spotify tag) for romanized Latin text', async () => {
    const lines = ['mera test gaana'];
    mockGoogle.mockResolvedValue({ translated: ['my test song'], romanized: lines });

    await processLines(lines, 'en', 'id');

    expect(mockGoogle).toHaveBeenCalledWith(lines, 'en', false, 'auto');
  });
});

describe('Latin-only diacritic stripping', () => {
  it('keeps untouched Japanese text byte-identical (no NFD decomposition)', () => {
    // 'が' (U+304C) decomposes under NFD into か + U+3099.
    const ja = 'がぎぐげご テスト';
    expect(cleanRomanizedLine(ja)).toBe(ja);
    expect(cleanRomanizedLine(ja, ja)).toBe(ja);
  });

  it('keeps untouched Devanagari nukta letters byte-identical', () => {
    // U+0958 is a composition exclusion: NFC(NFD(x)) !== x.
    const hi = 'क़़र';
    expect(cleanRomanizedLine(hi)).toBe(hi);
  });

  it('strips diacritics from Latin output and normalises to NFC', () => {
    expect(cleanRomanizedLine('tōkyō')).toBe('tokyo');
    expect(cleanRomanizedLine('parikṣā')).toBe('pariksa');
    expect(cleanRomanizedLine('ʼanā')).toBe('ʼana');
  });

  it('processLines returns untouched native lines byte-identical to the input', async () => {
    const lines = ['がっこう テスト', 'ぱぴぷぺぽ'];
    // Target ja → native shortcut; the romanizer leaves line 2 untouched (e.g. failure).
    mockLocal.mockResolvedValue(['gakkō tesuto', 'ぱぴぷぺぽ']);

    const res = await processLines(lines, 'ja');

    expect(res.translated).toEqual(lines);
    expect(res.romanized[0]).toBe('gakko tesuto');
    expect(res.romanized[1]).toBe(lines[1]);
    expect(res.romanized[1].length).toBe(lines[1].length);
  });
});
