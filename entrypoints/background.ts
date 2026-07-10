import { enqueueStorageOperation } from '../lib/core/storageManager';
import { safeBrowserCall } from '../lib/utils/browserUtils';
import { processLines } from '../lib/lyrics/lyricsProcessor';
import { lyricsCache } from '../lib/lyricsProviders/lyricsCache';
import { lyricsPersistence } from '../lib/lyricsProviders/lyricsPersistence';
import { getLyricsForTrack, getColorOnly } from '../lib/lyricsProviders/lyricsEngine';
import { mxmProvider } from '../lib/lyricsProviders/mxm';
import { hashString } from '../lib/utils/hashUtils';

export default defineBackground(() => {
  // 1. Dynamic TTL Resolution Logic
  function getDynamicTTL(entry: any): number {
    if (!entry) return 0;
    // If failed/missing/placeholder
    if (entry.isPlaceholder || !entry.ok || entry.prefetchState === 'MISSING') {
      return 12 * 60 * 60 * 1000; // 12 hours
    }
    // If unsynced/romanized
    if (entry.prefetchState === 'UNSYNCED' || entry.nativeStatus === 'ROMANIZED' || entry.nativeStatus === 'UNSYNCED') {
      return 24 * 60 * 60 * 1000; // 24 hours
    }
    // Otherwise (Synced / NATIVE_OK)
    return 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  // 2. Lazy Upgrade Queue to avoid API rate limits
  interface UpgradeQueueItem {
    title: string;
    artist: string;
    albumArtUrl: string;
    uri: string;
    cacheKey: string;
    fallbackKey?: string;
    senderTabId?: number;
  }

  const upgradeQueue: UpgradeQueueItem[] = [];
  let isProcessingQueue = false;

  async function processUpgradeQueue() {
    if (isProcessingQueue || upgradeQueue.length === 0) return;
    isProcessingQueue = true;
    
    while (upgradeQueue.length > 0) {
      const item = upgradeQueue.shift();
      if (!item) continue;
      
      console.log(`[sly-upgrade] ⏳ Proactively/lazily upgrading track: "${item.title}" by ${item.artist}`);
      try {
        const fresh = await getLyricsForTrack(item.title, item.artist, item.albumArtUrl, item.uri);
        if (fresh && fresh.ok) {
          const current = lyricsCache.get(item.cacheKey) || await lyricsPersistence.get(item.cacheKey, item.fallbackKey);
          if (current?.nativeStatus && !fresh.nativeStatus) {
            fresh.nativeStatus = current.nativeStatus;
          }
          
          fresh.prefetchState = fresh.data?.isSynced ? 'SYNCED' : 'UNSYNCED';
          await lyricsPersistence.set(item.cacheKey, fresh);
          lyricsCache.set(item.cacheKey, fresh);
          
          console.log(`[sly-upgrade] 🎉 Successful proactive upgrade for "${item.title}" to ${fresh.prefetchState}`);

          // Send message to tab to hot-swap!
          if (item.senderTabId) {
            browser.tabs.sendMessage(item.senderTabId, {
              type: 'LYRICS_UPGRADED',
              payload: { cacheKey: item.cacheKey, data: fresh, uri: item.uri },
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn(`[sly-upgrade] ⚠️ Proactive upgrade failed for "${item.title}":`, err);
      }
      
      // Stand-down between queries to be extremely polite
      await new Promise(r => setTimeout(r, 4000));
    }
    isProcessingQueue = false;
  }

  function enqueueUpgrade(item: UpgradeQueueItem) {
    if (upgradeQueue.some(x => x.cacheKey === item.cacheKey)) return;
    // V18 Fix: Cap queue at 15 to prevent unbounded memory growth.
    // MV3 service workers can be killed after 5min idle, silently losing
    // all pending items. A 15-item cap at 4s each = ~60s drain time.
    if (upgradeQueue.length >= 15) {
      console.warn('[sly-upgrade] Queue full (15). Dropping oldest item:', upgradeQueue[0]?.title);
      upgradeQueue.shift();
    }
    upgradeQueue.push(item);
    processUpgradeQueue();
  }

  browser.runtime.onMessage.addListener(
    (
      msg: {
        type: string;
        // PROCESS fields
        lines?: string[];
        targetLang?: string;
        // FETCH_LYRICS / PREFETCH_LYRICS / SLY_SAVE_L0_CACHE fields
        payload?: { 
          key?: string;
          entry?: any;
          PERSISTED_CACHE_MAX?: number;
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
          nativeStatus?: string;
        };
      },
      sender,
      sendResponse,
    ) => {
      // ----------------------------------------------------------------
      // New handler: Centralized Storage Writes (BUG-A3)
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_SAVE_L0_CACHE') {
        const { key, entry, PERSISTED_CACHE_MAX } = msg.payload ?? {};
        if (!key || !entry) return false;

        enqueueStorageOperation(async () => {
          try {
            const storageKey = `lc:${key}`;
            const d = await safeBrowserCall(() => browser.storage.local.get('lc_index'));
            const idx = (d?.['lc_index'] ?? {}) as Record<string, any>;
            idx[key] = { lastAccessed: Date.now() };

            const keys = Object.keys(idx);
            const max = PERSISTED_CACHE_MAX || 200;
            if (keys.length > max) {
              const sorted = keys.sort((a, b) => (idx[a].lastAccessed ?? 0) - (idx[b].lastAccessed ?? 0));
              const toEvict = sorted.slice(0, keys.length - max);
              for (const k of toEvict) {
                delete idx[k];
                await safeBrowserCall(() => browser.storage.local.remove(`lc:${k}`));
              }
            }

            const setRes = await safeBrowserCall(() => browser.storage.local.set({ [storageKey]: entry, lc_index: idx }));
            if (setRes === null) throw new Error('Storage write failed (quota or context issue)');

            sendResponse({ ok: true });
          } catch (err) {
            console.error('[SKaraoke:BG] SLY_SAVE_L0_CACHE failed:', err);
            sendResponse({ ok: false, error: (err as Error).message });
          }
        });
        return true;
      }

      if (msg.type === 'SLY_DELETE_L0_CACHE') {
        const { key } = msg.payload ?? {};
        if (!key) return false;

        enqueueStorageOperation(async () => {
          try {
            const d = await safeBrowserCall(() => browser.storage.local.get('lc_index'));
            const idx = (d?.['lc_index'] ?? {}) as Record<string, any>;
            delete idx[key];
            const rmRes = await safeBrowserCall(() => browser.storage.local.remove(`lc:${key}`));
            const setRes = await safeBrowserCall(() => browser.storage.local.set({ lc_index: idx }));
            if (rmRes === null || setRes === null) throw new Error('Storage delete failed');

            sendResponse({ ok: true });
          } catch (err) {
            console.error('[SKaraoke:BG] SLY_DELETE_L0_CACHE failed:', err);
            sendResponse({ ok: false, error: (err as Error).message });
          }
        });
        return true;
      }

      if (msg.type === 'SLY_UPDATE_L0_INDEX') {
        const { key } = msg.payload ?? {};
        if (!key) return false;

        enqueueStorageOperation(async () => {
          try {
            const d = await safeBrowserCall(() => browser.storage.local.get('lc_index'));
            const idx = (d?.['lc_index'] ?? {}) as Record<string, any>;
            if (idx[key]) {
              idx[key].lastAccessed = Date.now();
              const setRes = await safeBrowserCall(() => browser.storage.local.set({ lc_index: idx }));
              if (setRes === null) throw new Error('Index update failed');
              sendResponse({ ok: true });
            } else {
              sendResponse({ ok: false, error: 'Key not found in index' });
            }
          } catch (err) {
            sendResponse({ ok: false, error: (err as Error).message });
          }
        });
        return true;
      }

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
        getColorOnly(msg.payload?.albumArtUrl)
          .then(color => {
            sendResponse({ color });
          })
          .catch(err => {
            console.error('[SKaraoke:BG] GET_COLOR failed:', err);
            sendResponse({ color: null });
          });
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: Fetch Spotify CSS to bypass CORS for Deep Scavenger
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_FETCH_CSS') {
        const url = (msg as any).url;
        const isAllowed = typeof url === 'string' && (
          url.startsWith('https://open.spotifycdn.com/') || 
          url.startsWith('https://xpui.static.akamaized.net/')
        );
        if (!isAllowed) {
          sendResponse({ success: false, error: 'Forbidden URL' });
          return true;
        }
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then(text => sendResponse({ success: true, cssText: text }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
      }

      // ----------------------------------------------------------------
      // New handler: fetch missing/unsynced lyrics from YTM + LRCLIB
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_CHECK_CACHE') {
        const { title, artist, uri } = msg.payload ?? {};
        if (!uri && (!title || !artist)) {
          sendResponse({ ok: true, found: false });
          return true;
        }

        // SLY FIX: Proactively notify Musixmatch of this track's metadata.
        // This ensures the interceptor (MAIN world) has the metadata ready 
        // if it needs to perform an upgrade search.
        if (uri && title && artist) {
          const trackId = uri.split(':').pop();
          if (trackId) mxmProvider.notifyMetadata(trackId, title, artist);
        }

        const cacheKey = lyricsCache.getCacheKey(title!, artist!, uri);
        const fallbackKey = uri ? lyricsCache.getCacheKey(title!, artist!) : undefined;
        
        (async () => {
          let stored = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey, fallbackKey);
          if (stored) {
             // Self-heal: If it was tagged ROMANIZED but plain lyrics contain no non-Latin script characters, correct it
             if (stored.nativeStatus === 'ROMANIZED' && stored.data?.plainLyrics) {
                 const hasNonLatin = /[\u0900-\u0DFF\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u08FF\u0E00-\u0E7F]/.test(stored.data.plainLyrics);
                 if (!hasNonLatin) {
                     console.log(`[sly-sw] 🩹 Self-healing stale ROMANIZED tag on cache check: "${title}" by ${artist}`);
                     stored.nativeStatus = 'NATIVE_OK' as any;
                     lyricsCache.set(cacheKey, stored);
                     await lyricsPersistence.set(cacheKey, stored);
                 }
             }
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
        const { title, artist, albumArtUrl, uri, forceRefresh, nativeStatus } = msg.payload ?? {} as NonNullable<typeof msg.payload>;

        if (!title || !artist) {
          console.error(`[ServiceWorker] ❌ REJECTED: Missing metadata for fetch. Title: "${title}", Artist: "${artist}", URI: ${uri}`);
          sendResponse({ ok: false, error: 'Missing metadata' });
          return true;
        }

        const cacheKey = lyricsCache.getCacheKey(title, artist, uri);

        (async () => {
          // 1. L1: Instant Memory Cache Hit
          if (lyricsCache.has(cacheKey) && !forceRefresh) {
            const cached = lyricsCache.get(cacheKey);
            if (cached && !(cached as any).isPlaceholder) {
              const age = Date.now() - (cached.persistedAt || 0);
              const ttl = getDynamicTTL(cached);
              if (age > ttl) {
                console.log(`[ServiceWorker] L1 EXPIRED (Dynamic TTL: ${ttl / 3600000}h): ${title}`);
                // Fall through to L2/Fetch path
              } else {
                console.log(`[ServiceWorker] L1 HIT: ${title} - ${artist}`);
                sendResponse(cached);
                return;
              }
            }
          }

          // 2. L2: Persistent Storage Hit
          const fallbackKey = uri ? lyricsCache.getCacheKey(title, artist) : undefined;
          let stored = forceRefresh ? null : await lyricsPersistence.get(cacheKey, fallbackKey);
          if (stored && !(stored as any).isPlaceholder) {
            // Self-heal: If it was tagged ROMANIZED but plain lyrics contain no non-Latin script characters, correct it
            if (stored.nativeStatus === 'ROMANIZED' && stored.data?.plainLyrics) {
                const hasNonLatin = /[\u0900-\u0DFF\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u08FF\u0E00-\u0E7F]/.test(stored.data.plainLyrics);
                if (!hasNonLatin) {
                    console.log(`[sly-sw] 🩹 Self-healing stale ROMANIZED tag on L2 hit: "${title}" by ${artist}`);
                    stored.nativeStatus = 'NATIVE_OK' as any;
                    lyricsCache.set(cacheKey, stored);
                    await lyricsPersistence.set(cacheKey, stored);
                }
            }

            const age = Date.now() - (stored.persistedAt || 0);
            const ttl = getDynamicTTL(stored);
            
            if (age > ttl) {
              console.log(`[ServiceWorker] L2 EXPIRED (Dynamic TTL: ${ttl / 3600000}h): ${title} — triggering background refresh.`);
              // If L2 is expired, we do NOT return the stale hit. We fall through to network fetch!
            } else {
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
              
              // SLY FIX: Look ahead for a processed cache entry (lc: prefix) 
              // to eliminate the "shimmer" where original lyrics appear before romanized ones.
              // STALE DATA GUARD: Only merge if the hash of the stored original lines
              // matches the plainLyrics of the current fetch result. This prevents
              // Unsynced romanization from being applied to Synced LRC lines (index shift).
              if (uri && stored.ok && stored.data?.plainLyrics && !stored.processed) {
                const lcKey = `lc:${uri}`;
                const lcResult = await safeBrowserCall(() => browser.storage.local.get([lcKey]));
                const lcEntry = lcResult?.[lcKey];
                
                if (lcEntry?.processed && lcEntry.originalHash) {
                  // Compute hash of current plainLyrics to compare
                  const currentPlain = stored.data.plainLyrics;
                  const currentHash = hashString(currentPlain.split('\n').join('|'));
                  
                  if (lcEntry.originalHash === currentHash) {
                    console.log(`[ServiceWorker] L2 PROCESSED HIT: Merging verified romanization for ${title}`);
                    stored.processed = lcEntry.processed;
                  } else {
                    console.warn(`[ServiceWorker] L2 PROCESSED IGNORED: Hash mismatch for ${title} (Source lyrics changed).`);
                  }
                }
              }

              sendResponse(stored);

              // --- UPGRADE LOGIC (Lazy Upgrade Queue) ---
              const needsUpgrade = (!stored.ok && !stored.isPlaceholder) || (stored.data && stored.data.isSynced === false);
              const lastCheck = stored.lastCheckedAt || 0;
              const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
              const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
              const retryThreshold = !stored.ok ? dayAgo : weekAgo;
   
              if (needsUpgrade && lastCheck < retryThreshold) {
                enqueueUpgrade({
                  title,
                  artist,
                  albumArtUrl: albumArtUrl || '',
                  uri: uri || '',
                  cacheKey,
                  fallbackKey,
                  senderTabId: sender.tab?.id
                });
              }
              return;
            }
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
                result.nativeStatus = result.nativeStatus || existing?.nativeStatus || nativeStatus;
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
        if (!title || !artist || !status) return false;

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
          // V6 Fix: Always send a response. Previously, if existing.nativeStatus === status,
          // neither branch ran and sendResponse was never called, causing
          // "message port closed" warnings and potential Firefox hangs.
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

      // ----------------------------------------------------------------
      // NEW: Stable Firefox Navigation Handler (with Safety Bounce)
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_MARK_ENTRY_POINT') {
        if (sender.tab?.id) {
          const tabId = sender.tab.id;
          browser.storage.local.get('slyEntryPoints').then((res) => {
            const entryPoints = new Set(res.slyEntryPoints || []);
            entryPoints.add(tabId);
            browser.storage.local.set({ slyEntryPoints: Array.from(entryPoints) });
          });
        }
        return false;
      }

      if (msg.type === 'SLY_NAV_BACK') {
        if (sender.tab?.id) {
          const tabId = sender.tab.id;
          browser.storage.local.get('slyEntryPoints').then(async (res) => {
            const entryPoints = new Set(res.slyEntryPoints || []);
            const isEntryPoint = (msg as any).isEntryPoint || entryPoints.has(tabId);
            
            if (isEntryPoint) {
              console.log('[sly-bg] Safety Bounce: Tab is entry point. Redirecting to Spotify Home.');
              browser.tabs.update(tabId, { url: 'https://open.spotify.com/' }).catch(() => {});
              entryPoints.delete(tabId);
              await browser.storage.local.set({ slyEntryPoints: Array.from(entryPoints) });
            } else {
              console.log('[sly-bg] Requesting tabs.goBack for non-entry-point navigation.');
              browser.tabs.goBack(tabId).catch((err) => {
                console.warn('[sly-bg] tabs.goBack failed, falling back to Home:', err.message);
                browser.tabs.update(tabId, { url: 'https://open.spotify.com/' }).catch(() => {});
              });
            }
          });
        }
        return false;
      }
    },
  );
});

