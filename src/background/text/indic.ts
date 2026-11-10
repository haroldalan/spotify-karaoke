// Brahmic scripts (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Telugu, Kannada,
// Malayalam) -> readable ASCII, the way lyrics are usually written in Latin letters:
// "मेरा दिल तेरा है" -> "mera dil tera hai", not "merā dila terā hai".
//
// Two steps:
// 1. Schwa deletion (Indo-Aryan languages only): the inherent "a" of a consonant is not
//    pronounced at the end of a word, nor in the middle when it sits between a vowel and
//    a consonant that carries a vowel (V C a C V -> V C C V: "dhadakna", "samajhna").
//    Done by writing a virama after the consonant, before transliterating.
// 2. Sanscript -> IAST, then IAST -> plain ASCII.
import Sanscript from '@indic-transliteration/sanscript';
import type { Script } from '../../shared/scripts';

const SCHEME: Partial<Record<Script, string>> = {
  Deva: 'devanagari', Beng: 'bengali', Guru: 'gurmukhi', Gujr: 'gujarati', Orya: 'oriya',
  Telu: 'telugu', Knda: 'kannada', Mlym: 'malayalam',
};
const BLOCK: Partial<Record<Script, number>> = {
  Deva: 0x0900, Beng: 0x0980, Guru: 0x0a00, Gujr: 0x0a80, Orya: 0x0b00, Telu: 0x0c00, Knda: 0x0c80, Mlym: 0x0d00,
};
/** Languages that drop the inherent vowel. Dravidian languages keep it ("pranayam"). */
const SCHWA_DELETING = new Set<Script>(['Deva', 'Beng', 'Guru', 'Gujr']);

export function supportsIndic(s: Script): boolean {
  return s in SCHEME;
}

// Offsets within a Brahmic Unicode block (the blocks share one layout).
const isConsonant = (o: number) => (o >= 0x15 && o <= 0x39) || (o >= 0x58 && o <= 0x5f);
const isMatra = (o: number) => (o >= 0x3e && o <= 0x4c) || o === 0x62 || o === 0x63;
const isIndepVowel = (o: number) => (o >= 0x05 && o <= 0x14) || o === 0x60 || o === 0x61;
const VIRAMA = 0x4d;
const NUKTA = 0x3c;

interface Akshara { kind: 'C' | 'V' | 'other'; /** consonant with its inherent vowel */ inherent: boolean; chars: string[] }

function aksharas(word: string, base: number): Akshara[] {
  const out: Akshara[] = [];
  for (const ch of word) {
    const o = ch.codePointAt(0)! - base;
    const last = out[out.length - 1];
    if (isConsonant(o)) out.push({ kind: 'C', inherent: true, chars: [ch] });
    else if (isIndepVowel(o)) out.push({ kind: 'V', inherent: false, chars: [ch] });
    else if (last && (isMatra(o) || o === VIRAMA)) {
      last.chars.push(ch);
      if (last.kind === 'C') last.inherent = false;
    } else if (last && (o === NUKTA || o === 0x01 || o === 0x02 || o === 0x03 || o === 0x70 || o === 0x71)) {
      last.chars.push(ch); // nukta, chandrabindu, anusvara, visarga, Gurmukhi tippi/addak
    } else out.push({ kind: 'other', inherent: false, chars: [ch] });
  }
  return out;
}

/** Has a pronounced vowel (independent vowel, matra, or a kept inherent a). */
const voiced = (a: Akshara | undefined) =>
  !!a && (a.kind === 'V' || (a.kind === 'C' && (a.inherent || a.chars.some((c, i) => i > 0 && isMatra(c.codePointAt(0)! & 0x7f)))));

export function deleteSchwas(word: string, script: Script): string {
  const base = BLOCK[script];
  if (base === undefined || !SCHWA_DELETING.has(script)) return word;
  const ak = aksharas(word, base);
  const letters = ak.filter((a) => a.kind !== 'other');
  if (letters.length < 2) return word;
  const drop = new Set<Akshara>();
  // Word-final inherent vowel.
  const last = letters[letters.length - 1];
  if (last.kind === 'C' && last.inherent && !last.chars.some((c) => (c.codePointAt(0)! - base) === 0x02)) drop.add(last);
  // Medial: right to left, V C[a] C V -> drop.
  for (let i = letters.length - 2; i >= 1; i--) {
    const cur = letters[i];
    if (cur.kind !== 'C' || !cur.inherent || drop.has(cur)) continue;
    const prev = letters[i - 1];
    const next = letters[i + 1];
    const nextVoiced = next.kind === 'C' && !drop.has(next) && voiced(next);
    // A syllable closed by a nasal or visarga before it would leave three consonants in a row ("zindagi").
    const prevClosed = prev.chars.some((c) => { const o = c.codePointAt(0)! - base; return o === 0x02 || o === 0x03 || o === 0x70; });
    if (voiced(prev) && !drop.has(prev) && !prevClosed && nextVoiced) {
      drop.add(cur);
      i--; // never drop two in a row
    }
  }
  const virama = String.fromCodePoint(base + VIRAMA);
  return ak.map((a) => (drop.has(a) ? a.chars.join('') + virama : a.chars.join(''))).join('');
}

const DRAVIDIAN_FINAL_M = new Set<Script>(['Telu', 'Knda', 'Mlym']);
/** Hindi, Punjabi and Gujarati lyrics write long vowels doubled inside a word ("aata",
 *  "pyaar", "door") but single at its end ("mera", "teri"). Bengali has no length contrast. */
