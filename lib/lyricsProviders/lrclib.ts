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
    // SLY OPTIMIZATION: Skip /api/get (which requires duration for high hit rate) 
    // and go straight to /api/search to save latency.

    const searchRes = await fetchWithTimeout(
      `https://lrclib.net/api/search?${params.toString()}`,
    );
    if (!searchRes.ok) return null;
    const results = await searchRes.json() as Record<string, unknown>[];
    console.log(`[LRCLIB] Search results: ${results.length}`);
    const match = results.find(r => 
      r.syncedLyrics && 
      (r.trackName as string)?.toLowerCase().includes(cleanTitle.toLowerCase())
    ) || results[0] || null;
    return match ? { ...match, isSynced: !!match.syncedLyrics } as LrclibResult : null;
  } catch (err: unknown) {
    console.warn(`[LRCLIB] Fetch failed:`, (err as Error).message);
    return null;
  }
}
