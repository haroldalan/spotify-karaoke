import { safeBrowserCall } from '../utils/browserUtils';
import { saveSongCache } from './lyricsCache';
import { showToast } from '../dom/toast';
import { hashString } from '../utils/hashUtils';
import { getStoredEntryDefect, validateFreshResult, ROMANIZER_VERSION } from './processedCache';
import type { ProcessedCache, SongCache, LyricsCacheEntry, UnifiedSongCacheEntry } from './lyricsTypes';
import { applySpotifyRomanization } from './spotifyRomanization';

/**
 * How a fetchProcessed call ended, for callers that must tell a real failure
 * from a superseded request (e.g. to show an error toast only for the former).
 */
export interface FetchProcessedReport {
  status?: 'cached' | 'fetched' | 'failed' | 'superseded' | 'empty';
  reason?: string;
}

export async function fetchProcessed(
  lines: string[],
  lang: string,
  cache: SongCache,
  songKey: string,
  runtimeCache: Map<string, LyricsCacheEntry | UnifiedSongCacheEntry>,
  processGenRef: { value: number },
  report: FetchProcessedReport = {},
): Promise<ProcessedCache | null> {
  if (lines.length === 0 || !lines.some(l => l.trim().length > 0)) {
    report.status = 'empty';
    return null;
  }

  const sourceHash = hashString(lines.join('|'));
  if (cache.processed.has(lang)) {
    const cached = cache.processed.get(lang)!;
    const defect = cached.sourceHash !== sourceHash
      ? 'source lyrics hash does not match'
      : cached.translationFailed
        ? 'translation failed earlier; retrying'
        : getStoredEntryDefect(lines, lang, cached);
    if (!defect) {
      report.status = 'cached';
      // Restored native lines: Spotify's own romanized lines (spotifyRomanization.ts).
      if (applySpotifyRomanization(lines, cached) && !cached.transient) saveSongCache(songKey, cache, runtimeCache);
      return cached;
    }
    console.warn(`[sly-audit] 🧹 Rejecting processed cache for ${lang}: ${defect}.`);
    cache.processed.delete(lang);
  }

  const gen = ++processGenRef.value;

  console.log(`[sly-audit] ⏳ Requesting background processing for "${songKey}" (targetLang: ${lang})...`);
  // K1: sourceLang is only a hint (Spotify's tag; may be wrong for romanized lyrics).
  const sourceLang = ((window as any).spotifyState?.language as string | null | undefined) ?? null;
  const raw = await safeBrowserCall(() => browser.runtime.sendMessage({
    type: 'PROCESS',
    lines,
    targetLang: lang,
    sourceLang,
  })) as unknown;

  if (gen !== processGenRef.value) {
    report.status = 'superseded';
    return null;
  }

  const verdict = validateFreshResult(lines, lang, raw);
  if (!verdict.ok) {
    // K1: a null (or unusable) response is a failure. Never cache it.
    console.warn(`[sly-audit] ❌ Background processing failed for "${songKey}" (targetLang: ${lang}): ${verdict.reason}.`);
    report.status = 'failed';
    report.reason = verdict.reason;
    return null;
  }
  const result = verdict.result;

  if (result.wasTruncated) {
    showToast('Some long lines were truncated to maintain sync.', 4000);
  }

  result.sourceHash = sourceHash;
  result.romanizerVersion = ROMANIZER_VERSION;
  applySpotifyRomanization(lines, result);
  // Keep the result in memory either way (romanization stays usable after a
  // failed translation), but only persist a complete, validated result.
  cache.processed.set(lang, result);
  report.status = 'fetched';
  if (result.transient) {
    console.log(`[sly-audit] ⚠️ Background processing complete with a partial result (translationFailed=${!!result.translationFailed}, lowQualityRomanization=${!!result.isLowQualityRomanization}); kept in memory only.`);
  } else {
    console.log(`[sly-audit] ✅ Background processing complete!`);
    saveSongCache(songKey, cache, runtimeCache);
  }
  return result;
}
