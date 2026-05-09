import { detectScript, GOOGLE_ROMANIZE_SCRIPTS, SCRIPT_NATIVE_LANG, SCRIPT_TO_LANG } from './scriptDetector';
import { googleProcess } from '../translateClient';
import { romanizeLocally } from './localRomanizer';
import { preserveCasing } from './casePreserver';

export async function processLines(
  lines: string[],
  targetLang: string
): Promise<{
  translated: string[];
  romanized: string[];
  isLowQualityRomanization?: boolean;
  wasTruncated?: boolean;
}> {
  const script = detectScript(lines);
  const sourceLang = SCRIPT_TO_LANG[script] || 'auto';

  if (script === 'latin') {
    const { translated, wasTruncated } = await googleProcess(lines, targetLang, false, sourceLang);
    return { translated, romanized: lines, wasTruncated };
  }

  const result = await (async () => {
    if (script === 'chinese' && (targetLang === 'zh-CN' || targetLang === 'zh-TW')) {
      const romanized = await romanizeLocally(lines, script);
      return { translated: lines, romanized };
    }

    if (SCRIPT_NATIVE_LANG[script] === targetLang) {
      const romanized = await romanizeLocally(lines, script);
      return { translated: lines, romanized };
    }

    if (GOOGLE_ROMANIZE_SCRIPTS.has(script)) {
      return googleProcess(lines, targetLang, true, sourceLang);
    }

    const [{ translated, wasTruncated }, romanized] = await Promise.all([
      googleProcess(lines, targetLang, false, sourceLang),
      romanizeLocally(lines, script),
    ]);

    return { translated, romanized, wasTruncated };
  })();

  result.romanized = result.romanized.map((rom, i) => {
    const casePreserved = preserveCasing(lines[i], rom);
    return stripDiacritics(casePreserved);
  });
  
  return result;
}

/**
 * Strips diacritics (macrons, dots, tone marks) from text to produce a "texting style" ASCII output.
 */
function stripDiacritics(text: string): string {
  if (!text) return text;
  // Use NFD normalization to separate diacritics from base characters, then remove them
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
