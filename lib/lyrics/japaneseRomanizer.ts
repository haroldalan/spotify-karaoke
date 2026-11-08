/**
 * Japanese romanization by word, the way lyric sites write it:
 * "君を愛してる" → "kimi o aishiteru", "東京の街を歩いていた" → "toukyou no machi o aruite ita".
 *
 * The morphological analyzer (kuromoji) splits a line into morphemes with their
 * readings. Morphemes that belong to one word are joined before romanizing: a verb
 * with its endings (歩い+て, い+た), a noun with its suffix (僕+たち). Particles stay
 * separate words, read as pronounced (は "wa", へ "e", を "o"). A kanji the dictionary
 * does not know is left as written; lyricsProcessor asks Google for such lines.
 *
 * The analyzer needs a dictionary (about 17 MB) fetched from a CDN on first use.
 * When it cannot be loaded, romanizeJapaneseLines throws, so the caller can use
 * another source instead of showing kanji read as Chinese.
 */
import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';
import { hasFault } from '../testHooks';

export const JAPANESE_DICT_PATH = 'https://cdn.jsdelivr.net/npm/kuromoji/dict';
/** How long one romanization waits for the dictionary. The download keeps going in the background. */
export const JAPANESE_DICT_WAIT_MS = 20_000;

export interface JapaneseToken {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  basic_form: string;
  reading?: string;
  pronunciation?: string;
}

interface Analyzer {
  parse(str: string): Promise<JapaneseToken[]>;
}

let analyzerReady: Promise<Analyzer> | null = null;

function loadAnalyzer(): Promise<Analyzer> {
  if (!analyzerReady) {
    analyzerReady = (async () => {
      const analyzer = new KuromojiAnalyzer({ dictPath: JAPANESE_DICT_PATH }) as unknown as Analyzer & { init(): Promise<void> };
      await analyzer.init();
      return analyzer;
    })();
    // A failed load is retried on the next call.
    analyzerReady.catch(() => { analyzerReady = null; });
  }
  return analyzerReady;
}

/** The analyzer, or a rejection when the dictionary is not loaded within JAPANESE_DICT_WAIT_MS. */
export async function getJapaneseAnalyzer(waitMs = JAPANESE_DICT_WAIT_MS): Promise<Analyzer> {
  if (await hasFault('japaneseDictionary')) throw new Error('Japanese dictionary unreachable (test hook)');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadAnalyzer(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Japanese dictionary not loaded after ${waitMs} ms`)), waitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const PARTICLE_SOUND: Record<string, string> = { は: 'wa', へ: 'e', を: 'o' };
const PUNCTUATION: Record<string, string> = {
  '、': ',', '。': '.', '！': '!', '？': '?', '・': ' ', '「': '"', '」': '"', '『': '"', '』': '"',
  '（': '(', '）': ')', '〜': '~', '～': '~', '…': '...', '：': ':',
};

const isVerbLike = (t: JapaneseToken | undefined): boolean =>
  !!t && (t.pos === '動詞' || t.pos === '形容詞' || t.pos === '助動詞');

/** Whether token t is part of the word before it. */
function joinsPrevious(t: JapaneseToken, prev: JapaneseToken | undefined): boolean {
  if (!prev || prev.pos === '記号') return false;
  // Verb and adjective endings: 会い+ましょ+う, 忘れ+ない, 止まら+ない. After a noun (好き+だった) they
  // stay apart, and so do the copulas です and だ (よかった でしょう), though their own endings join (だっ+た).
  if (t.pos === '助動詞') {
    if (t.basic_form === 'です' || t.basic_form === 'だ') return false;
    return isVerbLike(prev);
  }
  // Connectives: 歩い+て, 叫ん+で, なら+ば.
  if (t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && ['て', 'で', 'ば'].includes(t.surface_form)) return isVerbLike(prev);
  // Contracted helpers join the verb (愛し+てる, 隠し+てた); a helper verb after て is a word of its
  // own, as lyric sites write it (歩いて いた, 教えて くれた, 散って いく).
  if ((t.pos === '動詞' || t.pos === '形容詞') && t.pos_detail_1 === '非自立') {
    return isVerbLike(prev) && t.basic_form !== 'くださる';
  }
  // Suffixes: 僕+たち, 君+たち.
  if (t.pos === '名詞' && t.pos_detail_1 === '接尾') return prev.pos === '名詞';
  return false;
}

function tokenKana(t: JapaneseToken): string {
  return t.reading && t.reading !== '*' ? t.reading : t.surface_form;
}

function romanizeKana(kana: string): string {
  return Kuroshiro.Util.kanaToRomaji(kana, 'hepburn');
}

/** Romanizes one tokenized line. Exported for tests. */
export function romanizeJapaneseTokens(tokens: JapaneseToken[]): string {
  const words: string[] = [];
  let kana = '';
  let opener = ''; // an opening quote or bracket, written before the next word
  const push = (word: string) => {
    words.push(opener + word);
    opener = '';
  };
  const flush = () => {
    if (kana) push(romanizeKana(kana));
    kana = '';
  };
  let prev: JapaneseToken | undefined;
  for (const t of tokens) {
    if (t.pos === '記号') {
      flush();
      if (!/^\s+$/.test(t.surface_form)) {
        const p = PUNCTUATION[t.surface_form] ?? t.surface_form;
        if (p === '"' && words.join(' ').split('"').length % 2 === 1) opener += p; // opening quote
        else if (p === '(') opener += p;
        else if (p.trim() === '') { /* ・ separates words */ }
        else if (words.length) words[words.length - 1] += p;
        else push(p);
      }
      prev = t;
      continue;
    }
    if (!joinsPrevious(t, prev)) flush();
    const particle = t.pos === '助詞' ? PARTICLE_SOUND[t.surface_form] : undefined;
    if (particle) push(particle);
    else kana += tokenKana(t);
    prev = t;
  }
  flush();
  if (opener) push('');
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/** Romanizes Japanese lines. Throws when the dictionary cannot be loaded. */
export async function romanizeJapaneseLines(lines: string[]): Promise<string[]> {
  const analyzer = await getJapaneseAnalyzer();
  return Promise.all(lines.map(async (line) => {
    if (!line.trim() || !/\p{L}/u.test(line)) return line;
    return romanizeJapaneseTokens(await analyzer.parse(line));
  }));
}
