// Port of: lyric-test/modules/background/lrclib.js

import { fetchWithTimeout } from './fetchUtils';

export interface LrclibResult {
  syncedLyrics?: string;
  plainLyrics?: string;
  isSynced: boolean;
}

export async function fetchLrcLibLyrics(
  title: string,
  artist: string,
): Promise<LrclibResult | null> {
  try {
    const cleanTitle = title.split(' (')[0].split(' - ')[0].trim();
    const params = new URLSearchParams({ track_name: cleanTitle, artist_name: artist });
    console.log(`[LRCLIB] Searching: ${cleanTitle} - ${artist}`);
    const res = await fetchWithTimeout(`https://lrclib.net/api/get?${params.toString()}`);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      console.log(`[LRCLIB] Success (Synced: ${!!data.syncedLyrics})`);
      return { ...data, isSynced: !!data.syncedLyrics } as LrclibResult;
    }

    const searchRes = await fetchWithTimeout(
      `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + artist)}`,
    );
    const results = await searchRes.json() as Record<string, unknown>[];
    console.log(`[LRCLIB] Search results: ${results.length}`);
    const match = results.find(r => r.syncedLyrics) || results[0] || null;
    return match ? { ...match, isSynced: !!match.syncedLyrics } as LrclibResult : null;
  } catch (err: unknown) {
    console.warn(`[LRCLIB] Fetch failed:`, (err as Error).message);
    return null;
  }
}
