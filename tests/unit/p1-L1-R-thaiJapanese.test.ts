import { describe, it, expect, vi, beforeEach } from 'vitest';

// Common single words and invented phrases only (not lyrics of any song).

// ─── Thai ────────────────────────────────────────────────────────────────────
import { romanizeThaiWord, romanizeThaiLine } from '../../lib/lyrics/thaiRomanizer';

describe('romanizeThaiWord: RTGS without tone marks', () => {
  it.each([
    ['ฉัน', 'chan'], ['รัก', 'rak'], ['คุณ', 'khun'],
    ['คืน', 'khuen'],        // ื with a final consonant
    ['สุข', 'suk'],           // final ข sounds k
    ['ใคร', 'khrai'],         // leading vowel before a cluster
    ['เหมือน', 'muean'],      // silent leading ห
    ['อยู่', 'yu'],           // silent leading อ
    ['ห่วง', 'huang'],        // ห + ว + final is "hua", not a silent ห
    ['สวย', 'suai'],          // ว as the vowel "ua"
    ['ความ', 'khwam'],        // ว in a cluster
    ['แล้ว', 'laeo'], ['เดียว', 'diao'], ['เลย', 'loei'], ['ไทย', 'thai'],
    ['คน', 'khon'],           // no written vowel, closed: "o"
    ['สบาย', 'sabai'],        // no written vowel, open: "a"
    ['ถนน', 'thanon'], ['ตลอด', 'talot'], ['เสมอ', 'samoe'],
    ['จันทร์', 'chan'],       // silent letters under ์
    ['กรรม', 'kam'], ['จริง', 'ching'], ['ทราย', 'sai'], ['ก็', 'ko'],
    ['โกหก', 'kohok'],        // ห never closes a syllable
    ['เพลง', 'phleng'], ['ครอบครัว', 'khropkhrua'], ['อังกฤษ', 'angkrit'],
    ['เเล้ว', 'laeo'],         // เเ typed for แ
    ['โทร', 'tho'], ['ทรมาน', 'thoraman'], ['สวรรค์', 'sawan'], // irregular words
  ])('%s → %s', (word, roman) => {
    expect(romanizeThaiWord(word)).toBe(roman);
  });

  it('returns null for text it cannot read as Thai syllables', () => {
    expect(romanizeThaiWord('ั')).toBeNull();
  });
});

describe('romanizeThaiLine: one Latin word per Thai word', () => {
  it('splits words that Thai writes without spaces', () => {
    expect(romanizeThaiLine('ฉันรักคุณ')).toBe('chan rak khun');
    expect(romanizeThaiLine('ขอให้เธอมีความสุข')).toBe('kho hai thoe mi khwam suk');
  });

  it('repeats a word marked with ๆ and keeps spaces, Latin text and punctuation', () => {
    expect(romanizeThaiLine('ช้าๆ ได้ไหม')).toBe('cha cha dai mai');
    expect(romanizeThaiLine('OK ที่รัก!')).toBe('OK thirak!');
  });
});

// ─── Japanese ────────────────────────────────────────────────────────────────
import { romanizeJapaneseTokens, type JapaneseToken } from '../../lib/lyrics/japaneseRomanizer';

/** Tokens as kuromoji gives them: [surface, pos, pos_detail_1, basic_form, reading]. */
const tok = (rows: [string, string, string, string, string?][]): JapaneseToken[] =>
  rows.map(([surface_form, pos, pos_detail_1, basic_form, reading]) => ({ surface_form, pos, pos_detail_1, basic_form, reading }));

