import { describe, expect, it, vi } from 'vitest';

const japanese = vi.hoisted(() => ({ romanizeJapanese: vi.fn() }));
vi.mock('../../src/background/text/japanese', () => japanese);
const { romanizeLines } = await import('../../src/background/text/romanize');

describe('Japanese fallbacks', () => {
  it('asks Google only for lines with a kanji the dictionary could not read', async () => {
    japanese.romanizeJapanese.mockResolvedValue(['kimi', '昏i mama']);
    const asked: string[][] = [];
    const out = await romanizeLines(['君', '昏いまま'], 'Jpan', { google: async (l) => { asked.push(l); return ['kurai mama']; } });
    expect(out).toEqual(['kimi', 'kurai mama']);
    expect(asked).toEqual([['昏いまま']]);
  });

  it('uses Google for every line when the dictionary is unavailable, never Chinese readings', async () => {
    japanese.romanizeJapanese.mockRejectedValue(new Error('not loaded after 20000 ms'));
    const out = await romanizeLines(['君を愛してる'], 'Jpan', { google: async () => ['kimi o aishiteru'] });
    expect(out).toEqual(['kimi o aishiteru']);
  });
});
