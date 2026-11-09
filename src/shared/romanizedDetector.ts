// Ported from Spotify Karaoke 3.1.6 (lib/lyrics/romanizedDetector.ts).
/**
 * Decides whether a set of lyric lines is a *romanized fallback* of a
 * non-Latin-script song, using the text itself.
 *
 * Why: since late 2026 Spotify's color-lyrics `language` tag is unreliable for
 * romanized lyrics (e.g. romanized Hindi arrives tagged `"id"`, Indonesian), so
 * gating native-script restoration on the tag alone silently disables it.
 *
 * The detector scores the share of word tokens that belong to a curated
 * vocabulary of high-frequency romanized words per language. The lists avoid
 * words that are common in English, Spanish, Portuguese, French, Indonesian or
 * Malay so that genuine Latin-script songs are not flagged.
 */

export type RomanizedLang = 'hi' | 'pa' | 'ta' | 'te' | 'ml' | 'kn' | 'bn' | 'ja' | 'ko' | 'zh';

/** Languages whose native script is not Latin; a Latin-script lyric tagged with one of these is a romanized fallback. */
export const NON_LATIN_LANGS = new Set([
  'ko', 'ja', 'zh', 'th', 'hi', 'mr', 'ne', 'pa', 'gu', 'bn', 'as', 'or',
  'ta', 'te', 'kn', 'ml', 'si', 'ur', 'ar', 'fa', 'ps', 'he', 'iw', 'yi',
  'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'ky', 'mn', 'el', 'hy', 'ka',
  'am', 'my', 'km', 'lo',
]);

const VOCAB: Record<RomanizedLang, readonly string[]> = {
  hi: [
    'hai', 'hain', 'nahi', 'nahin', 'nahi', 'mein', 'mera', 'meri', 'mere', 'tera', 'teri', 'tere',
    'tum', 'hum', 'kya', 'kyun', 'kyon', 'kaise', 'yeh', 'woh', 'dil', 'pyaar', 'pyar', 'jaana',
    'karo', 'karta', 'karti', 'raha', 'rahi', 'rahe', 'hoon', 'tha', 'thi', 'bhi', 'toh', 'aaj',
    'saath', 'yaar', 'ishq', 'jaan', 'zindagi', 'aankhein', 'aankhon', 'sanam', 'mohabbat', 'dard',
    'kabhi', 'phir', 'tujhe', 'mujhe', 'tujhse', 'mujhse', 'apna', 'apni', 'apne', 'koi',
    'kuch', 'sab', 'jab', 'tab', 'yahan', 'wahan', 'kahan', 'chal', 'chala', 'chalta',
    'duaon', 'yaad', 'zubaan', 'naam', 'kiya', 'liya', 'diya', 'gaya', 'gayi', 'aaya', 'aayi',
    'hua', 'hui', 'aur', 'lekin', 'magar', 'bina', 'liye', 'wala', 'wali', 'tujh',
    'mujh', 'ji', 'sapna', 'sapne', 'raat', 'subah', 'shaam', 'baat', 'baatein', 'rab', 'khuda',
  ],
  pa: [
    'tainu', 'mainu', 'tenu', 'menu', 'kudi', 'kudiye', 'munde', 'sohniye', 'soniye', 'hun',
    'kithe', 'naal', 'vich', 'jatt', 'yaara', 'dilan', 'ankhiyan', 'channa', 'mahiya', 'mahi',
    'sajna', 'sajjna', 'ishqe', 'teriyan', 'meriyan', 'gallan', 'rabba', 'pyaar', 'nahi', 'tere',
  ],
  ta: [
    'naan', 'enna', 'unna', 'unnai', 'ennai', 'illa', 'illai', 'kadhal', 'kaadhal', 'kadhali',
    'manasu', 'nenjam', 'nenje', 'kanne', 'kanmani', 'ennoda', 'unnoda', 'endrum', 'oru', 'intha',
    'indha', 'antha', 'andha', 'aval', 'avan', 'pola', 'polae', 'mattum', 'venum', 'vendum', 'thaan',
    'dhaan', 'irukku', 'sollu', 'solla', 'paaru', 'paarthu', 'vaazhkai', 'uyire', 'uyir', 'anbe',
    'penne', 'kanna', 'nee', 'neeye', 'naane',
  ],
  te: [
    'nenu', 'nuvvu', 'naaku', 'neeku', 'ledu', 'undi', 'unnadi', 'prema', 'kosam', 'chala',
    'emi', 'enti', 'kaadu', 'gaani', 'cheppu', 'choodu', 'ammayi', 'abbayi', 'manasa', 'nee',
    'naa', 'okka', 'inka', 'ippudu', 'eppudu',
  ],
  ml: [
    'njan', 'ninne', 'ente', 'ninte', 'enthu', 'aanu', 'manassu', 'pranayam', 'sneham',
    'mazha', 'nee', 'njaan', 'ennum', 'ennil', 'ninnil', 'oru',
  ],
  kn: [
    'naanu', 'neenu', 'nanna', 'ninna', 'ninage', 'nanage', 'beku', 'preethi', 'hrudaya', 'hege',
    'yaake', 'illa', 'manasu',
  ],
  bn: [
    'tumi', 'bhalobasha', 'bhalobashi', 'keno', 'kotha', 'hridoy', 'ekhon', 'shudhu', 'achho',
    'chai', 'jabo', 'tomake', 'amake', 'kemon', 'amra', 'tomra', 'tomay', 'amay',
  ],
  ja: [
    'watashi', 'boku', 'kimi', 'anata', 'kokoro', 'yume', 'sora', 'dakara', 'shiteru', 'aishiteru',
    'sayonara', 'itsumo', 'zutto', 'mada', 'motto', 'namida', 'hikari', 'ashita', 'sekai', 'koi',
    'kaze', 'tsuki', 'hoshi', 'omoi', 'nai', 'desu', 'deshou', 'wo', 'kara', 'naze', 'mou',
  ],
  ko: [
    'saranghae', 'saranghaeyo', 'naega', 'neoreul', 'uri', 'geudae', 'oneul', 'haneul',
    'nae', 'neo', 'eobseo', 'isseo', 'maeil', 'nuguna', 'jebal', 'oppa', 'gidaryeo', 'naneun',
    'neoui', 'geurae',
  ],
  // Tone-less pinyin. Only multi-syllable or distinctive tokens: short syllables
  // such as "ma", "le", "de" collide with European languages.
  zh: [
    'women', 'nimen', 'tamen', 'xiang', 'zhe', 'zhi', 'xin', 'shuo', 'shenme', 'yiqi', 'xihuan',
    'yongyuan', 'meiyou', 'keyi', 'zhidao', 'wangji', 'shijie', 'aiqing', 'xiangnian', 'jintian',
    'mingtian', 'haishi', 'yijing', 'wo', 'zai', 'xiao', 'shang', 'dou', 'jiu', 'hui',
  ],
};

