import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/translate/googleApi', () => ({ googleTranslate: vi.fn() }));

import { googleTranslate } from '../../lib/translate/googleApi';
import { googleProcess, alignToChunk } from '../../lib/translateClient';

const mockGoogle = googleTranslate as unknown as ReturnType<typeof vi.fn>;

// Synthetic lines. Each is ~115 chars, so 4 lines fit in one 500-char Google chunk
// and the 5th/6th go into a second chunk.
const pad = (s: string) => (s + ' ' + 'x'.repeat(110)).slice(0, 115);
const LINES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2'].map(pad);

beforeEach(() => {
  mockGoogle.mockReset();
});

describe('alignToChunk', () => {
  it('pads short output with the source lines and slices long output', () => {
    expect(alignToChunk(['t1'], ['s1', 's2', 's3'])).toEqual(['t1', 's2', 's3']);
    expect(alignToChunk(['t1', 't2', 't3'], ['s1', 's2'])).toEqual(['t1', 't2']);
    expect(alignToChunk(['t1', 't2'], ['s1', 's2'])).toEqual(['t1', 't2']);
  });
});

describe('googleProcess — per-chunk alignment', () => {
  it('keeps later chunks aligned when Google returns fewer lines for a chunk', async () => {
    mockGoogle.mockImplementation(async (text: string) => {
      const src = text.split('\n');
      if (src.length === 4) {
        // Google merged two lines: 3 lines back for 4 sent.
        return { translated: 'T-A1\nT-A2 T-A3\nT-A4', romanized: null };
      }
      return { translated: src.map((l) => `T-${l.slice(0, 2)}`).join('\n'), romanized: null };
    });

    const res = await googleProcess(LINES, 'en', false, 'auto');

    expect(res.translated).toHaveLength(LINES.length);
    expect(res.translated[0]).toBe('T-A1');
    // The second chunk must not shift into the first chunk's slots.
    expect(res.translated[4]).toBe('T-B1');
    expect(res.translated[5]).toBe('T-B2');
  });

  it('falls back to per-line transliteration when Google collapses the romanization', async () => {
    mockGoogle.mockResolvedValue({ translated: 'one\ntwo', romanized: 'collapsed into one line' });

    const res = await googleProcess(['абв', 'где'], 'en', true, 'ru');

    expect(res.isLowQualityRomanization).toBe(true);
    expect(res.romanized).toHaveLength(2);
    expect(res.romanized[0]).not.toBe('collapsed into one line');
    expect(res.romanized[0]).toMatch(/^[a-z]+$/i);
  });

  it('rejects when Google fails: there is no second translator, and originals are never a translation', async () => {
    mockGoogle.mockRejectedValue(new Error('Google HTTP 429'));
    await expect(googleProcess(['привет', 'спасибо'], 'en', true, 'ru')).rejects.toThrow('429');
    expect(mockGoogle).toHaveBeenCalledTimes(1);
  });

  it('treats an empty Google translation as a failure', async () => {
    mockGoogle.mockResolvedValue({ translated: '   ', romanized: null });
    await expect(googleProcess(['test'], 'es', false, 'auto')).rejects.toThrow(/empty/);
  });
});