describe('romanizeJapaneseTokens: words, not morphemes', () => {
  it('joins a verb with its endings and keeps particles apart (は wa, を o, へ e)', () => {
    expect(romanizeJapaneseTokens(tok([
      ['東京', '名詞', '固有名詞', '東京', 'トウキョウ'], ['の', '助詞', '連体化', 'の', 'ノ'],
      ['街', '名詞', '一般', '街', 'マチ'], ['を', '助詞', '格助詞', 'を', 'ヲ'],
      ['歩い', '動詞', '自立', '歩く', 'アルイ'], ['て', '助詞', '接続助詞', 'て', 'テ'],
      ['い', '動詞', '非自立', 'いる', 'イ'], ['た', '助動詞', '*', 'た', 'タ'],
    ]))).toBe('toukyou no machi o aruite ita');
    expect(romanizeJapaneseTokens(tok([
      ['私', '名詞', '代名詞', '私', 'ワタシ'], ['は', '助詞', '係助詞', 'は', 'ハ'],
      ['未来', '名詞', '一般', '未来', 'ミライ'], ['へ', '助詞', '格助詞', 'へ', 'ヘ'],
    ]))).toBe('watashi wa mirai e');
  });

  it('romanizes a small っ across morphemes (散っ+て), and keeps auxiliaries after a noun apart', () => {
    expect(romanizeJapaneseTokens(tok([
      ['散っ', '動詞', '自立', '散る', 'チッ'], ['て', '助詞', '接続助詞', 'て', 'テ'], ['いく', '動詞', '非自立', 'いく', 'イク'],
    ]))).toBe('chitte iku');
    expect(romanizeJapaneseTokens(tok([
      ['好き', '名詞', '形容動詞語幹', '好き', 'スキ'], ['だっ', '助動詞', '*', 'だ', 'ダッ'], ['た', '助動詞', '*', 'た', 'タ'],
    ]))).toBe('suki datta');
  });

  it('joins contracted helpers (てる) and ば, keeps でしょう apart from the verb', () => {
    expect(romanizeJapaneseTokens(tok([
      ['愛し', '動詞', '自立', '愛す', 'アイシ'], ['てる', '動詞', '非自立', 'てる', 'テル'],
    ]))).toBe('aishiteru');
    expect(romanizeJapaneseTokens(tok([
      ['夢', '名詞', '一般', '夢', 'ユメ'], ['なら', '助動詞', '*', 'だ', 'ナラ'], ['ば', '助詞', '接続助詞', 'ば', 'バ'],
      ['よかっ', '形容詞', '自立', 'よい', 'ヨカッ'], ['た', '助動詞', '*', 'た', 'タ'],
      ['でしょ', '助動詞', '*', 'です', 'デショ'], ['う', '助動詞', '*', 'う', 'ウ'],
    ]))).toBe('yume naraba yokatta deshou');
  });

  it('leaves a kanji the dictionary has no reading for as written', () => {
    expect(romanizeJapaneseTokens(tok([['昏', '名詞', '一般', '*'], ['い', '形容詞', '自立', 'い', 'イ']]))).toContain('昏');
  });

  it('joins noun suffixes, leaves ください apart, and keeps Latin words and punctuation', () => {
    expect(romanizeJapaneseTokens(tok([
      ['僕', '名詞', '代名詞', '僕', 'ボク'], ['たち', '名詞', '接尾', 'たち', 'タチ'],
    ]))).toBe('bokutachi');
    expect(romanizeJapaneseTokens(tok([
      ['見せ', '動詞', '自立', '見せる', 'ミセ'], ['て', '助詞', '接続助詞', 'て', 'テ'], ['ください', '動詞', '非自立', 'くださる', 'クダサイ'],
    ]))).toBe('misete kudasai');
    expect(romanizeJapaneseTokens(tok([
      ['「', '記号', '括弧開', '「'], ['好き', '名詞', '形容動詞語幹', '好き', 'スキ'], ['」', '記号', '括弧閉', '」'],
      ['Baby', '名詞', '固有名詞', '*'], [' ', '記号', '空白', '*'], ['どこ', '名詞', '代名詞', 'どこ', 'ドコ'], ['？', '記号', '一般', '？'],
    ]))).toBe('"suki" Baby doko?');
  });
});

