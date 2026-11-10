// Thai romanization close to the Royal Thai General System (RTGS) used on signs and lyric
// sites, without tone marks: "ฉันรักคุณ" -> "chan rak khun". Offline and instant.
// Ported from Spotify Karaoke 3.1.6 (lib/lyrics/thaiRomanizer.ts).
//
// Thai is written without spaces between words, so a line is split into words
// (Intl.Segmenter) and each word is read syllable by syllable: leading vowel, initial
// consonant or cluster, vowel, final consonant. A word the reader can't parse goes to the
// @dehoist/romanize-thai library.
import romanizeThaiLibrary from '@dehoist/romanize-thai';

const INITIAL: Record<string, string> = {
  ก: 'k', ข: 'kh', ฃ: 'kh', ค: 'kh', ฅ: 'kh', ฆ: 'kh', ง: 'ng',
  จ: 'ch', ฉ: 'ch', ช: 'ch', ซ: 's', ฌ: 'ch', ญ: 'y',
  ฎ: 'd', ฏ: 't', ฐ: 'th', ฑ: 'th', ฒ: 'th', ณ: 'n',
  ด: 'd', ต: 't', ถ: 'th', ท: 'th', ธ: 'th', น: 'n',
  บ: 'b', ป: 'p', ผ: 'ph', ฝ: 'f', พ: 'ph', ฟ: 'f', ภ: 'ph', ม: 'm',
  ย: 'y', ร: 'r', ล: 'l', ว: 'w', ศ: 's', ษ: 's', ส: 's', ห: 'h', ฬ: 'l', อ: '', ฮ: 'h',
};

const FINAL: Record<string, string> = {
  ก: 'k', ข: 'k', ค: 'k', ฆ: 'k', ง: 'ng',
  จ: 't', ช: 't', ซ: 't', ฌ: 't', ฎ: 't', ฏ: 't', ฐ: 't', ฑ: 't', ฒ: 't',
  ด: 't', ต: 't', ถ: 't', ท: 't', ธ: 't', ศ: 't', ษ: 't', ส: 't',
  ญ: 'n', ณ: 'n', น: 'n', ร: 'n', ล: 'n', ฬ: 'n',
  บ: 'p', ป: 'p', พ: 'p', ฟ: 'p', ภ: 'p', ม: 'm', ย: 'i', ว: 'o',
};

/** True clusters; the value replaces both letters (จร, ซร, ศร, สร: silent ร; ทร sounds "s"). */
const CLUSTER: Record<string, string> = {
  กร: 'kr', กล: 'kl', กว: 'kw', ขร: 'khr', ขล: 'khl', ขว: 'khw',
  คร: 'khr', คล: 'khl', คว: 'khw', ตร: 'tr', ปร: 'pr', ปล: 'pl',
  พร: 'phr', พล: 'phl', ผล: 'phl', บร: 'br', บล: 'bl', ดร: 'dr',
  ฟร: 'fr', ฟล: 'fl', ทร: 's', จร: 'ch', ซร: 's', ศร: 's', สร: 's',
};

/** Low consonants a leading ห (or อ before ย) only changes the tone of: it is not pronounced. */
const SONORANT = new Set(['ง', 'ญ', 'น', 'ม', 'ย', 'ร', 'ล', 'ว']);
const LEAD = new Set(['เ', 'แ', 'โ', 'ใ', 'ไ']);
/** Vowel signs written after (or above/below) the initial consonant. */
const FOLLOW = new Set(['ะ', 'ั', 'า', 'ำ', 'ิ', 'ี', 'ึ', 'ื', 'ุ', 'ู', '็']);
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

const isCons = (c: string | undefined): boolean => c !== undefined && c >= 'ก' && c <= 'ฮ' && c !== 'ฤ' && c !== 'ฦ';
const isFollow = (c: string | undefined): boolean => c !== undefined && FOLLOW.has(c);
/** ห, อ and ฮ never close a syllable: they always start one (โกหก "kohok", ให้อภัย "hai aphai"). */
const canClose = (c: string | undefined): boolean => isCons(c) && c !== 'ห' && c !== 'อ' && c !== 'ฮ';

