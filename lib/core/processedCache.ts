import type { LyricsMode, ProcessedCache } from './lyricsTypes';
import { detectScript, SCRIPT_TO_LANG } from '../lyrics/scriptDetector';
import { nonLatinLetterRatio } from '../lyrics/romanizedDetector';

/**
 * Shared rules for picking and validating processed (romanized / translated)
 * results, so every apply path (fast paths, observer, mode switch) agrees.
 */

type ProcessedSource =
  | Map<string, ProcessedCache>
  | Record<string, ProcessedCache>
  | null
  | undefined;

const nonEmptyLines = (lines: unknown): lines is string[] =>
  Array.isArray(lines) && lines.length > 0;

/** True when `entry` can be painted in `mode`. A failed translation is never usable. */
export function hasUsableLines(entry: ProcessedCache | null | undefined, mode: LyricsMode): boolean {
  if (!entry) return false;
  if (mode === 'romanized') return nonEmptyLines(entry.romanized);
  if (mode === 'translated') return !entry.translationFailed && nonEmptyLines(entry.translated);
  return false;
}

/**
 * Picks the processed entry to paint for `mode`.
 * - translated: only the entry for `lang`, and only with a usable translation.
 * - romanized: the entry for `lang`, else any entry with romanized lines
 *   (romanization does not depend on the target language), preferring
 *   entries not flagged as low quality.
 */
export function resolveProcessed(
  source: ProcessedSource,
  lang: string,
  mode: LyricsMode,
): ProcessedCache | undefined {
  if (!source || mode === 'original') return undefined;
  const isMap = source instanceof Map;
  const exact = isMap ? source.get(lang) : (source as Record<string, ProcessedCache>)[lang];
  if (hasUsableLines(exact, mode)) return exact;
  if (mode !== 'romanized') return undefined;
  const values = isMap ? Array.from(source.values()) : Object.values(source);
  const candidates = values.filter(e => hasUsableLines(e, 'romanized'));
  return candidates.find(e => !e.isLowQualityRomanization) ?? candidates[0];
}

const baseLang = (code?: string | null): string =>
  (code ?? '').toLowerCase().split(/[-_]/)[0];

const hasLetters = (lines: string[]): boolean => lines.some(l => /\p{L}/u.test(l));

/** Every line identical (ignoring surrounding whitespace). */
function isIdentity(original: string[], output: unknown): boolean {
  if (!Array.isArray(output) || output.length !== original.length) return false;
  return original.every((line, i) => (output[i] ?? '').trim() === (line ?? '').trim());
}

/** True when the lyrics are mainly in a non-Latin script (romanization is meaningful). */
export function isNonLatinSource(original: string[]): boolean {
  return nonLatinLetterRatio(original) > 0.3;
}

/**
 * True when translating `original` into `targetLang` may legitimately return the
 * text unchanged: the target is the script's native language (Japanese → ja) or
 * the language Spotify reports for the song.
 */
function targetIsSourceLanguage(original: string[], targetLang: string): boolean {
  const target = baseLang(targetLang);
  if (!target) return false;
  const scriptLang = baseLang(SCRIPT_TO_LANG[detectScript(original)]);
  if (scriptLang && scriptLang === target) return true;
  const hint = baseLang((window as any).spotifyState?.language);
  return !!hint && hint === target;
}

/** A non-Latin song whose "translation" is the original text echoed back. */
function isEchoedTranslation(original: string[], translated: unknown, targetLang: string): boolean {
  return isNonLatinSource(original) && hasLetters(original) &&
    isIdentity(original, translated) && !targetIsSourceLanguage(original, targetLang);
}

/**
 * Share (0-1) of native-script lines whose romanization is still mostly
 * native script. 0 when the song has no native-script lines.
 */
export function unromanizedShare(original: string[], romanized: string[]): number {
  let nativeLines = 0;
  let stillNative = 0;
  original.forEach((line, i) => {
    if (nonLatinLetterRatio([line]) <= 0.5) return;
    nativeLines++;
    if (nonLatinLetterRatio([romanized[i] ?? '']) > 0.5) stillNative++;
  });
  return nativeLines === 0 ? 0 : stillNative / nativeLines;
}

