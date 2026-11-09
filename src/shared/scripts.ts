// Which writing system a song (and each line) is in.

export type Script =
  | 'Latn' | 'Jpan' | 'Hani' | 'Kore' | 'Cyrl' | 'Grek' | 'Arab' | 'Hebr' | 'Thai' | 'Laoo' | 'Khmr' | 'Mymr'
  | 'Deva' | 'Beng' | 'Guru' | 'Gujr' | 'Orya' | 'Taml' | 'Telu' | 'Knda' | 'Mlym' | 'Sinh'
  | 'Geor' | 'Armn' | 'Ethi' | 'Other';

const RANGES: [Script, RegExp][] = [
  ['Jpan', /[぀-ヿㇰ-ㇿｦ-ﾟ]/], // kana
  ['Hani', /[㐀-䶿一-鿿豈-﫿]/],
  ['Kore', /[ᄀ-ᇿ㄰-㆏가-힯]/],
  ['Cyrl', /[Ѐ-ӿ]/],
  ['Grek', /[Ͱ-Ͽἀ-῿]/],
  ['Arab', /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/],
  ['Hebr', /[֐-׿]/],
  ['Thai', /[฀-๿]/],
  ['Laoo', /[຀-໿]/],
  ['Khmr', /[ក-៿]/],
  ['Mymr', /[က-႟]/],
  ['Deva', /[ऀ-ॿ]/],
  ['Beng', /[ঀ-৿]/],
  ['Guru', /[਀-੿]/],
  ['Gujr', /[઀-૿]/],
  ['Orya', /[଀-୿]/],
  ['Taml', /[஀-௿]/],
  ['Telu', /[ఀ-౿]/],
  ['Knda', /[ಀ-೿]/],
  ['Mlym', /[ഀ-ൿ]/],
  ['Sinh', /[඀-෿]/],
  ['Geor', /[Ⴀ-ჿ]/],
  ['Armn', /[԰-֏]/],
  ['Ethi', /[ሀ-፿]/],
];

const LATIN = /[A-Za-zÀ-ɏ]/;

export function charScript(ch: string): Script | null {
  if (LATIN.test(ch)) return 'Latn';
  for (const [s, re] of RANGES) if (re.test(ch)) return s;
  return null;
}

/** Counts letters per script. */
export function scriptCounts(text: string): Map<Script, number> {
  const counts = new Map<Script, number>();
  for (const ch of text) {
    const s = charScript(ch);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}

/**
 * The song's main non-Latin script, or 'Latn'. Han characters count as Japanese when the
 * song has any kana or Spotify says it is Japanese (kanji-only lines are common in J-pop).
 */
export function songScript(lines: string[], language?: string | null): Script {
  const counts = scriptCounts(lines.join('\n'));
  const kana = counts.get('Jpan') ?? 0;
  const han = counts.get('Hani') ?? 0;
  if (han && (kana || language === 'ja')) {
    counts.set('Jpan', kana + han);
    counts.delete('Hani');
  }
  let best: Script = 'Latn';
  let bestN = 0;
  for (const [s, n] of counts) {
    if (s !== 'Latn' && n > bestN) { best = s; bestN = n; }
  }
  return best;
}

/** True when the line has letters of the given script (Japanese includes Han). */
export function lineHas(line: string, script: Script): boolean {
  for (const ch of line) {
    const s = charScript(ch);
    if (s === script || (script === 'Jpan' && s === 'Hani')) return true;
  }
  return false;
}

/**
 * The script a language is normally written in (Spotify's language_of_performance codes),
 * for languages whose lyrics Spotify sometimes serves romanized.
 */
const LANGUAGE_SCRIPT: Record<string, Script> = {
  hi: 'Deva', mr: 'Deva', ne: 'Deva', sa: 'Deva', bho: 'Deva', mai: 'Deva', kok: 'Deva',
  bn: 'Beng', as: 'Beng', pa: 'Guru', gu: 'Gujr', or: 'Orya', ta: 'Taml', te: 'Telu', kn: 'Knda', ml: 'Mlym', si: 'Sinh',
  ja: 'Jpan', zh: 'Hani', yue: 'Hani', ko: 'Kore', th: 'Thai', lo: 'Laoo', km: 'Khmr', my: 'Mymr',
  ru: 'Cyrl', uk: 'Cyrl', be: 'Cyrl', bg: 'Cyrl', sr: 'Cyrl', mk: 'Cyrl', kk: 'Cyrl', ky: 'Cyrl', mn: 'Cyrl',
  ar: 'Arab', fa: 'Arab', ur: 'Arab', ps: 'Arab', he: 'Hebr', iw: 'Hebr', yi: 'Hebr', el: 'Grek', ka: 'Geor', hy: 'Armn', am: 'Ethi',
};

/** The expected non-Latin script of a song from its languages, or null. */
export function expectedScript(languages: string[] | undefined): Script | null {
  for (const l of languages ?? []) {
    const s = LANGUAGE_SCRIPT[l.toLowerCase().split(/[-_]/)[0]];
    if (s) return s;
  }
  return null;
}