const VOCAB_SETS: Record<RomanizedLang, Set<string>> = Object.fromEntries(
  Object.entries(VOCAB).map(([lang, words]) => [lang, new Set(words)]),
) as Record<RomanizedLang, Set<string>>;

export interface RomanizedVerdict {
  /** Best-matching romanized language, or null if none clears the thresholds. */
  lang: RomanizedLang | null;
  /** Share of word tokens that belong to `lang`'s vocabulary (0–1). */
  score: number;
  /** Distinct vocabulary words matched for `lang`. */
  distinctHits: number;
  /** Total word tokens considered. */
  tokens: number;
}

/** Minimum share of tokens that must be vocabulary words. */
const MIN_SCORE = 0.12;
/** Minimum number of distinct vocabulary words (guards against one repeated word). */
const MIN_DISTINCT = 4;
/** Minimum tokens before any verdict is made. */
const MIN_TOKENS = 8;

function tokenize(lines: readonly string[]): string[] {
  return lines
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(t => t.length > 1);
}

/** Share of letters (0–1) that are not Latin script. Returns 0 when there are no letters. */
export function nonLatinLetterRatio(lines: readonly string[]): number {
  const letters = lines.join(' ').match(/\p{L}/gu);
  if (!letters || letters.length === 0) return 0;
  let nonLatin = 0;
  for (const ch of letters) if (!/\p{Script=Latin}/u.test(ch)) nonLatin++;
  return nonLatin / letters.length;
}

export function detectRomanizedLanguage(lines: readonly string[]): RomanizedVerdict {
  const tokens = tokenize(lines);
  const empty: RomanizedVerdict = { lang: null, score: 0, distinctHits: 0, tokens: tokens.length };
  if (tokens.length < MIN_TOKENS) return empty;

  let best: RomanizedVerdict = empty;
  for (const lang of Object.keys(VOCAB_SETS) as RomanizedLang[]) {
    const set = VOCAB_SETS[lang];
    let hits = 0;
    const distinct = new Set<string>();
    for (const t of tokens) {
      if (set.has(t)) {
        hits++;
        distinct.add(t);
      }
    }
    const score = hits / tokens.length;
    if (score > best.score || (score === best.score && distinct.size > best.distinctHits)) {
      best = { lang, score, distinctHits: distinct.size, tokens: tokens.length };
    }
  }

  if (best.score < MIN_SCORE || best.distinctHits < MIN_DISTINCT) return empty;
  return best;
}

export interface RomanizedFallbackVerdict {
  romanized: boolean;
  /** Language believed to be romanized (from the tag or the vocabulary), when romanized. */
  lang: string | null;
  reason: 'native-script' | 'too-short' | 'tag' | 'vocabulary' | 'latin';
}

/**
 * Above this share of non-Latin letters the lines are native script (or a native/English
 * mix), never a romanized fallback. A romanized fallback has essentially no native letters,
 * while native K-pop/J-pop lyrics with many English lines can sit as low as ~0.2 because
 * Hangul and kanji count one letter per syllable.
 */
const NATIVE_LETTER_RATIO = 0.02;

/**
 * True when `lines` look like a Latin-script stand-in for a non-Latin-script song.
 * `spotifyLang` is Spotify's (possibly wrong) language tag, e.g. "hi", "en-US", "id".
 */
export function isLikelyRomanizedFallback(
  lines: readonly string[],
  spotifyLang?: string | null,
): RomanizedFallbackVerdict {
  if (nonLatinLetterRatio(lines) >= NATIVE_LETTER_RATIO) return { romanized: false, lang: null, reason: 'native-script' };

  const letterCount = (lines.join(' ').match(/\p{L}/gu) ?? []).length;
  if (letterCount < 20) return { romanized: false, lang: null, reason: 'too-short' };

  const primary = (spotifyLang ?? '').split('-')[0].toLowerCase();
  if (primary && NON_LATIN_LANGS.has(primary)) return { romanized: true, lang: primary, reason: 'tag' };

  const verdict = detectRomanizedLanguage(lines);
  if (verdict.lang) return { romanized: true, lang: verdict.lang, reason: 'vocabulary' };

  return { romanized: false, lang: null, reason: 'latin' };
}
