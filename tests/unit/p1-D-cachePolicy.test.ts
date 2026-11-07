import { describe, it, expect } from 'vitest';
import {
  LyricsCache,
  getDynamicTTL,
  getCacheExpiry,
  hasGoodLyrics,
  isCacheEntryExpired,
  isUsableCacheEntry,
  keepAfterFailedRefresh,
  TTL_FAILED_MS,
  TTL_UNSYNCED_MS,
  TTL_SYNCED_MS,
  FAILED_REFRESH_RETRY_MS,
} from '../../lib/lyricsProviders/lyricsCache';
import type { FetchedLyricsResult } from '../../lib/lyricsProviders/lyricsCache';

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const synced = (age: number, extra: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult => ({
  ok: true,
  prefetchState: 'SYNCED',
  data: { syncedLyrics: '[00:01.00]test line', isSynced: true, source: 'LRCLIB' },
  persistedAt: NOW - age,
  ...extra,
});
const unsynced = (age: number, extra: Partial<FetchedLyricsResult> = {}): FetchedLyricsResult => ({
  ok: true,
  prefetchState: 'UNSYNCED',
  data: { plainLyrics: 'test line', isSynced: false },
  persistedAt: NOW - age,
  ...extra,
});
const failed = (age: number): FetchedLyricsResult => ({
  ok: false,
  prefetchState: 'MISSING',
  data: { isSynced: false },
  persistedAt: NOW - age,
});

describe('getDynamicTTL — from the fetched data, not the native status', () => {
  it('gives synced 30d, unsynced 24h, failures/placeholders 12h', () => {
    expect(getDynamicTTL(synced(0))).toBe(TTL_SYNCED_MS);
    expect(getDynamicTTL(unsynced(0))).toBe(TTL_UNSYNCED_MS);
    expect(getDynamicTTL(failed(0))).toBe(TTL_FAILED_MS);
    expect(getDynamicTTL({ ok: false, isPlaceholder: true, nativeStatus: 'SYNCED' })).toBe(TTL_FAILED_MS);
  });

  it('keeps a synced result for 30d even when Spotify reports UNSYNCED/ROMANIZED natively', () => {
    expect(getDynamicTTL(synced(0, { nativeStatus: 'UNSYNCED' }))).toBe(TTL_SYNCED_MS);
    expect(getDynamicTTL(synced(0, { nativeStatus: 'ROMANIZED' }))).toBe(TTL_SYNCED_MS);
  });
});

describe('isUsableCacheEntry — SLY_CHECK_CACHE hit rule (K8)', () => {
  it('rejects placeholders', () => {
    expect(isUsableCacheEntry({ ok: false, prefetchState: 'MISSING', nativeStatus: 'MISSING', isPlaceholder: true, persistedAt: NOW }, NOW)).toBe(false);
    expect(isUsableCacheEntry(synced(0, { isPlaceholder: true }), NOW)).toBe(false);
  });

  it('rejects failures, fresh or expired', () => {
    expect(isUsableCacheEntry(failed(HOUR), NOW)).toBe(false);
    expect(isUsableCacheEntry(failed(13 * HOUR), NOW)).toBe(false);
  });

  it('rejects entries past their TTL', () => {
    expect(isUsableCacheEntry(unsynced(25 * HOUR), NOW)).toBe(false);
    expect(isUsableCacheEntry(synced(31 * 24 * HOUR), NOW)).toBe(false);
  });

  it('accepts good entries within their TTL', () => {
    expect(isUsableCacheEntry(unsynced(23 * HOUR), NOW)).toBe(true);
    expect(isUsableCacheEntry(synced(29 * 24 * HOUR, { nativeStatus: 'UNSYNCED' }), NOW)).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(isUsableCacheEntry(null, NOW)).toBe(false);
    expect(isUsableCacheEntry(undefined, NOW)).toBe(false);
  });

  it('never treats retryAt as making a failure or placeholder usable', () => {
    expect(isUsableCacheEntry({ ...failed(HOUR), retryAt: NOW + HOUR }, NOW)).toBe(false);
    expect(isUsableCacheEntry({ ...synced(0), isPlaceholder: true, retryAt: NOW + HOUR }, NOW)).toBe(false);
  });
});

describe('getCacheExpiry / isCacheEntryExpired', () => {
  it('is persistedAt + dynamic TTL without a retry time', () => {
    expect(getCacheExpiry(synced(0))).toBe(NOW + TTL_SYNCED_MS);
    expect(getCacheExpiry(unsynced(0))).toBe(NOW + TTL_UNSYNCED_MS);
    expect(isCacheEntryExpired(synced(TTL_SYNCED_MS), NOW)).toBe(false);
    expect(isCacheEntryExpired(synced(TTL_SYNCED_MS + 1), NOW)).toBe(true);
  });

  it('an earlier retryAt never shortens a fresh entry', () => {
    expect(getCacheExpiry(synced(0, { retryAt: NOW - HOUR }))).toBe(NOW + TTL_SYNCED_MS);
  });
});

describe('keepAfterFailedRefresh — a failed re-fetch never replaces good lyrics', () => {
  it('keeps the data and makes the entry usable again for the retry window only', () => {
    const prev = unsynced(30 * HOUR); // expired
    expect(hasGoodLyrics(prev)).toBe(true);
    const kept = keepAfterFailedRefresh(prev, NOW);

    expect(kept.data).toEqual(prev.data);
    expect(kept.ok).toBe(true);
    expect(isUsableCacheEntry(kept, NOW)).toBe(true);
    expect(isUsableCacheEntry(kept, NOW + FAILED_REFRESH_RETRY_MS + 1)).toBe(false);
  });

  it('does not shorten an entry that was still fresh (forced retry)', () => {
    const prev = synced(HOUR);
    const kept = keepAfterFailedRefresh(prev, NOW);
    expect(kept.persistedAt).toBe(prev.persistedAt);
    expect(getCacheExpiry(kept)).toBe(getCacheExpiry(prev));
    expect(isUsableCacheEntry(kept, NOW + 29 * 24 * HOUR)).toBe(true);
  });

  it('keeps an expired SYNCED entry without back-dating persistedAt', () => {
    const prev = synced(31 * 24 * HOUR); // past the 30d synced TTL
    expect(isCacheEntryExpired(prev, NOW)).toBe(true);
    const kept = keepAfterFailedRefresh(prev, NOW);

    // persistedAt is the real fetch time; the retry time lives in retryAt.
    expect(kept.persistedAt).toBe(prev.persistedAt);
    expect(kept.retryAt).toBe(NOW + FAILED_REFRESH_RETRY_MS);
    expect(kept.lastCheckedAt).toBe(NOW);
    expect(isUsableCacheEntry(kept, NOW + FAILED_REFRESH_RETRY_MS)).toBe(true);
    expect(isCacheEntryExpired(kept, NOW + 2 * HOUR)).toBe(true);

    // A second failed retry 2h later pushes the retry time again.
    const keptAgain = keepAfterFailedRefresh(kept, NOW + 2 * HOUR);
    expect(keptAgain.persistedAt).toBe(prev.persistedAt);
    expect(keptAgain.retryAt).toBe(NOW + 2 * HOUR + FAILED_REFRESH_RETRY_MS);
    expect(isUsableCacheEntry(keptAgain, NOW + 2 * HOUR + 1)).toBe(true);
  });

  it('does not treat failures or placeholders as good lyrics', () => {
    expect(hasGoodLyrics(failed(0))).toBe(false);
    expect(hasGoodLyrics({ ok: false, isPlaceholder: true })).toBe(false);
    expect(hasGoodLyrics(null)).toBe(false);
  });
});

describe('LyricsCache.clear (K7)', () => {
  it('drops L1 entries and in-flight fetches', async () => {
    const cache = new LyricsCache(5);
    cache.set('spotify:track:test1', synced(0));
    let resolve!: (v: FetchedLyricsResult) => void;
    const pending = new Promise<FetchedLyricsResult>((r) => { resolve = r; });
    cache.setInFlight('spotify:track:test2', pending);

    cache.clear();

    expect(cache.has('spotify:track:test1')).toBe(false);
    expect(cache.getInFlight('spotify:track:test2')).toBeUndefined();

    // A newer in-flight fetch for the same key survives the old promise settling.
    const newer = new Promise<FetchedLyricsResult>(() => {});
    cache.setInFlight('spotify:track:test2', newer);
    resolve(failed(0));
    await pending;
    await Promise.resolve();
    expect(cache.getInFlight('spotify:track:test2')).toBe(newer);
  });
});
