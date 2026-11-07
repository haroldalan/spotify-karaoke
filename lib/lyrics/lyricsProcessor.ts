import { detectScript, GOOGLE_ROMANIZE_SCRIPTS, SCRIPT_TO_LANG } from './scriptDetector';
import type { ScriptType } from './scriptDetector';
import { googleProcess } from '../translateClient';
import { romanizeLocally } from './localRomanizer';
import { preserveCasing } from './casePreserver';
import { transliterate } from 'transliteration';

/**
 * Result of the PROCESS pipeline (contract K1).
 * `translated` is null only together with `translationFailed: true`: the
 * translation failed but `romanized` is still usable. Both arrays have exactly
 * `lines.length` entries, index-aligned with the input.
 */
export interface ProcessLinesResult {
  translated: string[] | null;
  romanized: string[];
  isLowQualityRomanization?: boolean;
  wasTruncated?: boolean;
  translationFailed?: boolean;
}

/**
 * Language codes that are plausible for each ambiguous script (contract K1).
 * Spotify's language tag is only a hint and is sometimes wrong, so it is used
 * as Google's `sl` only when it fits the script actually detected in the lines.
 */
const PLAUSIBLE_HINTS: Partial<Record<ScriptType, ReadonlySet<string>>> = {
  arabic: new Set(['ar', 'ur', 'fa', 'ps', 'ku', 'sd']),
  cyrillic: new Set(['ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'ky', 'mn', 'tg']),
  devanagari: new Set(['hi', 'mr', 'ne', 'sa', 'bho', 'mai']),
  bengali: new Set(['bn', 'as']),
};

/** Bare lowercase primary subtag ('ja-JP' → 'ja'); Google's legacy 'iw' and 'he' compare equal. */
function baseLang(code: string | null | undefined): string {
  const primary = (code ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'he' ? 'iw' : primary;
}

/**
 * Picks Google's `sl` for the detected script.
 * - Latin-script text: always 'auto' (Spotify tags romanized lyrics wrongly, e.g. "id" for romanized Hindi).
 * - Non-Latin: the hint when it is plausible for the script, otherwise the per-script default.
 */
export function resolveSourceLang(script: ScriptType, hint?: string | null): string {
  const fallback = SCRIPT_TO_LANG[script] || 'auto';
  if (script === 'latin' || script === 'other') return fallback;
  const h = baseLang(hint);
  if (h && PLAUSIBLE_HINTS[script]?.has(h)) return h;
  return fallback;
}

function isSameLanguage(sourceLang: string, targetLang: string): boolean {
  if (!sourceLang || sourceLang === 'auto') return false;
  return baseLang(sourceLang) === baseLang(targetLang);
}

// A letter from any script other than Latin (Common/Inherited letters such as
// U+02BC are allowed, since romanizers emit them).
const NON_LATIN_LETTER_RE = /(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])\p{L}/u;

/**
 * "Texting-style" cleanup for a romanized line: strips diacritics (macrons,
 * dots, tone marks) and re-composes to NFC — but ONLY when the line is Latin
 * output. A line that is still in its native script, or is the untouched
 * original, is returned byte-identical. NFD + NFC is not a round trip for every
 * script (e.g. Devanagari nukta letters), and a changed byte sequence makes
 * an untouched line look "different" from its original (duplicate dual lines).
 */
export function cleanRomanizedLine(romanized: string, original?: string): string {
  if (!romanized) return romanized;
  if (original !== undefined && romanized === original) return romanized;
  if (NON_LATIN_LETTER_RE.test(romanized)) return romanized;
  return romanized.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

async function romanizeLocallySafe(lines: string[], script: ScriptType): Promise<{ romanized: string[]; lowQuality: boolean }> {
  try {
    return { romanized: await romanizeLocally(lines, script), lowQuality: false };
  } catch (err) {
    console.error('[SKaraoke:BG] Local romanization failed, using transliteration:', err);
    return { romanized: lines.map(l => safeTransliterate(l)), lowQuality: true };
  }
}

function safeTransliterate(line: string): string {
  try {
    return transliterate(line);
  } catch {
    return line;
  }
}

export async function processLines(
  lines: string[],
  targetLang: string,
  sourceLangHint?: string | null,
): Promise<ProcessLinesResult> {
  const script = detectScript(lines);
  const sourceLang = resolveSourceLang(script, sourceLangHint);

  if (script === 'latin') {
    try {
      const { translated, wasTruncated } = await googleProcess(lines, targetLang, false, sourceLang);
      return { translated, romanized: [...lines], wasTruncated };
    } catch (err) {
      console.warn('[SKaraoke:BG] Translation failed for Latin-script lyrics:', err);
      return { translated: null, romanized: [...lines], translationFailed: true };
    }
  }

  // Skip translation only when the RESOLVED source language is the target.
  const alreadyInTarget =
    (script === 'chinese' && (targetLang === 'zh-CN' || targetLang === 'zh-TW')) ||
    isSameLanguage(sourceLang, targetLang);

  const result: ProcessLinesResult = await (async () => {
    if (GOOGLE_ROMANIZE_SCRIPTS.has(script)) {
      // Google provides the romanization for these scripts.
      try {
        const g = await googleProcess(lines, targetLang, true, sourceLang);
        return {
          translated: alreadyInTarget ? [...lines] : g.translated,
          romanized: g.romanized,
          isLowQualityRomanization: g.isLowQualityRomanization,
          wasTruncated: g.wasTruncated,
        };
      } catch (err) {
        console.warn('[SKaraoke:BG] Google processing failed; using local romanization:', err);
        const { romanized } = await romanizeLocallySafe(lines, script);
        return alreadyInTarget
          ? { translated: [...lines], romanized, isLowQualityRomanization: true }
          : { translated: null, romanized, isLowQualityRomanization: true, translationFailed: true };
      }
    }

    if (alreadyInTarget) {
      const { romanized, lowQuality } = await romanizeLocallySafe(lines, script);
      return { translated: [...lines], romanized, ...(lowQuality ? { isLowQualityRomanization: true } : {}) };
    }

    // Translation and local romanization are independent: a translation failure
    // must not throw away the (network-free) romanization.
    const [trans, rom] = await Promise.allSettled([
      googleProcess(lines, targetLang, false, sourceLang),
      romanizeLocallySafe(lines, script),
    ]);
    const romanized = rom.status === 'fulfilled' ? rom.value.romanized : lines.map(l => safeTransliterate(l));
    const lowQuality = rom.status !== 'fulfilled' || rom.value.lowQuality;

    if (trans.status === 'fulfilled') {
      return {
        translated: trans.value.translated,
        romanized,
        wasTruncated: trans.value.wasTruncated,
        ...(lowQuality ? { isLowQualityRomanization: true } : {}),
      };
    }
    console.warn('[SKaraoke:BG] Translation failed; keeping local romanization:', trans.reason);
    return {
      translated: null,
      romanized,
      translationFailed: true,
      ...(lowQuality ? { isLowQualityRomanization: true } : {}),
    };
  })();

  result.romanized = lines.map((line, i) => {
    const rom = result.romanized[i] ?? line;
    // OPTICS: We intentionally strip diacritics (macrons, etc.) from Latin output to produce
    // a cleaner, "texting-style" result, even if it is phonetically lossy for some scripts.
    return cleanRomanizedLine(preserveCasing(line, rom), line);
  });
  if (result.translated && result.translated.length !== lines.length) {
    result.translated = lines.map((line, i) => result.translated![i] ?? line);
  }

  return result;
}
