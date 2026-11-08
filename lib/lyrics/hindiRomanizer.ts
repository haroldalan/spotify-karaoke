/**
 * Devanagari to romanized Hindi as listeners write it ("hum baatein", "rahti", "aasmaan").
 *
 * The generic Sanskrit scheme (IAST, diacritics stripped) keeps every inherent vowel and
 * writes nasals as "m"/"~": "hama batem", "rahati", "maim hu~". Hindi drops the inherent
 * "a" at the end of a word and between two pronounced syllables (schwa deletion), writes
 * long vowels doubled ("aa") and nasals as "n". This follows those rules: per word, split
 * into syllables (consonant cluster + vowel), delete the word-final inherent vowel, then
 * apply the medial rule (V C a C V → V C C V) from right to left, never to the first
 * syllable.
 */

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  // Precomposed nukta letters.
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
};
/** Consonant + nukta (U+093C) spelled as two characters. */
const NUKTA_FORMS: Record<string, string> = {
  'क': 'q', 'ख': 'kh', 'ग': 'gh', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f', 'य': 'y',
};
const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e',
};
const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e',
};
const VIRAMA = '्';
const NUKTA = '़';
const NASALS = new Set(['ं', 'ँ']);
const VISARGA = 'ः';
const DIGITS = '०१२३४५६७८९';

interface Syllable {
  /** Consonant cluster (romanized), '' for a syllable that starts with a vowel. */
  onset: string;
  /** Number of consonants in the cluster. */
  consonants: number;
  /** Vowel (romanized); 'a' with `inherent` for the consonant's own vowel. */
  vowel: string;
  inherent: boolean;
  /** Dropped by schwa deletion (only inherent vowels). */
  deleted: boolean;
  nasal: boolean;
  /** The cluster ends with a virama and no vowel follows (word-final half letter). */
  bare: boolean;
}

/** Splits one Devanagari word into syllables. */
function syllables(word: string): Syllable[] {
  const chars = Array.from(word);
  const out: Syllable[] = [];
  let onset = '';
  let consonants = 0;
  let pendingCluster = false;
  const pushVowel = (vowel: string, inherent: boolean) => {
    out.push({ onset, consonants, vowel, inherent, deleted: false, nasal: false, bare: false });
    onset = '';
    consonants = 0;
    pendingCluster = false;
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONSONANTS[ch] !== undefined) {
      // A consonant after a consonant with no virama: the first one had its own vowel.
      if (pendingCluster) pushVowel('a', true);
      let roman = CONSONANTS[ch];
      if (chars[i + 1] === NUKTA) { roman = NUKTA_FORMS[ch] ?? roman; i++; }
      onset += roman;
      consonants++;
      pendingCluster = true;
      if (chars[i + 1] === VIRAMA) { i++; pendingCluster = false; }
      continue;
    }
    if (MATRAS[ch] !== undefined) { pushVowel(MATRAS[ch], false); continue; }
    if (VOWELS[ch] !== undefined) {
      if (pendingCluster) pushVowel('a', true);
      pushVowel(VOWELS[ch], false);
      continue;
    }
    if (NASALS.has(ch) || ch === VISARGA) {
      if (pendingCluster) pushVowel('a', true);
      const last = out[out.length - 1];
      if (last) {
        if (ch === VISARGA) last.vowel += 'h';
        else last.nasal = true;
      }
      continue;
    }
  }
  if (pendingCluster) pushVowel('a', true);
  else if (onset) out.push({ onset, consonants, vowel: '', inherent: false, deleted: false, nasal: false, bare: true });
  return out;
}

/**
 * Schwa deletion: word-final, then medial (V C a C V) right to left, never the first
 * syllable, and never where it would leave three consonants in a row (zin-da-gi).
 */
function deleteSchwas(syl: Syllable[]): void {
  const n = syl.length;
  if (n < 2) return;
  const last = syl[n - 1];
  if (last.inherent && !last.nasal) last.deleted = true;
  const voiced = (s: Syllable | undefined) => !!s && !s.deleted && !s.bare && s.vowel !== '';
  for (let i = n - 2; i >= 1; i--) {
    const s = syl[i];
    if (!s.inherent || s.nasal || s.onset === '') continue;
    // The next syllable must start with a consonant and keep its vowel.
    const cluster = (syl[i - 1].nasal ? 1 : 0) + s.consonants + syl[i + 1].consonants;
    if (voiced(syl[i - 1]) && voiced(syl[i + 1]) && syl[i + 1].onset !== '' && cluster <= 2) s.deleted = true;
  }
}

function romanizeWord(word: string): string {
  const syl = syllables(word);
  deleteSchwas(syl);
  let out = '';
  for (const s of syl) {
    out += s.onset;
    if (!s.deleted) out += s.vowel;
    if (s.nasal) out += 'n';
  }
  return out;
}

const DEVANAGARI_RUN = /[ऀ-ॿ]+/g;

/** Romanizes the Devanagari in a line; everything else (punctuation, Latin, digits) stays. */
export function romanizeHindiLine(line: string): string {
  return line.replace(DEVANAGARI_RUN, (run) =>
    // Digits and the danda are not letters.
    run.replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d))).replace(/[।॥]/g, '.')
      .replace(/[ऀ-ॿ]+/g, (w) => romanizeWord(w)));
}