/**
 * True when a romanizer exists for the song's script. detectScript reports
 * scripts it does not know (Greek, Armenian, Georgian, ...) as 'latin', and the
 * background returns their romanization as the original text: that is expected,
 * not a defect, so the translation must still be persisted.
 */
export function romanizerExpected(original: string[]): boolean {
  const script = detectScript(original);
  return script !== 'latin' && script !== 'other';
}

/** A non-Latin song with a romanizer whose romanization is the original text. */
function isUntouchedRomanization(original: string[], romanized: unknown): boolean {
  return romanizerExpected(original) && isNonLatinSource(original) && hasLetters(original) &&
    isIdentity(original, romanized);
}

/**
 * Reason a stored (cached/persisted) entry must not be used, or null when it is
 * fine. Entries validated fresh in this session (`transient`) are exempt from
 * the quality checks, so a flagged result kept in memory is not discarded and
 * re-requested over and over.
 */
export function getStoredEntryDefect(
  original: string[],
  lang: string,
  entry: ProcessedCache | null | undefined,
): string | null {
  if (!entry || typeof entry !== 'object') return 'missing entry';
  if (!Array.isArray(entry.romanized) || entry.romanized.length !== original.length) {
    return `romanized has ${Array.isArray(entry.romanized) ? entry.romanized.length : 'no'} lines for ${original.length} originals`;
  }
  if (entry.translated != null && (!Array.isArray(entry.translated) || entry.translated.length !== original.length)) {
    return `translated has ${Array.isArray(entry.translated) ? entry.translated.length : 'no'} lines for ${original.length} originals`;
  }
  if (entry.transient) return null;
  if (isEchoedTranslation(original, entry.translated, lang)) return `translation into "${lang}" is the original text`;
  if (isUntouchedRomanization(original, entry.romanized)) {
    return 'romanization is the original text';
  }
  return null;
}

export type FreshResultVerdict =
  | { ok: true; result: ProcessedCache }
  | { ok: false; reason: string };

/**
 * Validates a PROCESS response (K1) for `original` → `targetLang`.
 * - `null` / malformed / misaligned romanization → failure (nothing to cache).
 * - Failed, misaligned or echoed translation → kept with `translated: null`,
 *   `translationFailed: true` (romanization still usable, never persisted).
 * - Romanization of a non-Latin song that is still mostly native script →
 *   flagged `isLowQualityRomanization` and kept in memory only.
 */
export function validateFreshResult(
  original: string[],
  targetLang: string,
  raw: unknown,
): FreshResultVerdict {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'background returned no result' };
  const result = raw as ProcessedCache;
  if (!Array.isArray(result.romanized) || result.romanized.length !== original.length) {
    return {
      ok: false,
      reason: `romanized has ${Array.isArray(result.romanized) ? result.romanized.length : 'no'} lines for ${original.length} originals`,
    };
  }

  const translationOk =
    !result.translationFailed &&
    Array.isArray(result.translated) &&
    result.translated.length === original.length &&
    !isEchoedTranslation(original, result.translated, targetLang);
  if (!translationOk) {
    if (!result.translationFailed) {
      console.warn(`[sly-audit] ⚠️ Background translation into "${targetLang}" is unusable (missing, misaligned or the original text). Keeping romanization only.`);
    }
    result.translated = null;
    result.translationFailed = true;
    result.transient = true;
  }

  // Must flag (transient) everything getStoredEntryDefect would reject later,
  // or a fresh result would be cached, discarded and re-requested in a loop.
  // Scripts without a romanizer keep their text unchanged; that is not a defect.
  const romanizationUntouched = isUntouchedRomanization(original, result.romanized);
  if (romanizationUntouched ||
      (romanizerExpected(original) && unromanizedShare(original, result.romanized) > 0.5)) {
    console.warn('[sly-audit] ⚠️ Background romanization is still mostly native script. Flagging as low quality (not persisted).');
    result.isLowQualityRomanization = true;
    result.transient = true;
  }

  return { ok: true, result };
}
