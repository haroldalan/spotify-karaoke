import { enqueueStorageOperation } from '../lib/core/storageManager';
import { safeBrowserCall } from '../lib/utils/browserUtils';
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
            }
            sendResponse({ ok: true });
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
        const fallbackKey = uri ? lyricsCache.getCacheKey(title!, artist!) : undefined;
        
        (async () => {
          const stored = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey, fallbackKey);
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
              const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
              if (age > THIRTY_DAYS) {
                console.log(`[ServiceWorker] L1 EXPIRED (TTL): ${title}`);
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
          const stored = forceRefresh ? null : await lyricsPersistence.get(cacheKey, fallbackKey);
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
            
            // SLY FIX: Look ahead for a processed cache entry (lc: prefix) 
            // to eliminate the "shimmer" where original lyrics appear before romanized ones.
            if (uri) {
              const lcKey = `lc:${uri}`;
              const lcResult = await safeBrowserCall(() => browser.storage.local.get([lcKey]));
              const lcEntry = lcResult?.[lcKey];
              if (lcEntry?.processed) {
                console.log(`[ServiceWorker] L2 PROCESSED HIT: Merging romanization/translation for ${title}`);
                stored.processed = lcEntry.processed;
              }
            }

            sendResponse(stored);

            // --- UPGRADE LOGIC ---
            const needsUpgrade = (!stored.ok && !stored.isPlaceholder) || (stored.data && stored.data.isSynced === false);
            const lastCheck = stored.lastCheckedAt || 0;
            const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
            const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const retryThreshold = !stored.ok ? dayAgo : weekAgo;
 
            if (needsUpgrade && lastCheck < retryThreshold) {
              console.log(`[ServiceWorker] Upgrade Check for ${title}`);
              getLyricsForTrack(title, artist, albumArtUrl, uri).then(async (fresh) => {
                if (fresh && fresh.ok && (fresh.data?.isSynced || !stored.ok)) {
                  // BUG-C3 Fix: Re-fetch current state to avoid overwriting late-arriving nativeStatus
                  const current = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey, fallbackKey);
                  if (current?.nativeStatus && !fresh.nativeStatus) {
                    fresh.nativeStatus = current.nativeStatus;
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
          (globalThis as any).slyEntryPoints = (globalThis as any).slyEntryPoints || new Set();
          (globalThis as any).slyEntryPoints.add(sender.tab.id);
        }
        return false;
      }

      if (msg.type === 'SLY_NAV_BACK') {
        if (sender.tab?.id) {
          const isEntryPoint = (msg as any).isEntryPoint || (globalThis as any).slyEntryPoints?.has(sender.tab.id);
          
          if (isEntryPoint) {
            console.log('[sly-bg] Safety Bounce: Tab is entry point. Redirecting to Spotify Home.');
            browser.tabs.update(sender.tab.id, { url: 'https://open.spotify.com/' }).catch(() => {});
            (globalThis as any).slyEntryPoints?.delete(sender.tab.id);
          } else {
            console.log('[sly-bg] Requesting tabs.goBack for non-entry-point navigation.');
            browser.tabs.goBack(sender.tab.id).catch((err) => {
              console.warn('[sly-bg] tabs.goBack failed, falling back to Home:', err.message);
              browser.tabs.update(sender.tab.id!, { url: 'https://open.spotify.com/' }).catch(() => {});
            });
          }
        }
        return false;
      }
    },
  );
});

