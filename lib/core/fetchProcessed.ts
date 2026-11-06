import { safeBrowserCall } from '../utils/browserUtils';
import { saveSongCache } from './lyricsCache';
import { showToast } from '../dom/toast';
import { hashString } from '../utils/hashUtils';
import type { ProcessedCache, SongCache, LyricsCacheEntry } from './lyricsTypes';

export async function fetchProcessed(
  lines: string[],
  lang: string,
  cache: SongCache,
  songKey: string,
  runtimeCache: Map<string, LyricsCacheEntry>,
  processGenRef: { value: number },
): Promise<ProcessedCache | null> {
  if (lines.length === 0 || !lines.some(l => l.trim().length > 0)) return null;

  const sourceHash = hashString(lines.join('|'));
  if (cache.processed.has(lang)) {
    const cached = cache.processed.get(lang)!;
    if (cached.sourceHash === sourceHash) return cached;
    console.warn(`[sly-audit] 🧹 Rejecting processed cache for ${lang}: source lyrics hash does not match.`);
    cache.processed.delete(lang);
  }

  const gen = ++processGenRef.value;

  console.log(`[sly-audit] ⏳ Requesting background processing for "${songKey}" (targetLang: ${lang})...`);
  const result = await safeBrowserCall(() => browser.runtime.sendMessage({
    type: 'PROCESS',
    lines,
    targetLang: lang,
  })) as ProcessedCache | null;

  if (gen !== processGenRef.value) return null;
  if (!result || !Array.isArray(result.translated)) return null;

  if (result.wasTruncated) {
    showToast('Some long lines were truncated to maintain sync.', 4000);
  }

  console.log(`[sly-audit] ✅ Background processing complete!`);
  result.sourceHash = sourceHash;
  cache.processed.set(lang, result);
  saveSongCache(songKey, cache, runtimeCache);
  return result;
}
