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
        payload?: { title: string; artist: string; albumArtUrl?: string; uri?: string; forceRefresh?: boolean };
      },
      sender,
      sendResponse,
    ) => {
      // ----------------------------------------------------------------
      // Existing handler: romanization + translation pipeline
      // ----------------------------------------------------------------
      if (msg.type === 'PROCESS') {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 30000));
        Promise.race([processLines(msg.lines ?? [], msg.targetLang ?? 'en'), timeout])
          .then(sendResponse)
          .catch((err) => {
            console.error('[SKaraoke:BG] PROCESS failed or timed out:', err);
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
        const { albumArtUrl, title, artist, uri } = msg.payload ?? {};
        console.log('[SKaraoke:BG] GET_COLOR requested:', { title, artist, albumArtUrl, uri });
        const cacheKey = lyricsCache.getCacheKey(title || '', artist || '', uri || '');

        (async () => {
          try {
            // SLY FIX (Bug 24): Check persistent storage for cached color first
            const existing = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
            if (existing?.data?.extractedColor) {
              console.log(`[SKaraoke:BG] Color cache HIT for ${title}`);
              sendResponse({ color: existing.data.extractedColor });
              return;
            }

            const color = await getColorOnly(albumArtUrl);
            sendResponse({ color });

            // SLY FIX (Bug 24): Persist the extracted color back to storage if track exists
            if (color && existing) {
              if (!existing.data) existing.data = {} as any;
              existing.data.extractedColor = color;
              try {
                await lyricsPersistence.set(cacheKey, existing);
                lyricsCache.set(cacheKey, existing);
              } catch (e) {
                console.error('[SKaraoke:BG] Failed to persist color:', e);
              }
            }
          } catch (err) {
            console.error('[SKaraoke:BG] GET_COLOR error:', err);
            sendResponse({ color: null });
          }
        })();
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: Fetch Spotify CSS to bypass CORS for Deep Scavenger
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_FETCH_CSS') {
        const url = (msg as any).url;
        // SLY FIX (Bug 6): Validate URL origin to prevent background fetch proxying
        if (!url || !url.startsWith('https://open.spotifycdn.com/')) {
          console.error('[SKaraoke:BG] SLY_FETCH_CSS rejected: Untrusted origin', url);
          sendResponse({ success: false, error: 'Untrusted origin' });
          return true;
        }

        fetch(url)
          .then(res => res.text())
          .then(text => sendResponse({ success: true, cssText: text }))
          .catch(err => {
             console.error('[SKaraoke:BG] SLY_FETCH_CSS failed:', err);
             sendResponse({ success: false, error: err.message });
          });
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: fetch missing/unsynced lyrics from YTM + LRCLIB
      // Port of: lyric-test/service-worker.js FETCH_LYRICS block
      // Full 4-layer cache: L1 memory → L2 persistent → L3 in-flight → L4 network
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_CHECK_CACHE') {
        const { title, artist, uri } = msg.payload ?? {} as any;
        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);
        
        (async () => {
          try {
            const stored = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
            if (stored) {
               console.log(`[sly-sw] Cache check for ${title}: Found. Native=${stored.nativeStatus || 'N/A'}, Custom=${stored.prefetchState || 'N/A'}`);
               sendResponse({ ok: true, found: true, ...stored });
            } else {
               console.log(`[sly-sw] Cache check for ${title}: Not found.`);
               sendResponse({ ok: true, found: false });
            }
          } catch (err) {
            console.error('[sly-sw] SLY_CHECK_CACHE error:', err);
            sendResponse({ ok: false, error: 'Internal cache error' });
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
          try {
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
              // If we have unsynced or missing lyrics cached, silently check once per week
              // whether a better version has become available.
              const needsUpgrade = !stored.ok || (stored.data && stored.data.isSynced === false);
              const lastCheck = stored.lastCheckedAt || 0;
              const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
   
              if (needsUpgrade && lastCheck < weekAgo) {
                console.log(`[ServiceWorker] 💡 Upgrade Check triggered for ${stored.ok ? 'unsynced' : 'missing'} track: ${title}`);
                // Perform silent background fetch without blocking the sendResponse above
                getLyricsForTrack(title, artist, albumArtUrl, uri).then(async (fresh) => {
                  if (fresh && fresh.ok && (fresh.data?.isSynced || !stored.ok)) {
                    console.log(`[ServiceWorker] ✨ UPGRADE SUCCESS: Found ${fresh.data?.isSynced ? 'synced' : 'new'} lyrics for ${title}`);
                    
                    // SLY FIX: Smart Merge. Don't let an upgrade wipe out our known nativeStatus.
                    if (stored.nativeStatus && !fresh.nativeStatus) {
                      fresh.nativeStatus = stored.nativeStatus;
                    }

                    // SLY FIX (Bug 5): Update lastCheckedAt on success to avoid re-checking on every play
                    fresh.lastCheckedAt = Date.now();

                    try {
                      await lyricsPersistence.set(cacheKey, fresh);
                      lyricsCache.set(cacheKey, fresh);
                    } catch (e) {
                      console.error('[ServiceWorker] Persistence error in upgrade:', e);
                    }

                    // SLY FIX (Bug 10): Broadcast to ALL Spotify tabs, not just the originating one
                    browser.tabs.query({ url: '*://open.spotify.com/*' }).then(tabs => {
                      tabs.forEach(tab => {
                        if (tab.id) {
                          browser.tabs.sendMessage(tab.id, {
                            type: 'LYRICS_UPGRADED',
                            payload: { cacheKey, data: fresh },
                          }).catch(() => {});
                        }
                      });
                    });
                  } else {
                    // Still unsynced or failed — update timestamp to avoid checking for another week
                    console.log(`[ServiceWorker] 😴 Upgrade Check: No synced version found for ${title}. Sleeping for 7 days.`);
                    // SLY FIX (Bug 5): Update lastCheckedAt even on failure
                    stored.lastCheckedAt = Date.now();
                    try {
                      await lyricsPersistence.set(cacheKey, stored);
                    } catch (e) {
                      console.error('[ServiceWorker] Persistence error in failure:', e);
                    }
                  }
                }).catch(async (err) => {
                  console.error('[ServiceWorker] Upgrade check failed:', err);
                  stored.lastCheckedAt = Date.now();
                  try {
                    await lyricsPersistence.set(cacheKey, stored);
                  } catch (e) {
                    console.error('[ServiceWorker] Persistence error in catch:', e);
                  }
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
                  // SLY FIX: Smart Merge. Don't let a fresh fetch wipe out our known nativeStatus.
                  const existing = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
                  
                  // Priority: Existing L1/L2 (inc. legacy nativeMissing) > Payload (Known state) > Fresh Result
                  result.nativeStatus = result.nativeStatus || 
                                        existing?.nativeStatus || 
                                        ((existing as any)?.nativeMissing ? 'MISSING' : undefined) || 
                                        (msg.payload as any)?.nativeStatus;

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
          } catch (err) {
            console.error('[ServiceWorker] FETCH_LYRICS error:', err);
            sendResponse({ ok: false, error: 'Internal fetch error' });
          }
        })();

        return true;
      }

      // ----------------------------------------------------------------
      // New handler: Persistent Native Status Reporting
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_REPORT_NATIVE_STATUS') {
        const { title, artist, uri, status } = msg.payload ?? {};
        if (!title || !artist || !status) {
          sendResponse({ ok: false, error: 'Invalid payload' });
          return true;
        }

        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);
        (async () => {
          try {
            const existing = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
            
            if (!existing) {
              const fresh = {
                ok: false,
                prefetchState: 'MISSING' as const,
                nativeStatus: status,
                isPlaceholder: true
              };
              lyricsCache.set(cacheKey, fresh);
              await lyricsPersistence.set(cacheKey, fresh);
              console.log(`[ServiceWorker] 💾 SAVED (Fresh): Native Status for ${title} -> ${status}`);
            } else if (existing.nativeStatus !== status) {
              existing.nativeStatus = status;
              lyricsCache.set(cacheKey, existing);
              await lyricsPersistence.set(cacheKey, existing);
              console.log(`[ServiceWorker] 💾 SAVED (Update): Native Status for ${title} -> ${status}`);
            }
            sendResponse({ ok: true });
          } catch (err) {
            console.error('[ServiceWorker] SLY_REPORT_NATIVE_STATUS error:', err);
            sendResponse({ ok: false, error: 'Internal status update error' });
          }
        })();
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: Musixmatch Token Bridge (Bypasses localStorage)
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_GET_MXM_TOKEN') {
        browser.storage.local.get(['skl_mxm_token', 'skl_mxm_token_expiry']).then(res => {
          sendResponse({ 
            token: res.skl_mxm_token || null, 
            expiry: res.skl_mxm_token_expiry || 0 
          });
        }).catch(err => {
          console.error('[SKaraoke:BG] SLY_GET_MXM_TOKEN failed:', err);
          sendResponse({ token: null, expiry: 0, error: err.message });
        });
        return true;
      }

      if (msg.type === 'SLY_SET_MXM_TOKEN') {
        const { token, expiry } = (msg as any).payload ?? {};
        browser.storage.local.set({ 
          skl_mxm_token: token, 
          skl_mxm_token_expiry: expiry 
        }).then(() => sendResponse({ ok: true }))
          .catch(err => {
            console.error('[SKaraoke:BG] SLY_SET_MXM_TOKEN failed:', err);
            sendResponse({ ok: false, error: err.message });
          });
        return true;
      }

      // SLY FIX (Bug 35): Persistent Deep Scavenge Throttling
      if (msg.type === 'SLY_GET_SCAVENGE_TIME') {
        browser.storage.local.get(['last_deep_scavenge_time']).then(res => {
          sendResponse({ time: res.last_deep_scavenge_time || 0 });
        }).catch(() => sendResponse({ time: 0 }));
        return true;
      }

      if (msg.type === 'SLY_SET_SCAVENGE_TIME') {
        const { time } = (msg as any).payload ?? {};
        browser.storage.local.set({ last_deep_scavenge_time: time || Date.now() })
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }
    },
  );
});

