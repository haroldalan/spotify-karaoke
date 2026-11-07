import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/core/lyricsCache', () => ({
  saveSongCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/dom/toast', () => ({
  showToast: vi.fn(),
}));

import { fetchProcessed, type FetchProcessedReport } from '../../lib/core/fetchProcessed';
import { getStoredEntryDefect, romanizerExpected, validateFreshResult } from '../../lib/core/processedCache';
import { saveSongCache } from '../../lib/core/lyricsCache';
import { hashString } from '../../lib/utils/hashUtils';
import type { ProcessedCache, SongCache } from '../../lib/core/lyricsTypes';

// Invented lines (no real lyrics).
const JA = ['きょうはあめです', 'あしたははれです', 'そらがあおいです'];
const JA_ROMAJI = ['Kyou wa ame desu', 'Ashita wa hare desu', 'Sora ga aoi desu'];
const JA_EN = ['It is raining today', 'It will be sunny tomorrow', 'The sky is blue'];

const newCache = (original: string[]): SongCache => ({ original: [...original], processed: new Map() });

describe('p1-C fetchProcessed (K1 PROCESS contract and result validation)', () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendMessage = vi.fn();
    (global as any).browser.runtime.sendMessage = sendMessage;
    (window as any).spotifyState = { track: null, language: 'ja' };
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleWarn.mockRestore();
    (window as any).spotifyState = { track: null };
  });

  it('sends sourceLang from spotifyState.language (or null)', async () => {
    sendMessage.mockResolvedValue({ translated: JA_EN, romanized: JA_ROMAJI });
    await fetchProcessed(JA, 'en', newCache(JA), 'k', new Map(), { value: 0 });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'PROCESS', lines: JA, targetLang: 'en', sourceLang: 'ja' });

    (window as any).spotifyState = { track: null };
    await fetchProcessed(JA, 'de', newCache(JA), 'k', new Map(), { value: 0 });
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'PROCESS', lines: JA, targetLang: 'de', sourceLang: null });
  });

  it('a null response is a failure: nothing cached or persisted', async () => {
    sendMessage.mockResolvedValue(null);
    const cache = newCache(JA);
    const report: FetchProcessedReport = {};
    const result = await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 }, report);
    expect(result).toBeNull();
    expect(report.status).toBe('failed');
    expect(cache.processed.size).toBe(0);
    expect(saveSongCache).not.toHaveBeenCalled();
  });

  it('translationFailed: keeps romanization in memory, never persists, retries next time', async () => {
    sendMessage.mockResolvedValue({ translated: null, romanized: JA_ROMAJI, translationFailed: true });
    const cache = newCache(JA);
    const result = await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 });

    expect(result?.translated).toBeNull();
    expect(result?.translationFailed).toBe(true);
    expect(result?.romanized).toEqual(JA_ROMAJI);
    expect(cache.processed.get('en')?.transient).toBe(true);
    expect(saveSongCache).not.toHaveBeenCalled();

    // The failed translation is not served from cache: the next request retries.
    sendMessage.mockResolvedValue({ translated: JA_EN, romanized: JA_ROMAJI });
    const retry = await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(retry?.translated).toEqual(JA_EN);
    expect(saveSongCache).toHaveBeenCalledTimes(1);
  });

  it('treats an echoed "translation" (original text) as a failed translation', async () => {
    sendMessage.mockResolvedValue({ translated: [...JA], romanized: JA_ROMAJI });
    const cache = newCache(JA);
    const result = await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 });
    expect(result?.translationFailed).toBe(true);
    expect(result?.translated).toBeNull();
    expect(saveSongCache).not.toHaveBeenCalled();
  });

  it('accepts the original text as translation when the target is the song language', async () => {
    sendMessage.mockResolvedValue({ translated: [...JA], romanized: JA_ROMAJI });
    const result = await fetchProcessed(JA, 'ja', newCache(JA), 'k', new Map(), { value: 0 });
    expect(result?.translationFailed).toBeUndefined();
    expect(result?.translated).toEqual(JA);
    expect(saveSongCache).toHaveBeenCalledTimes(1);
  });

  it('rejects misaligned romanization without caching it', async () => {
    sendMessage.mockResolvedValue({ translated: JA_EN, romanized: [JA_ROMAJI.join(' ')] });
    const cache = newCache(JA);
    const report: FetchProcessedReport = {};
    expect(await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 }, report)).toBeNull();
    expect(report.status).toBe('failed');
    expect(cache.processed.size).toBe(0);
  });

  it('flags romanization that is still mostly native script, keeps it in memory only', async () => {
    sendMessage.mockResolvedValue({ translated: JA_EN, romanized: [JA_ROMAJI[0], JA[1], JA[2]] });
    const cache = newCache(JA);
    const result = await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 });
    expect(result?.isLowQualityRomanization).toBe(true);
    expect(result?.transient).toBe(true);
    expect(result?.translated).toEqual(JA_EN);
    expect(saveSongCache).not.toHaveBeenCalled();

    // Served from memory (no rejection loop): the translation is still good.
    sendMessage.mockClear();
    const again = await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(again).toBe(result);
  });

  it('discards a cached entry whose translation is the original text and refetches', async () => {
    const cache = newCache(JA);
    const poisoned: ProcessedCache = { translated: [...JA], romanized: [...JA], sourceHash: hashString(JA.join('|')) };
    cache.processed.set('en', poisoned);
    sendMessage.mockResolvedValue({ translated: JA_EN, romanized: JA_ROMAJI });

    const result = await fetchProcessed(JA, 'en', cache, 'k', new Map(), { value: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result?.translated).toEqual(JA_EN);
  });

  describe('C9: scripts without a romanizer (detectScript reports them as latin)', () => {
    // Invented Greek lines (no real lyrics). detectScript has no Greek range.
    const EL = ['Ο ήλιος λάμπει σήμερα', 'Η θάλασσα είναι ήρεμη', 'Περπατάμε στον δρόμο'];
    const EL_EN = ['The sun is shining today', 'The sea is calm', 'We walk on the road'];

    beforeEach(() => {
      (window as any).spotifyState = { track: null, language: null };
    });

    it('romanizerExpected is false for Greek, true for Japanese', () => {
      expect(romanizerExpected(EL)).toBe(false);
      expect(romanizerExpected(JA)).toBe(true);
    });

    it('persists a real translation whose romanization is the original text, and it survives a reload check', async () => {
      sendMessage.mockResolvedValue({ translated: EL_EN, romanized: [...EL] });
      const cache = newCache(EL);
      const result = await fetchProcessed(EL, 'en', cache, 'k', new Map(), { value: 0 });

      expect(result?.translated).toEqual(EL_EN);
      expect(result?.romanized).toEqual(EL);
      expect(result?.transient).toBeUndefined();
      expect(result?.isLowQualityRomanization).toBeUndefined();
      expect(saveSongCache).toHaveBeenCalledTimes(1);

      // Same entry as loaded from storage (no transient flag): not rejected.
      const stored: ProcessedCache = { translated: [...EL_EN], romanized: [...EL], sourceHash: result!.sourceHash };
      expect(getStoredEntryDefect(EL, 'en', stored)).toBeNull();

      // And it is served from cache on the next request (no rejection loop).
      sendMessage.mockClear();
      const again = await fetchProcessed(EL, 'en', cache, 'k', new Map(), { value: 0 });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(again).toBe(result);
    });

    it('still treats an echoed Greek "translation" as a failed translation', () => {
      const verdict = validateFreshResult(EL, 'en', { translated: [...EL], romanized: [...EL] });
      expect(verdict.ok && verdict.result.translationFailed).toBe(true);
      expect(getStoredEntryDefect(EL, 'en', { translated: [...EL], romanized: [...EL] }))
        .toBe('translation into "en" is the original text');
    });

    it('Japanese romanization equal to the original is still flagged fresh and rejected when stored', () => {
      (window as any).spotifyState = { track: null, language: 'ja' };
      const verdict = validateFreshResult(JA, 'en', { translated: JA_EN, romanized: [...JA] });
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) return;
      expect(verdict.result.isLowQualityRomanization).toBe(true);
      expect(verdict.result.transient).toBe(true);
      expect(verdict.result.translated).toEqual(JA_EN);

      expect(getStoredEntryDefect(JA, 'en', { translated: JA_EN, romanized: [...JA] }))
        .toBe('romanization is the original text');
    });
  });

  it('reports a superseded request without treating it as a failure', async () => {
    const genRef = { value: 0 };
    let resolveMessage: (v: unknown) => void = () => {};
    sendMessage.mockReturnValue(new Promise(r => { resolveMessage = r; }));
    const cache = newCache(JA);
    const report: FetchProcessedReport = {};
    const pending = fetchProcessed(JA, 'en', cache, 'k', new Map(), genRef, report);
    genRef.value++; // song change / takeover cancels in-flight processing
    resolveMessage({ translated: JA_EN, romanized: JA_ROMAJI });
    expect(await pending).toBeNull();
    expect(report.status).toBe('superseded');
    expect(cache.processed.size).toBe(0);
  });
});