const LONG_VOWELS_DOUBLED = new Set<Script>(['Deva', 'Guru', 'Gujr']);

/** IAST (and sanscript's extras) -> plain ASCII. */
export function iastToAscii(s: string, script: Script): string {
  let t = s.normalize('NFC');
  // Anusvara: m before labials, at word end in Dravidian languages; n elsewhere.
  t = t.replace(/ṃ(?=[pbm])/g, 'm');
  if (DRAVIDIAN_FINAL_M.has(script)) t = t.replace(/ṃ(?=$|[^\p{L}])/gu, 'm');
  // Bengali: ং is "ng" (bangla), and ব is "b" (sanscript reads it as v).
  if (script === 'Beng') t = t.replace(/ṃ/g, 'ng').replace(/v/g, 'b');
  // Malayalam ഞ is written "nj" (njan); elsewhere ñ only appears in clusters ("nch").
  if (script === 'Mlym') t = t.replace(/ñ/g, 'nj');
  if (LONG_VOWELS_DOUBLED.has(script)) {
    // Hindi word-final ें is written "ein" (mein, baatein).
    if (script === 'Deva') t = t.replace(/eṃ(?=$|[^\p{L}])/gu, 'ein');
    t = t.replace(/ā(?=[\p{L}\p{M}])/gu, 'aa').replace(/ī(?=[\p{L}\p{M}])/gu, 'ee').replace(/ū(?=[\p{L}\p{M}])/gu, 'oo');
  }
  t = t.replace(/ch/g, 'chh').replace(/c/g, 'ch');
  const map: Record<string, string> = {
    ā: 'a', ī: 'i', ū: 'u', ṛ: 'ri', ṝ: 'ri', ḷ: 'l', ḹ: 'l', ē: 'e', ō: 'o', è: 'e', ò: 'o',
    ṅ: 'n', ñ: 'n', ṭ: 't', ḍ: 'd', ṇ: 'n', ś: 'sh', ṣ: 'sh', ṃ: 'n', ḥ: 'h', 'm̐': 'n',
    ẏ: 'y', ṟ: 'r', ḻ: 'zh', ṉ: 'n', ḵ: 'kh', ġ: 'gh', ṯ: 't', ḏ: 'd',
    Ā: 'A', Ī: 'I', Ū: 'U', Ś: 'Sh', Ṣ: 'Sh',
  };
  t = t.replace(/m̐|[^\x00-\x7f]/g, (c) => map[c] ?? c);
  // Remaining combining marks (e.g. from nukta letters).
  return t.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
}

// Precomposed nukta letters (Unicode composition exclusions: NFC always splits them into
// consonant + nukta, but sanscript only knows the precomposed forms).
const NUKTA_LETTERS = [
  0x0958, 0x0959, 0x095a, 0x095b, 0x095c, 0x095d, 0x095e, 0x095f, // Devanagari
  0x09dc, 0x09dd, 0x09df, // Bengali
  0x0a33, 0x0a36, 0x0a59, 0x0a5a, 0x0a5b, 0x0a5e, // Gurmukhi
  0x0b5c, 0x0b5d, // Oriya
];
const COMPOSE = new Map(NUKTA_LETTERS.map((cp) => [String.fromCodePoint(cp).normalize('NFD'), String.fromCodePoint(cp)]));
const COMPOSE_RE = new RegExp([...COMPOSE.keys()].join('|'), 'g');

/** Hindi ड़ / ढ़ are written d / dh in lyrics ("dhadkan", "ladki"). */
function hindiFlaps(s: string): string {
  return s.replace(/ड़|ड़/g, 'ड').replace(/ढ़|ढ़/g, 'ढ');
}

/** Malayalam chillu letters (consonants with no vowel) as consonant + virama, which sanscript knows. */
const CHILLU: Record<string, string> = { 'ൺ': 'ണ്', 'ൻ': 'ന്', 'ർ': 'ര്', 'ൽ': 'ല്', 'ൾ': 'ള്', 'ൿ': 'ക്' };

/** Romanizes the words written in the script; other words (English, numbers) are kept as written. */
export function romanizeIndic(line: string, script: Script): string {
  const scheme = SCHEME[script];
  const base = BLOCK[script];
  if (!scheme || base === undefined) return line;
  const chandrabindu = new RegExp(String.fromCodePoint(base + 0x01), 'g');
  const anusvara = String.fromCodePoint(base + 0x02);
  const inScript = (ch: string) => {
    const o = ch.codePointAt(0)! - base;
    return o >= 0 && o < 0x80;
  };
  return line
    .normalize('NFC')
    .split(/(\s+)/)
    .map((token) => {
      if (![...token].some(inScript)) return token;
      let w = token;
      if (script === 'Mlym') w = w.replace(/[\u0D7A-\u0D7F]/g, (c) => CHILLU[c] ?? c);
      w = w.replace(chandrabindu, anusvara); // ँ: a nasal vowel, read like anusvara ("hoon", "haan")
      if (script === 'Deva') w = hindiFlaps(w);
      w = deleteSchwas(w, script);
      return iastToAscii(Sanscript.t(w.replace(COMPOSE_RE, (m) => COMPOSE.get(m)!), scheme, 'iast'), script);
    })
    .join('');
}
