import { processLines } from '../lib/lyrics/lyricsProcessor';
import { lyricsCache } from '../lib/lyricsProviders/lyricsCache';
import { lyricsPersistence } from '../lib/lyricsProviders/lyricsPersistence';
import { getLyricsForTrack, getColorOnly } from '../lib/lyricsProviders/lyricsEngine';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      msg: {
        type: string;
        // PROCESS fields
        lines?: string[];
        targetLang?: string;
        // FETCH_LYRICS / PREFETCH_LYRICS fields
        payload?: { title: string; artist: string; albumArtUrl?: string; uri?: string };
      },
      sender,
      sendResponse,
    ) => {
      // ----------------------------------------------------------------
      // Existing handler: romanization + translation pipeline
      // ----------------------------------------------------------------
      if (msg.type === 'PROCESS') {
        processLines(msg.lines ?? [], msg.targetLang ?? 'en')
          .then(sendResponse)
          .catch((err) => {
            console.error('[SKaraoke:BG] PROCESS failed:', err);
            // Fallback: return originals for both modes
            sendResponse({ translated: msg.lines, romanized: msg.lines });
          });
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: fast-track album art color extraction
      // Port of: lyric-test/service-worker.js GET_COLOR block
      // ----------------------------------------------------------------
      if (msg.type === 'GET_COLOR') {
        getColorOnly(msg.payload?.albumArtUrl).then(color => {
          sendResponse({ color });
        });
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: Fetch Spotify CSS to bypass CORS for Deep Scavenger
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_FETCH_CSS') {
        fetch((msg as any).url)
          .then(res => res.text())
          .then(text => sendResponse({ success: true, cssText: text }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: fetch missing/unsynced lyrics from YTM + LRCLIB
      // Port of: lyric-test/service-worker.js FETCH_LYRICS block
      // Full 4-layer cache: L1 memory → L2 persistent → L3 in-flight → L4 network
      // ----------------------------------------------------------------
      if (msg.type === 'FETCH_LYRICS' || msg.type === 'PREFETCH_LYRICS') {
        const { title, artist, albumArtUrl, uri } = msg.payload ?? {} as NonNullable<typeof msg.payload>;

        if (!title || !artist) {
          sendResponse({ ok: false, error: 'Missing metadata' });
          return true;
        }

        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);

        (async () => {
          // 1. L1: Instant Memory Cache Hit
          if (lyricsCache.has(cacheKey)) {
            console.log(`[ServiceWorker] L1 HIT: ${title} - ${artist}`);
            sendResponse(lyricsCache.get(cacheKey));
            return;
          }

          // 2. L2: Persistent Storage Hit
          const stored = await lyricsPersistence.get(cacheKey);
          if (stored) {
            console.log(`[ServiceWorker] L2 HIT: ${title} - ${artist}`);
            
            // Reconstruct prefetchState if missing (legacy cache support)
            if (!stored.prefetchState) {
              if (stored.ok && stored.data) {
                stored.prefetchState = stored.data.isSynced ? 'SYNCED' : 'UNSYNCED';
              } else {
                stored.prefetchState = 'MISSING';
              }
            }

            lyricsCache.set(cacheKey, stored); // Promote to L1
            sendResponse(stored);

            // --- UPGRADE LOGIC ---
            // If we have unsynced lyrics cached, silently check once per week
            // whether a synced version has become available.
            const isUnsynced = stored.data && stored.data.isSynced === false;
            const lastCheck = stored.lastCheckedAt || 0;
            const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

            if (isUnsynced && lastCheck < weekAgo) {
              console.log(`[ServiceWorker] 💡 Upgrade Check triggered for unsynced track: ${title}`);
              // Perform silent background fetch without blocking the sendResponse above
              getLyricsForTrack(title, artist, albumArtUrl, uri).then(async (fresh) => {
                if (fresh && fresh.ok && fresh.data?.isSynced) {
                  console.log(`[ServiceWorker] ✨ UPGRADE SUCCESS: Found synced lyrics for ${title}`);
                  await lyricsPersistence.set(cacheKey, fresh);
                  lyricsCache.set(cacheKey, fresh);

                  // Broadcast to the originating tab so it can re-render
                  if (sender.tab?.id) {
                    browser.tabs.sendMessage(sender.tab.id, {
                      type: 'LYRICS_UPGRADED',
                      payload: { cacheKey, data: fresh },
                    });
                  }
                } else {
                  // Still unsynced or failed — update timestamp to avoid checking for another week
                  console.log(`[ServiceWorker] 😴 Upgrade Check: No synced version found for ${title}. Sleeping for 7 days.`);
                  await lyricsPersistence.set(cacheKey, stored);
                }
              }).catch(async (err) => {
                console.error('[ServiceWorker] Upgrade check failed:', err);
                await lyricsPersistence.set(cacheKey, stored);
              });
            }
            return;
          }

          // 3. L3: Join In-Flight Fetch (Deduplication)
          const inFlight = lyricsCache.getInFlight(cacheKey);
          if (inFlight) {
            console.log(`[ServiceWorker] Joining in-flight fetch for: ${title}`);
            const res = await inFlight;
            sendResponse(res);
            return;
          }

          // 4. L4: Perform Network Fetch and Cache Result
          const fetchTask = (async () => {
            try {
              const result = await getLyricsForTrack(title, artist, albumArtUrl, uri);
              if (result) {
                if (result.ok) {
                  result.prefetchState = result.data?.isSynced ? 'SYNCED' : 'UNSYNCED';
                } else {
                  result.prefetchState = 'MISSING';
                }
                // Always persist results (including failures) to avoid redundant searches
                lyricsCache.set(cacheKey, result);
                await lyricsPersistence.set(cacheKey, result);
              }
              return result;
            } catch (e) {
              console.error('[ServiceWorker] Critical fetch error:', e);
              return { ok: false, prefetchState: 'MISSING' } as any;
            }
          })();

          lyricsCache.setInFlight(cacheKey, fetchTask);
          const finalResult = await fetchTask;
          sendResponse(finalResult);
        })();

        return true;
      }

      // ----------------------------------------------------------------
      // New handler: Persistent Native Missing Reporting
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_REPORT_NATIVE_MISSING') {
        const { title, artist, uri } = msg.payload ?? {};
        if (!title || !artist) return true;

        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);
        (async () => {
          const stored = await lyricsPersistence.get(cacheKey);
          if (stored && !stored.nativeMissing) {
            stored.nativeMissing = true;
            lyricsCache.set(cacheKey, stored);
            await lyricsPersistence.set(cacheKey, stored);
            console.log(`[ServiceWorker] Tagged ${title} as NATIVE_MISSING in persistent cache.`);
          }
        })();
        return true;
      }
    },
  );
});