/** Whether the consonant at j begins a new syllable (rather than closing the current one). */
function startsSyllable(s: string, j: number): boolean {
  const c = s[j];
  if (!isCons(c)) return false;
  const n1 = s[j + 1];
  const n2 = s[j + 2];
  if (isFollow(n1)) return true;
  // C + อ is the vowel "o" (รอ, ตอน) unless อ itself carries a vowel (กินอาหาร: อ starts "a-han").
  if (n1 === 'อ' && !isFollow(n2)) return true;
  // C + ว + consonant: ว is the vowel "ua" (สวย, ห่วง).
  if (n1 === 'ว' && isCons(n2) && !isFollow(s[j + 3])) return true;
  if (n1 && CLUSTER[c + n1] && (isFollow(n2) || n2 === 'อ')) return true;
  if (c === 'ห' && n1 && SONORANT.has(n1) && (isFollow(n2) || n2 === 'อ')) return true;
  return false;
}

/** Normalizes a word: drops tone marks, and letters made silent by the thanthakhat (์). */
function normalizeWord(word: string): string {
  // เเ (two sara e) is a common typing of แ.
  let s = word.replace(/[\u0E48-\u0E4B\u0E4D\u0E3A]/g, '').replace(/เเ/g, 'แ');
  if (s.includes('์')) {
    s = s.replace(/[\u0E01-\u0E2E][\u0E34\u0E38]?์/g, '');
    // จันทร์, ศาสตร์: the letter before the silent one is silent too when the syllable is already closed.
    s = s.replace(/([\u0E31\u0E32\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E2D])([\u0E01-\u0E2E])[\u0E01-\u0E2E]$/, '$1$2');
  }
  return s;
}

function finalSound(c: string): string {
  return FINAL[c] ?? INITIAL[c] ?? '';
}

/**
 * Words whose reading the spelling rules get wrong: loanwords (โทร from "telephone")
 * and words with unwritten vowels (ทรมาน "thoraman", not "thonman").
 */
const IRREGULAR_WORDS: Record<string, string> = {
  โทร: 'tho', โทรศัพท์: 'thorasap', ทรมาน: 'thoraman', อันตราย: 'antarai', สวรรค์: 'sawan',
  เสน่ห์: 'sane', อภัย: 'aphai', กษัตริย์: 'kasat', ปรารถนา: 'prattana', บริสุทธิ์: 'borisut',
};
/** Keyed by normalized spelling, so tone marks and typing variants still match. */
const IRREGULAR = new Map(Object.entries(IRREGULAR_WORDS).map(([w, r]) => [normalizeWord(w), r]));

