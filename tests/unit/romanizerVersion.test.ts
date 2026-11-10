// The romanizer's output for a fixed set of lines, kept with the ROMANIZER_VERSION it was
// made under. Cached romanizations are keyed by that version, so changing the output without
// bumping it serves stale lines for weeks. When this fails:
//   - the change is wanted: bump ROMANIZER_VERSION (process.ts), then
//     UPDATE_GOLDEN=1 npx vitest run tests/unit/romanizerVersion.test.ts
//   - it isn't: the romanizer regressed.
// Lines are common words and made-up phrases, not lyrics.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { romanizeLines } from '../../src/background/text/romanize';
import { ROMANIZER_VERSION } from '../../src/background/text/process';
import type { Script } from '../../src/shared/scripts';

const FILE = new URL('../fixtures/romanizer-golden.json', import.meta.url);
const CASES: [Script, string[]][] = [
  ['Deva', ['मेरा दिल तेरा है', 'कुछ तो बात है', 'अच्छा चलता हूँ', 'मैं हर पल तेरी याद में', 'दिल love you करता है']],
  ['Guru', ['ਤੇਰਾ ਦਿਲ', 'ਅੱਜ ਦੀ ਰਾਤ', 'ਸੱਜਣਾ ਵੇ', 'ਲੱਖ ਵਾਰੀ ਛੁਪਾ ਲੇ', 'ਦਿਲ मेरा ਤੇਰਾ']],
  ['Taml', ['நான் உன்னை காதலிக்கிறேன்', 'என் நெஞ்சில் நீ', 'பார்த்தேன் 10,000 वाला']],
  ['Telu', ['నా మనసు నీదే', 'ప్రేమ ఒక పాట']],
  ['Beng', ['আমার সোনার বাংলা', 'তুমি আমার']],
  ['Gujr', ['છોકરી ચાલ', 'મારું દિલ']],
  ['Knda', ['ನನ್ನ ಹೃದಯ']],
  ['Mlym', ['എന്റെ ഹൃദയം', 'ഞാൻ നിന്നെ']],
  ['Kore', ['사랑해 너만을', '보고 싶다', '오늘 밤 tonight']],
  ['Cyrl', ['Тёплое место', 'Звёздная пыль']],
  ['Thai', ['ฉันรักเธอ', 'คิดถึง']],
  ['Hani', ['我爱你', '晴天']],
];

async function outputs() {
  const out: Record<string, (string | null)[]> = {};
  for (const [script, lines] of CASES) out[script] = await romanizeLines(lines, script, { google: async () => null });
  return out;
}

describe('romanizer output is versioned', () => {
  it('matches the recorded output for this ROMANIZER_VERSION', async () => {
    const now = await outputs();
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(FILE, JSON.stringify({ version: ROMANIZER_VERSION, outputs: now }, null, 1) + '\n');
      return;
    }
    const golden = JSON.parse(readFileSync(FILE, 'utf8')) as { version: number; outputs: typeof now };
    if (golden.version === ROMANIZER_VERSION) {
      expect(now, 'romanizer output changed: bump ROMANIZER_VERSION (process.ts), then UPDATE_GOLDEN=1').toEqual(golden.outputs);
    } else {
      expect.fail(`ROMANIZER_VERSION is ${ROMANIZER_VERSION}, the recorded output is for ${golden.version}: UPDATE_GOLDEN=1 npx vitest run tests/unit/romanizerVersion.test.ts`);
    }
  });
});
