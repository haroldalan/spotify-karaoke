// Japanese romanization by word, the way lyric sites write it:
// "君を愛してる" -> "kimi o aishiteru", "東京の街を歩いていた" -> "toukyou no machi o aruite ita".
// Ported from Spotify Karaoke 3.1.6 (lib/lyrics/japaneseRomanizer.ts).
//
// kuromoji splits a line into morphemes with readings. Morphemes of one word are joined
// before romanizing (a verb with its endings: 歩い+て, い+た; a noun with its suffix:
// 僕+たち). Particles stay separate and are read as pronounced (は wa, へ e, を o). A kanji
// the dictionary has no reading for is left as written; romanize.ts asks Google for those
// lines.
//
// The dictionary (~17 MB) is fetched from jsDelivr on first use and kept by the HTTP cache.
import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';

export const DICT_PATH = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/';
/** How long one romanization waits for the dictionary; the download continues in the background. */
export const DICT_WAIT_MS = 20_000;

export interface JapaneseToken {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  basic_form: string;
  reading?: string;
}

interface Analyzer {
  parse(text: string): Promise<JapaneseToken[]>;
}

let analyzerReady: Promise<Analyzer> | null = null;

function loadAnalyzer(): Promise<Analyzer> {
  if (!analyzerReady) {
    analyzerReady = (async () => {
      const analyzer = new KuromojiAnalyzer({ dictPath: DICT_PATH }) as unknown as Analyzer & { init(): Promise<void> };
      await analyzer.init();
      return analyzer;
    })();
    analyzerReady.catch(() => { analyzerReady = null; }); // retried on the next call
  }
  return analyzerReady;
}

/** The analyzer, or a rejection when the dictionary isn't loaded within waitMs. */
export async function japaneseAnalyzer(waitMs = DICT_WAIT_MS): Promise<Analyzer> {
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

/** Whether token t belongs to the word before it. */
function joinsPrevious(t: JapaneseToken, prev: JapaneseToken | undefined): boolean {
  if (!prev || prev.pos === '記号') return false;
  // Verb and adjective endings (会い+ましょ+う, 忘れ+ない). After a noun (好き+だった) they stay
  // apart, as do the copulas です and だ, though their own endings join (だっ+た).
  if (t.pos === '助動詞') {
    if (t.basic_form === 'です' || t.basic_form === 'だ') return false;
    return isVerbLike(prev);
  }
  // Connectives: 歩い+て, 叫ん+で, なら+ば.
  if (t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && ['て', 'で', 'ば'].includes(t.surface_form)) return isVerbLike(prev);
  // Contracted helpers join the verb (愛し+てる); a helper verb after て stays a word of its
  // own (歩いて いた, 教えて くれた), and so does ください.
  if ((t.pos === '動詞' || t.pos === '形容詞') && t.pos_detail_1 === '非自立') {
    return isVerbLike(prev) && t.basic_form !== 'くださる';
  }
  // Suffixes: 僕+たち.
  if (t.pos === '名詞' && t.pos_detail_1 === '接尾') return prev.pos === '名詞';
  return false;
}

const tokenKana = (t: JapaneseToken) => (t.reading && t.reading !== '*' ? t.reading : t.surface_form);
const kanaToRomaji = (kana: string): string =>
  (Kuroshiro as unknown as { Util: { kanaToRomaji(s: string, system: string): string } }).Util.kanaToRomaji(kana, 'hepburn');

/** Romanizes one tokenized line. */
export function romanizeJapaneseTokens(tokens: JapaneseToken[]): string {
  const words: string[] = [];
  let kana = '';
  let opener = ''; // an opening quote or bracket, written before the next word
  const push = (word: string) => {
    words.push(opener + word);
    opener = '';
  };
  const flush = () => {
    if (kana) push(kanaToRomaji(kana));
    kana = '';
  };
  let prev: JapaneseToken | undefined;
  for (const t of tokens) {
    if (t.pos === '記号') {
      flush();
      if (!/^\s+$/.test(t.surface_form)) {
        const p = PUNCTUATION[t.surface_form] ?? t.surface_form;
        if (p === '"' && words.join(' ').split('"').length % 2 === 1) opener += p;
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

/** Romanizes Japanese lines. Rejects when the dictionary can't be loaded in time. */
export async function romanizeJapanese(lines: string[], waitMs = DICT_WAIT_MS): Promise<string[]> {
  const analyzer = await japaneseAnalyzer(waitMs);
  return Promise.all(lines.map(async (line) => (!/\p{L}/u.test(line) ? line : romanizeJapaneseTokens(await analyzer.parse(line)))));
}
