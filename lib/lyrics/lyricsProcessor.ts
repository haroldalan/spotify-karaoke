import { detectScript, GOOGLE_ROMANIZE_SCRIPTS, SCRIPT_NATIVE_LANG } from './scriptDetector';
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

  if (script === 'latin') {
    const { translated, wasTruncated } = await googleProcess(lines, targetLang, false);
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
      return googleProcess(lines, targetLang, true);
    }

    const [{ translated, wasTruncated }, romanized] = await Promise.all([
      googleProcess(lines, targetLang, false),
      romanizeLocally(lines, script),
    ]);

    return { translated, romanized, wasTruncated };
  })();

  result.romanized = result.romanized.map((rom, i) => preserveCasing(lines[i], rom));
  return result;
}
