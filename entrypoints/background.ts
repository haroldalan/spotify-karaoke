import { processLines } from '../lib/lyrics/lyricsProcessor';
import { lyricsCache } from '../lib/lyricsProviders/lyricsCache';
import { lyricsPersistence } from '../lib/lyricsProviders/lyricsPersistence';
import { getLyricsForTrack, getColorOnly } from '../lib/lyricsProviders/lyricsEngine';
import { mxmProvider } from '../lib/lyricsProviders/mxm';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      msg: {
        type: string;
        // PROCESS fields
        lines?: string[];
        targetLang?: string;
        // FETCH_LYRICS / PREFETCH_LYRICS fields
        payload?: { 
          title?: string; 
          artist?: string; 
          albumArtUrl?: string; 
          uri?: string; 
          forceRefresh?: boolean;
          // MXM fields
          trackId?: string;
          providerLyricsId?: string | null;
          hexGid?: string;
          interceptId?: number;
          name?: string;
          status?: string;
        };
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
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_CHECK_CACHE') {
        const { title, artist, uri } = msg.payload ?? {} as any;
        const cacheKey = lyricsCache.getCacheKey(title!, artist!, uri);
        
        (async () => {
          const stored = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
          if (stored) {
             console.log(`[sly-sw] Cache check for ${title}: Found. Native=${stored.nativeStatus || 'N/A'}, Custom=${stored.prefetchState || 'N/A'}`);
             sendResponse({ ok: true, found: true, ...stored });
          } else {
             console.log(`[sly-sw] Cache check for ${title}: Not found.`);
             sendResponse({ ok: true, found: false });
          }
        })();
        return true;
      }

      if (msg.type === 'FETCH_LYRICS' || msg.type === 'PREFETCH_LYRICS') {
        const { title, artist, albumArtUrl, uri, forceRefresh } = msg.payload ?? {} as NonNullable<typeof msg.payload>;

        if (!title || !artist) {
          sendResponse({ ok: false, error: 'Missing metadata' });
          return true;
        }

        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);

        (async () => {
          // 1. L1: Instant Memory Cache Hit
          if (lyricsCache.has(cacheKey) && !forceRefresh) {
            const cached = lyricsCache.get(cacheKey);
            if (cached && !(cached as any).isPlaceholder) {
              console.log(`[ServiceWorker] L1 HIT: ${title} - ${artist}`);
              sendResponse(cached);
              return;
            }
          }

          // 2. L2: Persistent Storage Hit
          const stored = forceRefresh ? null : await lyricsPersistence.get(cacheKey);
          if (stored && !(stored as any).isPlaceholder) {
            console.log(`[ServiceWorker] L2 HIT: ${title} - ${artist}`);
            
            // Reconstruct prefetchState if missing (legacy cache support)
            if (!stored.prefetchState) {
              if (stored.ok && stored.data) {
                stored.prefetchState = stored.data.isSynced ? 'SYNCED' : 'UNSYNCED';
              } else {
                stored.prefetchState = 'MISSING';
              }
            }

            // Backwards compatibility: Promote old nativeMissing flag to new nativeStatus
            if ((stored as any).nativeMissing && !stored.nativeStatus) {
              stored.nativeStatus = 'MISSING';
            }

            lyricsCache.set(cacheKey, stored); // Promote to L1
            sendResponse(stored);

            // --- UPGRADE LOGIC ---
            const needsUpgrade = !stored.ok || (stored.data && stored.data.isSynced === false);
            const lastCheck = stored.lastCheckedAt || 0;
            const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
 
            if (needsUpgrade && lastCheck < weekAgo) {
              console.log(`[ServiceWorker] Upgrade Check for ${title}`);
              getLyricsForTrack(title, artist, albumArtUrl, uri).then(async (fresh) => {
                if (fresh && fresh.ok && (fresh.data?.isSynced || !stored.ok)) {
                  if (stored.nativeStatus && !fresh.nativeStatus) {
                    fresh.nativeStatus = stored.nativeStatus;
                  }
                  await lyricsPersistence.set(cacheKey, fresh);
                  lyricsCache.set(cacheKey, fresh);
                  if (sender.tab?.id) {
                    browser.tabs.sendMessage(sender.tab.id, {
                      type: 'LYRICS_UPGRADED',
                      payload: { cacheKey, data: fresh },
                    });
                  }
                } else {
                  await lyricsPersistence.set(cacheKey, stored);
                }
              }).catch(async () => {
                await lyricsPersistence.set(cacheKey, stored);
              });
            }
            return;
          }

          // 3. L3: Join In-Flight Fetch (Deduplication)
          const inFlight = lyricsCache.getInFlight(cacheKey);
          if (inFlight) {
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
                const existing = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
                result.nativeStatus = result.nativeStatus || existing?.nativeStatus || (msg.payload as any)?.nativeStatus;
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
      // New handler: Persistent Native Status Reporting
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_REPORT_NATIVE_STATUS') {
        const { title, artist, uri, status } = msg.payload ?? {};
        if (!title || !artist || !status) return true;

        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);
        (async () => {
          const existing = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
          
          if (!existing) {
            const fresh = {
              ok: false,
              prefetchState: 'MISSING' as const,
              nativeStatus: status as any,
              isPlaceholder: true
            };
            lyricsCache.set(cacheKey, fresh);
            await lyricsPersistence.set(cacheKey, fresh);
          } else if (existing.nativeStatus !== status) {
            existing.nativeStatus = status as any;
            lyricsCache.set(cacheKey, existing);
            await lyricsPersistence.set(cacheKey, existing);
          }
          sendResponse({ ok: true });
        })();
        return true;
      }

      // ----------------------------------------------------------------
      // ROBUST MUSIXMATCH HANDLERS (Background-Centric)
      // ----------------------------------------------------------------
      
      if (msg.type === 'SLY_MXM_WARMUP') {
        mxmProvider.warmup();
        return false; // No response needed
      }

      if (msg.type === 'SLY_MXM_NOTIFY_METADATA') {
        const { trackId, name, artist } = msg.payload ?? {};
        if (trackId && name && artist) {
          mxmProvider.notifyMetadata(trackId, name, artist);
        }
        return false;
      }

      if (msg.type === 'SLY_MXM_NEW_INTERCEPTION') {
        const { trackId } = msg.payload ?? {};
        if (trackId) {
          const gen = mxmProvider.newInterception(trackId);
          sendResponse({ generation: gen });
        }
        return true;
      }

      if (msg.type === 'SLY_MXM_FETCH_NATIVE') {
        const { providerLyricsId, trackId, hexGid, interceptId } = msg.payload ?? {};
        mxmProvider.fetchNativeLines(
          providerLyricsId ?? null,
          trackId ?? '',
          hexGid ?? '',
          interceptId ?? 0
        ).then(lines => {
          sendResponse({ ok: !!lines, lines });
        }).catch(err => {
          console.error('[SKaraoke:BG] MXM Background Fetch failed:', err);
          sendResponse({ ok: false, error: err.message });
        });
        return true;
      }
    },
  );
});