/** Romanizes one Thai word, or returns null when its spelling falls outside the rules below. */
export function romanizeThaiWord(word: string): string | null {
  const s = normalizeWord(word);
  const irregular = IRREGULAR.get(s);
  if (irregular) return irregular;
  let out = '';
  let i = 0;
  let carriedLead = '';

  // Takes the consonant at i as the syllable's final when it does not start the next syllable.
  const takeFinal = (): string => {
    if (canClose(s[i]) && !startsSyllable(s, i)) return finalSound(s[i++]);
    return '';
  };

  while (i < s.length) {
    const ch = s[i];

    if (THAI_DIGITS.includes(ch)) { out += String(THAI_DIGITS.indexOf(ch)); i++; continue; }
    if (ch === 'ฤ' || ch === 'ฦ') {
      out += ch === 'ฤ' ? 'rue' : 'lue';
      i++;
      if (s[i] === 'ๅ') i++;
      continue;
    }
    if (ch === 'ฯ' || ch === 'ๆ') { i++; continue; }

    let lead = carriedLead;
    carriedLead = '';
    if (!lead && LEAD.has(ch)) { lead = ch; i++; }

    // ── Initial consonant (or cluster) ──
    const c1 = s[i];
    if (!isCons(c1)) return null;
    i++;
    let initial = INITIAL[c1] ?? '';
    const c2 = s[i];
    // ห + ว + consonant is "hua" (ห่วง), not a silent ห.
    const isUaVowel = c2 === 'ว' && !lead && isCons(s[i + 1]) && !isFollow(s[i + 2]);
    if (c1 === 'ห' && c2 && SONORANT.has(c2) && !isUaVowel && (lead || isFollow(s[i + 1]) || s[i + 1] === 'อ' || isCons(s[i + 1]))) {
      initial = INITIAL[c2]; // ห นำ: เหมือน, หนาว, หมด
      i++;
    } else if (c1 === 'อ' && c2 === 'ย' && (isFollow(s[i + 1]) || s[i + 1] === 'า' || isCons(s[i + 1]))) {
      initial = 'y'; // อ นำ: อยู่, อย่า, อยาก, อย่าง
      i++;
    } else if (c2 && CLUSTER[c1 + c2] && !(c2 === 'ร' && s[i + 1] === 'ร')) { // กรรม: รร is the vowel
      const n = s[i + 1];
      const isCluster = lead
        ? true
        : c2 === 'ว'
          ? isFollow(n)
          : isFollow(n) || n === 'อ' || (isCons(n) && !startsSyllable(s, i + 1) && !isFollow(s[i + 2]));
      if (isCluster) { initial = CLUSTER[c1 + c2]; i++; }
    }
    if (s[i] === 'ฤ') { // อังกฤษ: "krit"
      i++;
      out += initial + 'ri' + takeFinal();
      continue;
    }

    // เสมอ, เฉลียว: the leading เ belongs to the second consonant; the first takes "a".
    if (lead === 'เ' && initial === INITIAL[c1] && isCons(s[i]) && !CLUSTER[c1 + s[i]]
      && ((s[i + 1] === 'อ' && !isFollow(s[i + 2])) || s.startsWith('ีย', i + 1) || s.startsWith('ือ', i + 1))) {
      out += initial + 'a';
      carriedLead = 'เ';
      continue;
    }

    // ── Vowel and final ──
    const rest = s.slice(i);
    let vowel: string;
    let final = '';
    const eat = (n: number) => { i += n; };

    if (lead === 'เ') {
      if (rest.startsWith('ียะ')) { vowel = 'ia'; eat(3); }
      else if (rest.startsWith('ีย')) { vowel = 'ia'; eat(2); final = takeFinal(); }
      else if (rest.startsWith('ือะ')) { vowel = 'uea'; eat(3); }
      else if (rest.startsWith('ือ')) { vowel = 'uea'; eat(2); final = takeFinal(); }
      else if (rest.startsWith('าะ')) { vowel = 'o'; eat(2); }
      else if (rest.startsWith('า')) { vowel = 'ao'; eat(1); }
      else if (rest.startsWith('อะ')) { vowel = 'oe'; eat(2); }
      else if (rest.startsWith('อ')) { vowel = 'oe'; eat(1); final = takeFinal(); }
      else if (rest.startsWith('ิ')) { vowel = 'oe'; eat(1); final = takeFinal(); }
      else if (rest.startsWith('็')) { vowel = 'e'; eat(1); final = takeFinal(); }
      else if (rest.startsWith('ะ')) { vowel = 'e'; eat(1); }
      else if (rest[0] === 'ย' && !startsSyllable(s, i)) { vowel = 'oei'; eat(1); }
      else { vowel = 'e'; final = takeFinal(); }
    } else if (lead === 'แ') {
      if (rest.startsWith('ะ')) { vowel = 'ae'; eat(1); }
      else { if (rest.startsWith('็')) eat(1); vowel = 'ae'; final = takeFinal(); }
    } else if (lead === 'โ') {
      if (rest.startsWith('ะ')) { vowel = 'o'; eat(1); }
      else { vowel = 'o'; final = takeFinal(); }
    } else if (lead === 'ใ' || lead === 'ไ') {
      vowel = 'ai';
      if (s[i] === 'ย' && !startsSyllable(s, i)) eat(1); // ไทย
      else final = takeFinal();
    } else if (rest.startsWith('ัวะ')) { vowel = 'ua'; eat(3); }
    else if (rest.startsWith('ัว')) { vowel = 'ua'; eat(2); final = takeFinal(); }
    else if (rest[0] === 'ว' && isCons(rest[1]) && !isFollow(rest[2])) { vowel = 'ua'; eat(1); final = takeFinal(); }
    else if (rest.startsWith('ำ')) { vowel = 'am'; eat(1); }
    else if (rest.startsWith('ะ')) { vowel = 'a'; eat(1); }
    else if (rest.startsWith('ั')) { vowel = 'a'; eat(1); if (isCons(s[i])) final = finalSound(s[i++]); }
    else if (rest.startsWith('รร')) { vowel = 'a'; eat(2); final = takeFinal() || 'n'; }
    else if (rest.startsWith('า')) { vowel = 'a'; eat(1); final = takeFinal(); }
    else if (rest.startsWith('ิ') || rest.startsWith('ี')) { vowel = 'i'; eat(1); final = takeFinal(); }
    else if (rest.startsWith('ึ')) { vowel = 'ue'; eat(1); final = takeFinal(); }
    else if (rest.startsWith('ือ')) { vowel = 'ue'; eat(2); final = takeFinal(); }
    else if (rest.startsWith('ื')) { vowel = 'ue'; eat(1); final = takeFinal(); }
    else if (rest.startsWith('ุ') || rest.startsWith('ู')) { vowel = 'u'; eat(1); final = takeFinal(); }
    else if (rest.startsWith('็')) { vowel = 'o'; eat(1); final = takeFinal(); } // ก็
    else if (rest[0] === 'อ' && !isFollow(rest[1])) { vowel = 'o'; eat(1); final = takeFinal(); }
    else {
      // No written vowel: "o" when the next consonant closes the syllable (คน, รถ),
      // "a" when it starts the next one (สบาย, ตลอด, ถนน).
      const x = s[i];
      const y = s[i + 1];
      const closes = canClose(x) && !startsSyllable(s, i)
        && (y === undefined || !isCons(y) || startsSyllable(s, i + 1) || isFollow(s[i + 2]));
      if (closes) { vowel = 'o'; final = finalSound(s[i++]); }
      else vowel = 'a';
    }

    out += initial + vowel + final;
  }
  return out;
}