describe('Japanese when the dictionary cannot be loaded', () => {
  beforeEach(() => { vi.resetModules(); });

  it('romanizeLocally rejects instead of reading kanji as Chinese', async () => {
    vi.doMock('@sglkc/kuroshiro-analyzer-kuromoji', () => ({
      default: class { init() { return Promise.reject(new Error('dictionary unreachable')); } parse() { return Promise.resolve([]); } },
    }));
    const { romanizeLocally } = await import('../../lib/lyrics/localRomanizer');
    await expect(romanizeLocally(['君を愛してる'], 'japanese')).rejects.toThrow('dictionary unreachable');
    vi.doUnmock('@sglkc/kuroshiro-analyzer-kuromoji');
  });

  it('a dictionary that never finishes loading is given up on after the wait', async () => {
    vi.doMock('@sglkc/kuroshiro-analyzer-kuromoji', () => ({
      default: class { init() { return new Promise(() => {}); } parse() { return Promise.resolve([]); } },
    }));
    const { getJapaneseAnalyzer } = await import('../../lib/lyrics/japaneseRomanizer');
    await expect(getJapaneseAnalyzer(20)).rejects.toThrow('not loaded after 20 ms');
    vi.doUnmock('@sglkc/kuroshiro-analyzer-kuromoji');
  });

  it('processLines uses Google\'s romanization instead, and flags the result only when that fails too', async () => {
    vi.doMock('../../lib/lyrics/localRomanizer', () => ({ romanizeLocally: vi.fn().mockRejectedValue(new Error('dictionary unreachable')) }));
    const googleRomanize = vi.fn().mockResolvedValue(['kimi o aishiteru']);
    vi.doMock('../../lib/translateClient', () => ({
      googleProcess: vi.fn().mockResolvedValue({ translated: ['I love you'], romanized: ['君を愛してる'] }),
      googleRomanize,
    }));
    const { processLines } = await import('../../lib/lyrics/lyricsProcessor');

    const ok = await processLines(['君を愛してる'], 'en');
    expect(ok.romanized).toEqual(['kimi o aishiteru']);
    expect(ok.isLowQualityRomanization).toBeUndefined();
    expect(googleRomanize).toHaveBeenCalledWith(['君を愛してる'], 'ja');

    googleRomanize.mockResolvedValue(null);
    const flagged = await processLines(['君を愛してる'], 'en');
    expect(flagged.isLowQualityRomanization).toBe(true);
    vi.doUnmock('../../lib/lyrics/localRomanizer');
    vi.doUnmock('../../lib/translateClient');
  });

  it('only the lines with an unread kanji are asked of Google', async () => {
    vi.doMock('../../lib/lyrics/localRomanizer', () => ({ romanizeLocally: vi.fn().mockResolvedValue(['kimi', '昏 i mama']) }));
    const googleRomanize = vi.fn().mockResolvedValue(['kurai mama']);
    vi.doMock('../../lib/translateClient', () => ({
      googleProcess: vi.fn().mockResolvedValue({ translated: ['you', 'dark'], romanized: [] }),
      googleRomanize,
    }));
    const { processLines } = await import('../../lib/lyrics/lyricsProcessor');
    const res = await processLines(['君', '昏いまま'], 'en');
    expect(googleRomanize).toHaveBeenCalledWith(['昏いまま'], 'ja');
    expect(res.romanized).toEqual(['kimi', 'kurai mama']);
    expect(res.isLowQualityRomanization).toBeUndefined();
    vi.doUnmock('../../lib/lyrics/localRomanizer');
    vi.doUnmock('../../lib/translateClient');
  });
});

describe('googleRomanize: line for line, or nothing', () => {
  beforeEach(() => { vi.resetModules(); });

  it('splits Google\'s answer on the separator, and gives up when the line count differs', async () => {
    const googleTranslate = vi.fn();
    vi.doMock('../../lib/translate/googleApi', () => ({ googleTranslate }));
    const { googleRomanize } = await import('../../lib/translateClient');

    googleTranslate.mockResolvedValueOnce({ translated: 'x', romanized: 'Kimi o aishi teru | ashita mata aimashō' });
    expect(await googleRomanize(['君を愛してる', '', '明日また会いましょう'], 'ja'))
      .toEqual(['Kimi o aishi teru', '', 'ashita mata aimashō']);
    expect(googleTranslate.mock.calls[0][0]).toBe('君を愛してる | 明日また会いましょう');

    googleTranslate.mockResolvedValueOnce({ translated: 'x', romanized: 'Kimi o aishi teru ashita mata aimashō' });
    expect(await googleRomanize(['君を愛してる', '明日また会いましょう'], 'ja')).toBeNull();

    googleTranslate.mockRejectedValueOnce(new Error('Google HTTP 429'));
    expect(await googleRomanize(['君を愛してる'], 'ja')).toBeNull();
    vi.doUnmock('../../lib/translate/googleApi');
  });
});

describe('saved Thai and Japanese romanizations from before version 3', () => {
  it('are redone once; Hindi from version 2, Chinese and Korean are kept', async () => {
    const { getStoredEntryDefect, ROMANIZER_VERSION } = await import('../../lib/core/processedCache');
    expect(ROMANIZER_VERSION).toBe(3);
    const thai = { romanized: ['chanrakkhun'], translated: null, romanizerVersion: 2 };
    expect(getStoredEntryDefect(['ฉันรักคุณ'], 'en', thai)).toBe('romanized with an older romanizer');
    expect(getStoredEntryDefect(['ฉันรักคุณ'], 'en', { ...thai, romanizerVersion: 3 })).toBeNull();
    expect(getStoredEntryDefect(['君を愛してる'], 'en', { romanized: ['kimi o aishi teru'], translated: null, romanizerVersion: 2 }))
      .toBe('romanized with an older romanizer');
    expect(getStoredEntryDefect(['हम'], 'en', { romanized: ['ham'], translated: null, romanizerVersion: 2 })).toBeNull();
    expect(getStoredEntryDefect(['我爱你'], 'en', { romanized: ['wo ai ni'], translated: null, romanizerVersion: 2 })).toBeNull();
    expect(getStoredEntryDefect(['안녕'], 'en', { romanized: ['annyeong'], translated: null })).toBeNull();
  });
});
