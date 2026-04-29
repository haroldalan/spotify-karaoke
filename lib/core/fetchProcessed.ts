import { safeBrowserCall } from '../utils/browserUtils';
import { saveSongCache } from './lyricsCache';
import { showToast } from '../dom/toast';
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

  if (cache.processed.has(lang)) return cache.processed.get(lang)!;

  const gen = ++processGenRef.value;

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

  cache.processed.set(lang, result);
  saveSongCache(songKey, cache, runtimeCache);
  return result;
}
