import { processLines } from '../lib/lyrics/lyricsProcessor';
import { lyricsCache } from '../lib/lyricsProviders/lyricsCache';
import { lyricsPersistence } from '../lib/lyricsProviders/lyricsPersistence';
import { getLyricsForTrack, getColorOnly } from '../lib/lyricsProviders/lyricsEngine';

/**
 * Silent Background Upgrade Logic (Refactored for JJ-SS)
 */
async function triggerUpgradeCheck(stored: any, cacheKey: string, title: string, artist: string, albumArtUrl: string, uri: string) {
  // BUG-QQ FIX: Treat undefined/null isSynced as unsynced
  const needsUpgrade = !stored.ok || (stored.data && stored.data.isSynced !== true);
  const lastCheck = stored.lastCheckedAt || 0;
  const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  if (!needsUpgrade || lastCheck >= weekAgo) return;

  console.log(`[ServiceWorker] 💡 Upgrade Check triggered for ${stored.ok ? 'unsynced' : 'missing'} track: ${title}`);
  
  try {
    const fresh = await getLyricsForTrack(title, artist, albumArtUrl, uri);
    if (fresh && fresh.ok && (fresh.data?.isSynced || !stored.ok)) {
      console.log(`[ServiceWorker] ✨ UPGRADE SUCCESS: Found ${fresh.data?.isSynced ? 'synced' : 'new'} lyrics for ${title}`);
      
      // SLY FIX: Smart Merge (BUG-GG, SS). Preserve nativeStatus and extractedColor.
      if (stored.nativeStatus && !fresh.nativeStatus) {
        fresh.nativeStatus = stored.nativeStatus;
      }
      if (stored.data?.extractedColor && !fresh.data?.extractedColor) {
        if (!fresh.data) fresh.data = {} as any;
        fresh.data.extractedColor = stored.data.extractedColor;
      }

      fresh.lastCheckedAt = Date.now();
      await lyricsPersistence.set(cacheKey, fresh);
      lyricsCache.set(cacheKey, fresh);

      // BUG-GGG FIX: Only broadcast if lyrics actually improved (Missing -> Any OR Unsynced -> Synced)
      const improved = (!stored.ok && fresh.ok) || (stored.data?.isSynced === false && fresh.data?.isSynced === true);
      
      if (improved) {
        // SLY FIX (Bug 10 / PP / MMM): Broadcast to ALL Spotify tabs with explicit URI
        browser.tabs.query({ url: '*://open.spotify.com/*' }).then(tabs => {
          tabs.forEach(tab => {
            if (tab.id) {
              browser.tabs.sendMessage(tab.id, {
                type: 'LYRICS_UPGRADED',
                payload: { cacheKey, uri, data: fresh },
              }).catch(() => {});
            }
          });
        });
      }
    } else {
      console.log(`[ServiceWorker] 😴 Upgrade Check: No synced version found for ${title}. Sleeping for 7 days.`);
      stored.lastCheckedAt = Date.now();
      await lyricsPersistence.set(cacheKey, stored);
      lyricsCache.set(cacheKey, stored);
    }
  } catch (err) {
    console.error('[ServiceWorker] Upgrade check failed:', err);
    stored.lastCheckedAt = Date.now();
    try {
      await lyricsPersistence.set(cacheKey, stored);
      lyricsCache.set(cacheKey, stored);
    } catch (e) {}
  }
}

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

            // BUG-XX FIX: Even if 'existing' is null (first play), create a placeholder 
            // so the color is persisted and we don't re-extract every session.
            const target = existing || { ok: true, data: {} as any, isPlaceholder: true };
            if (color && target) {
              if (!target.data) target.data = {} as any;
              
              // BUG-YY FIX: Smart merge to avoid clobbering in-flight sync data
              const freshFromDisk = await lyricsPersistence.get(cacheKey);
              const mergeBase = freshFromDisk || target;
              
              if (!mergeBase.data) mergeBase.data = {} as any;
              mergeBase.data.extractedColor = color;
              
              try {
                await lyricsPersistence.set(cacheKey, mergeBase);
                lyricsCache.set(cacheKey, mergeBase);
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

      // BUG-ZZ FIX: Persistence for native Spotify colors
      if (msg.type === 'SLY_SAVE_THEME') {
        const { title, artist, uri, theme } = msg.payload ?? {};
        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);
        (async () => {
          const existing = await lyricsPersistence.get(cacheKey) || { ok: true, data: {} as any, isPlaceholder: true };
          existing.savedTheme = theme;
          await lyricsPersistence.set(cacheKey, existing);
          lyricsCache.set(cacheKey, existing);
          console.log(`[SKaraoke:BG] 🎨 Saved native theme for ${title}`);
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
              if (msg.type === 'FETCH_LYRICS') triggerUpgradeCheck(stored, cacheKey, title, artist, albumArtUrl, uri);
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
            try {
              const finalResult = await fetchTask;
              sendResponse(finalResult);
              if (finalResult && msg.type === 'FETCH_LYRICS') triggerUpgradeCheck(finalResult, cacheKey, title, artist, albumArtUrl, uri);
            } finally {
              lyricsCache.deleteInFlight(cacheKey);
            }
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
              delete (existing as any).isPlaceholder;
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

