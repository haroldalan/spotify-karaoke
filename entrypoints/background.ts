import { enqueueStorageOperation } from '../lib/core/storageManager';
import { safeBrowserCall } from '../lib/utils/browserUtils';
import { processLines } from '../lib/lyrics/lyricsProcessor';
import {
  lyricsCache,
  getDynamicTTL,
  hasGoodLyrics,
  isCacheEntryExpired,
  isUsableCacheEntry,
  keepAfterFailedRefresh,
} from '../lib/lyricsProviders/lyricsCache';
import type { NativeStatus } from '../lib/lyricsProviders/lyricsCache';
import { lyricsPersistence } from '../lib/lyricsProviders/lyricsPersistence';
import { getLyricsForTrack, getColorOnly, clearColorCache } from '../lib/lyricsProviders/lyricsEngine';
import { nativeLyricsProvider, LEGACY_MUSIXMATCH_KEYS } from '../lib/lyricsProviders/nativeLyrics';
import { lrcLooksRomanized } from '../lib/lyricsProviders/lrclibNative';
import { hashString } from '../lib/utils/hashUtils';
import { TEST_HOOKS_ENABLED, handleTestHook } from '../lib/testHooks';

export default defineBackground(() => {
  // 0. Musixmatch was removed (2026-11): drop what its client left in storage.
  browser.runtime.onInstalled?.addListener(({ reason }: { reason: string }) => {
    if (reason === 'update') void browser.storage.local.remove(LEGACY_MUSIXMATCH_KEYS).catch(() => {});
  });

  // 1. Dynamic TTL Resolution Logic: getDynamicTTL (lib/lyricsProviders/lyricsCache.ts)
  //    derives the TTL from the fetched data (synced 30d / unsynced 24h / failure 12h).

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
          fresh.persistedAt = Date.now();
          await lyricsPersistence.set(item.cacheKey, fresh);
          lyricsCache.set(item.cacheKey, fresh);
          reportedNativeStatus.delete(item.cacheKey);

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

  // Last native status recorded per cache key (C8/C3). The content script repeats
  // SLY_REPORT_NATIVE_STATUS every poll tick, so an unchanged status is answered
  // from memory before any storage read or write. Dropped for a key whenever its
  // lyrics entry is rewritten elsewhere, and cleared on the K7 reset.
  const NATIVE_STATUS_MEMO_MAX = 1000;
  const reportedNativeStatus = new Map<string, NativeStatus>();
  function rememberNativeStatus(key: string, status: NativeStatus) {
    reportedNativeStatus.delete(key);
    reportedNativeStatus.set(key, status);
    if (reportedNativeStatus.size > NATIVE_STATUS_MEMO_MAX) {
      const oldest = reportedNativeStatus.keys().next().value;
      if (oldest !== undefined) reportedNativeStatus.delete(oldest);
    }
  }

  // 3. Popup "Reset Data" (contract K7): the popup writes sly_cacheResetAt after
  //    removing the persisted caches; drop everything held in memory here too.
  browser.storage?.onChanged?.addListener((changes: Record<string, unknown>, areaName: string) => {
    if (areaName !== 'local' || !changes?.sly_cacheResetAt) return;
    console.log('[SKaraoke:BG] Cache reset requested: clearing L1 lyrics, in-flight fetches and colours.');
    lyricsCache.clear();
    clearColorCache();
    reportedNativeStatus.clear();
    nativeLyricsProvider.resetMemory();
    upgradeQueue.length = 0;
  });

  browser.runtime.onMessage.addListener(
    (
      msg: {
        type: string;
        // PROCESS fields
        lines?: string[];
        targetLang?: string;
        sourceLang?: string | null;
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
          // Native-script lookup fields (SLY_NATIVE_*)
          trackId?: string;
          providerLyricsId?: string | null;
          hexGid?: string;
          interceptId?: number;
          name?: string;
          durationMs?: number;
          spotifyWordLines?: number;
          status?: string;
          nativeStatus?: string;
        };
      },
      sender: any,
      sendResponse: (response?: any) => void,
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
      // Debug builds only: simulated outages for live testing (lib/testHooks.ts).
      if (TEST_HOOKS_ENABLED && (msg.type as string) === 'SLY_TEST_HOOK') {
        handleTestHook((msg as { payload?: Record<string, unknown> }).payload).then(sendResponse);
        return true;
      }

      if (msg.type === 'PROCESS') {
        // sourceLang is Spotify's language tag: only a hint (contract K1).
        processLines(msg.lines ?? [], msg.targetLang ?? 'en', msg.sourceLang ?? null)
          .then((res) => sendResponse(res ?? null))
          .catch((err) => {
            console.error('[SKaraoke:BG] PROCESS failed:', err);
            // Total failure: null. Never echo the originals back as a "translation".
            sendResponse(null);
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

        // Gives the native-script lookup this track's metadata early, in case it
        // needs to search for the lyrics in the original script.
        // Only when the page bridge has not named the track yet: the bridge pairs id and
        // title from one source, while a cache check can carry a title read a moment too
        // early (live 2026-11-08: the previous song's title overwrote the new id's).
        if (uri && title && artist) {
          const trackId = uri.split(':').pop();
          if (trackId) nativeLyricsProvider.notifyMetadata(trackId, title, artist, undefined, { ifUnknown: true });
        }

        const cacheKey = lyricsCache.getCacheKey(title!, artist!, uri);
        const fallbackKey = uri ? lyricsCache.getCacheKey(title!, artist!) : undefined;
        
        (async () => {
          let stored = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey, fallbackKey);
          if (stored && !stored.isPlaceholder) {
             // Self-heal: If it was tagged ROMANIZED but plain lyrics contain no non-Latin script characters, correct it
             if (stored.nativeStatus === 'ROMANIZED' && stored.data?.plainLyrics) {
                 const hasNonLatin = /[\u0900-\u0DFF\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u08FF\u0E00-\u0E7F]/.test(stored.data.plainLyrics);
                 if (!hasNonLatin) {
                     console.log(`[sly-sw] 🩹 Self-healing stale ROMANIZED tag on cache check: "${title}" by ${artist}`);
                     stored.nativeStatus = 'NATIVE_OK' as any;
                     lyricsCache.set(cacheKey, stored);
                     await lyricsPersistence.set(cacheKey, stored);
                     reportedNativeStatus.delete(cacheKey);
                 }
             }
          }
          // Contract K8: only a usable entry (not a placeholder, ok, within its
          // dynamic TTL) is a hit. Failures and expired entries are left to
          // FETCH_LYRICS, which serves fresh failures quickly and retries stale ones.
          if (stored && isUsableCacheEntry(stored)) {
             console.log(`[sly-sw] Cache check for ${title}: Found. Native=${stored.nativeStatus || 'N/A'}, Custom=${stored.prefetchState || 'N/A'}`);
             sendResponse({ ...stored, ok: true, found: true });
          } else {
             // A real entry carries its own status; for legacy placeholders the
             // separate native-status map is newer.
             const nativeStatus = (stored && !stored.isPlaceholder ? stored.nativeStatus : undefined)
               ?? (await lyricsPersistence.getNativeStatus(cacheKey))
               ?? stored?.nativeStatus;
             console.log(`[sly-sw] Cache check for ${title}: Not found${stored ? ' (unusable entry)' : ''}. Native=${nativeStatus || 'N/A'}`);
             sendResponse(nativeStatus ? { ok: true, found: false, nativeStatus } : { ok: true, found: false });
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
              if (isCacheEntryExpired(cached)) {
                console.log(`[ServiceWorker] L1 EXPIRED (Dynamic TTL: ${getDynamicTTL(cached) / 3600000}h): ${title}`);
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
          if (stored && !stored.isPlaceholder) {
            // Self-heal: If it was tagged ROMANIZED but plain lyrics contain no non-Latin script characters, correct it
            if (stored.nativeStatus === 'ROMANIZED' && stored.data?.plainLyrics) {
                const hasNonLatin = /[\u0900-\u0DFF\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u08FF\u0E00-\u0E7F]/.test(stored.data.plainLyrics);
                if (!hasNonLatin) {
                    console.log(`[sly-sw] 🩹 Self-healing stale ROMANIZED tag on L2 hit: "${title}" by ${artist}`);
                    stored.nativeStatus = 'NATIVE_OK' as any;
                    lyricsCache.set(cacheKey, stored);
                    await lyricsPersistence.set(cacheKey, stored);
                    reportedNativeStatus.delete(cacheKey);
                }
            }

            if (isCacheEntryExpired(stored)) {
              console.log(`[ServiceWorker] L2 EXPIRED (Dynamic TTL: ${getDynamicTTL(stored) / 3600000}h): ${title} — re-fetching (kept if the re-fetch fails).`);
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
              // Romanized synced lyrics saved before native-script copies were looked for: once.
              const needsNativeCheck = !!stored.ok && stored.data?.isSynced === true && !stored.data.nativeChecked
                && lrcLooksRomanized(stored.data.syncedLyrics);

              if (needsNativeCheck || (needsUpgrade && lastCheck < retryThreshold)) {
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
                const existing = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey, fallbackKey);

                // A failed re-fetch (expired TTL, forced retry, provider outage) must
                // never overwrite good lyrics: keep them and retry later.
                if (!result.ok && hasGoodLyrics(existing)) {
                  console.warn(`[ServiceWorker] Re-fetch failed for ${title}; keeping previously cached lyrics.`);
                  const kept = keepAfterFailedRefresh(existing);
                  lyricsCache.set(cacheKey, kept);
                  await lyricsPersistence.set(cacheKey, kept);
                  reportedNativeStatus.delete(cacheKey);
                  return kept;
                }

                result.nativeStatus = result.nativeStatus
                  || (existing && !existing.isPlaceholder ? existing.nativeStatus : undefined)
                  || (await lyricsPersistence.getNativeStatus(cacheKey))
                  || existing?.nativeStatus
                  || (nativeStatus as NativeStatus | undefined);
                // Stamp before caching so the L1 TTL check sees the real age.
                result.persistedAt = Date.now();
                lyricsCache.set(cacheKey, result);
                await lyricsPersistence.set(cacheKey, result);
                reportedNativeStatus.delete(cacheKey);
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
        // C8/C3: an unchanged status needs no storage read or write.
        if (reportedNativeStatus.get(cacheKey) === status) {
          sendResponse({ ok: true });
          return true;
        }
        // Remember it before the async work so concurrent repeats are skipped too;
        // a lyrics write for this key meanwhile drops the memo again.
        rememberNativeStatus(cacheKey, status as NativeStatus);
        (async () => {
          const existing = lyricsCache.get(cacheKey) || await lyricsPersistence.get(cacheKey);
          
          if (!existing || existing.isPlaceholder) {
            // No fetched lyrics for this track: record the status in the separate,
            // capped native-status map. Placeholders must not occupy (and evict
            // real entries from) the 200-entry lyrics LRU.
            await lyricsPersistence.setNativeStatus(cacheKey, status as NativeStatus);
          } else if (existing.nativeStatus !== status) {
            existing.nativeStatus = status as NativeStatus;
            lyricsCache.set(cacheKey, existing);
            await lyricsPersistence.set(cacheKey, existing);
          }
          // V6 Fix: Always send a response. Previously, if existing.nativeStatus === status,
          // neither branch ran and sendResponse was never called, causing
          // "message port closed" warnings and potential Firefox hangs.
          sendResponse({ ok: true });
        })().catch((e) => {
          if (reportedNativeStatus.get(cacheKey) === status) reportedNativeStatus.delete(cacheKey);
          console.warn('[SKaraoke:BG] Native status report failed:', e);
          sendResponse({ ok: false });
        });
        return true;
      }

      // ----------------------------------------------------------------
      // Native-script lookup (lib/lyricsProviders/nativeLyrics.ts)
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_NATIVE_NOTIFY_METADATA') {
        const { trackId, name, artist, durationMs } = msg.payload ?? {};
        if (trackId && name && artist) {
          nativeLyricsProvider.notifyMetadata(trackId, name, artist, typeof durationMs === 'number' ? durationMs : undefined);
        }
        return false;
      }

      if (msg.type === 'SLY_NATIVE_NEW_INTERCEPTION') {
        const { trackId } = msg.payload ?? {};
        // Always answer: without a trackId the caller gets generation 0 (its own
        // timeout fallback) at once instead of waiting 15 s for nothing.
        sendResponse({ generation: trackId ? nativeLyricsProvider.newInterception(trackId) : 0 });
        return true;
      }

      if (msg.type === 'SLY_NATIVE_FETCH') {
        const { trackId, hexGid, interceptId, spotifyWordLines } = msg.payload ?? {};
        // Promise.resolve().then also turns a synchronous throw into the catch below.
        Promise.resolve().then(() => nativeLyricsProvider.fetchNativeLines(
          trackId ?? '',
          hexGid ?? '',
          interceptId ?? 0,
          typeof spotifyWordLines === 'number' ? spotifyWordLines : undefined,
        )).then(lines => {
          sendResponse({ ok: !!lines, lines });
        }).catch((err: unknown) => {
          const name = (err as Error | undefined)?.name ?? typeof err;
          const message = (err as Error | undefined)?.message ?? String(err);
          console.error(`[SKaraoke:BG] Native-script lookup threw: ${name}: ${message}`);
          sendResponse({ ok: false, error: message });
        });
        return true;
      }

      // ----------------------------------------------------------------
      // NEW: Stable Firefox Navigation Handler (with Safety Bounce)
      // ----------------------------------------------------------------
      if (msg.type === 'SLY_MARK_ENTRY_POINT') {
        if (sender.tab?.id) {
          const tabId = sender.tab.id;
          browser.storage.local.get('slyEntryPoints').then((res: any) => {
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
          browser.storage.local.get('slyEntryPoints').then(async (res: any) => {
            const entryPoints = new Set(res.slyEntryPoints || []);
            const isEntryPoint = (msg as any).isEntryPoint || entryPoints.has(tabId);
            
            if (isEntryPoint) {
              console.log('[sly-bg] Safety Bounce: Tab is entry point. Redirecting to Spotify Home.');
              browser.tabs.update(tabId, { url: 'https://open.spotify.com/' }).catch(() => {});
              entryPoints.delete(tabId);
              await browser.storage.local.set({ slyEntryPoints: Array.from(entryPoints) });
            } else {
              console.log('[sly-bg] Requesting tabs.goBack for non-entry-point navigation.');
              browser.tabs.goBack(tabId).catch((err: any) => {
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

