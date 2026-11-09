// Japanese -> Hepburn romaji with kuroshiro + kuromoji. The dictionary (~12 MB) is
// fetched once from jsDelivr (the browser's HTTP cache keeps it) when the first Japanese
// song needs it.
import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';

export const DICT_PATH = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/';

let ready: Promise<InstanceType<typeof Kuroshiro>> | null = null;

function init() {
  ready ??= (async () => {
    const k = new Kuroshiro();
    await k.init(new KuromojiAnalyzer({ dictPath: DICT_PATH }));
    return k;
  })().catch((e) => {
    ready = null; // try again next time
    throw e;
  });
  return ready;
}

/** Tidies kuroshiro's spaced output: no space before punctuation or particles' long marks. */
export function tidyRomaji(s: string): string {
  return s
    .replace(/\s+([,.!?、。！？」』)\]])/g, '$1')
    .replace(/([「『(\[])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function romanizeJapanese(lines: string[]): Promise<string[]> {
  const k = await init();
  const out: string[] = [];
  for (const line of lines) {
    out.push(tidyRomaji(await k.convert(line, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })));
  }
  return out;
}
