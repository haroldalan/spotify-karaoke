// Ported from Spotify Karaoke 3.1.6 (tests/unit/p1-L1-R-thaiJapanese.test.ts).
// Common single words and invented phrases only (not lyrics of any song).
import { describe, expect, it, vi } from 'vitest';
import { romanizeThaiLine, romanizeThaiWord } from '../../src/background/text/thai';
import { romanizeJapaneseTokens, type JapaneseToken } from '../../src/background/text/japanese';

describe('Thai: RTGS without tone marks', () => {
  it.each([
    ['ฉัน', 'chan'], ['รัก', 'rak'], ['คุณ', 'khun'], ['คืน', 'khuen'], ['สุข', 'suk'], ['ใคร', 'khrai'],
    ['เหมือน', 'muean'], ['อยู่', 'yu'], ['ห่วง', 'huang'], ['สวย', 'suai'], ['ความ', 'khwam'],
    ['แล้ว', 'laeo'], ['เดียว', 'diao'], ['เลย', 'loei'], ['ไทย', 'thai'], ['คน', 'khon'], ['สบาย', 'sabai'],
    ['ถนน', 'thanon'], ['ตลอด', 'talot'], ['เสมอ', 'samoe'], ['จันทร์', 'chan'], ['กรรม', 'kam'], ['จริง', 'ching'],
    ['ทราย', 'sai'], ['ก็', 'ko'], ['โกหก', 'kohok'], ['เพลง', 'phleng'], ['ครอบครัว', 'khropkhrua'],
    ['อังกฤษ', 'angkrit'], ['เเล้ว', 'laeo'], ['โทร', 'tho'], ['ทรมาน', 'thoraman'], ['สวรรค์', 'sawan'],
  ])('%s -> %s', (word, roman) => {
    expect(romanizeThaiWord(word)).toBe(roman);
  });

  it('splits words Thai writes without spaces, repeats ๆ, keeps Latin text', () => {
    expect(romanizeThaiLine('ฉันรักคุณ')).toBe('chan rak khun');
    expect(romanizeThaiLine('ขอให้เธอมีความสุข')).toBe('kho hai thoe mi khwam suk');
    expect(romanizeThaiLine('ช้าๆ ได้ไหม')).toBe('cha cha dai mai');
    expect(romanizeThaiLine('OK ที่รัก!')).toBe('OK thirak!');
  });
});

/** Tokens as kuromoji gives them: [surface, pos, pos_detail_1, basic_form, reading]. */
const tok = (rows: [string, string, string, string, string?][]): JapaneseToken[] =>
  rows.map(([surface_form, pos, pos_detail_1, basic_form, reading]) => ({ surface_form, pos, pos_detail_1, basic_form, reading }));

describe('Japanese: words, not morphemes', () => {
  it('joins a verb with its endings and reads particles as pronounced', () => {
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

  it('reads だった and a small っ across morphemes correctly', () => {
    expect(romanizeJapaneseTokens(tok([
      ['好き', '名詞', '形容動詞語幹', '好き', 'スキ'], ['だっ', '助動詞', '*', 'だ', 'ダッ'], ['た', '助動詞', '*', 'た', 'タ'],
    ]))).toBe('suki datta');
    expect(romanizeJapaneseTokens(tok([
      ['散っ', '動詞', '自立', '散る', 'チッ'], ['て', '助詞', '接続助詞', 'て', 'テ'], ['いく', '動詞', '非自立', 'いく', 'イク'],
    ]))).toBe('chitte iku');
  });

  it('joins てる and ば, keeps でしょう apart, joins noun suffixes, keeps punctuation', () => {
    expect(romanizeJapaneseTokens(tok([['愛し', '動詞', '自立', '愛す', 'アイシ'], ['てる', '動詞', '非自立', 'てる', 'テル']]))).toBe('aishiteru');
    expect(romanizeJapaneseTokens(tok([
      ['夢', '名詞', '一般', '夢', 'ユメ'], ['なら', '助動詞', '*', 'だ', 'ナラ'], ['ば', '助詞', '接続助詞', 'ば', 'バ'],
      ['よかっ', '形容詞', '自立', 'よい', 'ヨカッ'], ['た', '助動詞', '*', 'た', 'タ'],
      ['でしょ', '助動詞', '*', 'です', 'デショ'], ['う', '助動詞', '*', 'う', 'ウ'],
    ]))).toBe('yume naraba yokatta deshou');
    expect(romanizeJapaneseTokens(tok([['僕', '名詞', '代名詞', '僕', 'ボク'], ['たち', '名詞', '接尾', 'たち', 'タチ']]))).toBe('bokutachi');
    expect(romanizeJapaneseTokens(tok([
      ['「', '記号', '括弧開', '「'], ['好き', '名詞', '形容動詞語幹', '好き', 'スキ'], ['」', '記号', '括弧閉', '」'],
      ['Baby', '名詞', '固有名詞', '*'], [' ', '記号', '空白', '*'], ['どこ', '名詞', '代名詞', 'どこ', 'ドコ'], ['？', '記号', '一般', '？'],
    ]))).toBe('"suki" Baby doko?');
  });

  it('keeps English punctuation tight in a mixed line', () => {
    expect(romanizeJapaneseTokens(tok([
      ['涙', '名詞', '一般', '涙', 'ナミダ'], ['uneasy', '名詞', '一般', '*'], ['(', '名詞', 'サ変接続', '*'],
      ['heart', '名詞', '一般', '*'], [')', '名詞', 'サ変接続', '*'], ['you', '名詞', '一般', '*'], [',', '名詞', 'サ変接続', '*'], ['I', '名詞', '一般', '*'],
    ]))).toBe('namida uneasy (heart) you, I');
  });

  it('writes long vowels as letters, and joins passive endings to their verb', () => {
    expect(romanizeJapaneseTokens(tok([['ミルキー', '名詞', '一般', 'ミルキー', 'ミルキー'], ['ウェイ', '名詞', '一般', 'ウェイ', 'ウェイ']]))).toBe('mirukii wei');
    expect(romanizeJapaneseTokens(tok([
      ['ひか', '動詞', '自立', 'ひく', 'ヒカ'], ['れ', '動詞', '接尾', 'れる', 'レ'], ['ない', '助動詞', '*', 'ない', 'ナイ'],
    ]))).toBe('hikarenai');
  });

  it('leaves a kanji the dictionary has no reading for as written', () => {
    expect(romanizeJapaneseTokens(tok([['昏', '名詞', '一般', '*'], ['い', '形容詞', '自立', 'い', 'イ']]))).toContain('昏');
  });
});
