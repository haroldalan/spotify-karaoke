// Port of: lyric-test/modules/background/engine.js

import { fetchYtmLyrics } from './ytm';
import { fetchLrcLibLyrics } from './lrclib';
import { extractImageColor } from './color';
import type { FetchedLyricsResult } from './lyricsCache';

/**
 * Executes the multi-source search strategy.
 * Priority: Synced YTM > Synced LRCLIB > Plain YTM > Plain LRCLIB
 */
async function performFetch(title: string, artist: string, uri = 'N/A'): Promise<FetchedLyricsResult> {
  // Broadcast progress to content scripts (they may display this in the status HUD)
  browser.runtime.sendMessage({ type: 'SLY_BACKGROUND_EVENT', event: 'Searching YouTube Music...' }).catch(() => {});
  console.log(`[sw-engine] 🛰️ SOURCE 1: Trying YouTube Music for track ${uri}...`);
  const ytm = await fetchYtmLyrics(title, artist).catch(() => null);
  if (ytm?.isSynced) {
    console.log(`[sw-engine] ✅ SUCCESS: Synced lyrics found on YouTube Music.`);
    return { ok: true, data: { syncedLyrics: ytm.syncedLyrics, isSynced: true, source: ytm.source } };
  }

  browser.runtime.sendMessage({ type: 'SLY_BACKGROUND_EVENT', event: 'Consulting LRCLIB...' }).catch(() => {});
  console.log(`[sw-engine] 🛰️ SOURCE 2: Trying LRCLIB for track ${uri}...`);
  const lrc = await fetchLrcLibLyrics(title, artist).catch(() => null);
  if (lrc?.isSynced) {
    console.log(`[sw-engine] ✅ SUCCESS: Synced lyrics found on LRCLIB.`);
    return { ok: true, data: { syncedLyrics: lrc.syncedLyrics, isSynced: true, source: 'LRCLIB' } };
  }

  if (ytm?.plainLyrics) {
    console.log(`[sw-engine] ⚠️ PARTIAL: Falling back to plain lyrics from YouTube Music.`);
    return { ok: true, data: { plainLyrics: ytm.plainLyrics, isSynced: false, source: ytm.source } };
  }

  if (lrc?.plainLyrics) {
    console.log(`[sw-engine] ⚠️ PARTIAL: Falling back to plain lyrics from LRCLIB.`);
    return { ok: true, data: { plainLyrics: lrc.plainLyrics, isSynced: false, source: 'LRCLIB' } };
  }

  console.warn(`[sw-engine] ❌ FAILURE: No lyrics found across all external sources.`);
  // Note: the original source had `return { ok: false, data: finalData.data }` here,
  // but `finalData` is not in scope — that is a bug in the original. Correct intent is { ok: false }.
  return { ok: false };
}

const colorCache = new Map<string, string>();

/**
 * Fast-track color extraction for instant HUD feedback.
 */
export async function getColorOnly(albumArtUrl: string | undefined): Promise<string | null> {
  if (!albumArtUrl) return null;
  if (colorCache.has(albumArtUrl)) return colorCache.get(albumArtUrl)!;
  try {
    const color = await extractImageColor(albumArtUrl);
    if (color) colorCache.set(albumArtUrl, color);
    return color;
  } catch (e) {
    return null;
  }
}

/**
 * Orchestrates fetching lyrics and extracting theme colors.
 */
export async function getLyricsForTrack(
  title: string,
  artist: string,
  albumArtUrl?: string,
  uri?: string,
): Promise<FetchedLyricsResult> {
  console.log(`[sw-engine] Orchestrating fetch for: ${title} - ${artist} [ID: ${uri}]`);

  const finalData = await performFetch(title, artist, uri);
  if (!finalData.data) finalData.data = { isSynced: false };

  if (albumArtUrl) {
    try {
      if (colorCache.has(albumArtUrl)) {
        finalData.data.extractedColor = colorCache.get(albumArtUrl);
      } else {
        const color = await extractImageColor(albumArtUrl);
        if (color) {
          colorCache.set(albumArtUrl, color);
          finalData.data.extractedColor = color;
        }
      }
    } catch (e) {
      console.error('[sw-engine] Color extraction failed, proceeding without it.', e);
    }
  }

  return finalData;
}