let segmenter: Intl.Segmenter | null | undefined;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
    } catch {
      segmenter = null;
    }
  }
  return segmenter;
}

const THAI_RE = /[\u0E00-\u0E7F]/;

function romanizeWordSafe(word: string): string {
  try {
    const r = romanizeThaiWord(word);
    if (r !== null) return r;
  } catch { /* fall through to the library */ }
  return romanizeThaiLibrary(word);
}

/** Romanizes a line of Thai: one Latin word per Thai word, other text kept as written. */
export function romanizeThaiLine(line: string): string {
  const seg = getSegmenter();
  const pieces = seg ? [...seg.segment(line)].map((p) => p.segment) : line.split(/(\s+)/);
  const out: string[] = [];
  let lastWord = '';
  let needsSpace = false;
  for (const piece of pieces) {
    if (/^\s+$/.test(piece)) { needsSpace = out.length > 0; continue; }
    let text: string;
    let isWord: boolean;
    if (piece === 'ๆ') {
      // ไม้ยมก repeats the word before it: ช้าๆ "cha cha".
      if (!lastWord) continue;
      text = lastWord;
      isWord = true;
    } else if (THAI_RE.test(piece)) {
      text = romanizeWordSafe(piece.replace(/ๆ/g, ''));
      isWord = text.length > 0;
      if (piece.endsWith('ๆ') && text) text = `${text} ${text}`;
    } else {
      text = piece;
      isWord = /[\p{L}\p{N}]/u.test(piece);
    }
    if (!text) continue;
    if (out.length > 0 && (needsSpace || (isWord && /[\p{L}\p{N}]$/u.test(out[out.length - 1])))) out.push(' ');
    out.push(text);
    if (isWord) lastWord = text.split(' ').pop() ?? text;
    needsSpace = false;
  }
  return out.join('');
}
