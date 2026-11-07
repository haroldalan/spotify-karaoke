import { describe, it, expect, vi, afterEach } from 'vitest';
import { googleTranslate } from '../../lib/translate/googleApi';
import { myMemoryTranslate, toMyMemorySource } from '../../lib/translate/myMemoryApi';

// Synthetic phrases only (no song lyrics). Response shapes follow the live
// Google (dt=t&dt=rm) and MyMemory formats.

function jsonResponse(body: unknown, init: { status?: number; contentType?: string } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (init.contentType ?? 'application/json; charset=utf-8') : null) },
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('googleTranslate — romanization block', () => {
  it('takes the SOURCE transliteration (index 3) when the target has its own script', async () => {
    const data = [[
      ['परीक्षा पंक्ति एक\n', 'পরীক্ষা লাইন এক\n', null, null, 10],
      ['परीक्षा पंक्ति दो', 'পরীক্ষা লাইন দুই', null, null, 10],
      [null, null, 'pariksha pankti ek\npariksha pankti do', 'porikkha lain ek\nporikkha lain dui'],
    ], null, 'bn'];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(data));
    vi.stubGlobal('fetch', fetchMock);

    const res = await googleTranslate('পরীক্ষা লাইন এক\nপরীক্ষা লাইন দুই', 'hi', true, 'bn');

    expect(res.romanized).toBe('porikkha lain ek\nporikkha lain dui');
    expect(res.translated).toBe('परीक्षा पंक्ति एक\nपरीक्षा पंक्ति दो');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('sl=bn');
    expect(url).toContain('tl=hi');
  });

  it('reads index 3 for a Latin target too and drops the block from the translation', async () => {
    const data = [[
      ['test line one\n', 'পরীক্ষা লাইন এক\n'],
      ['test line two', 'পরীক্ষা লাইন দুই'],
      [null, null, null, 'porikkha lain ek\nporikkha lain dui'],
    ]];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(data)));

    const res = await googleTranslate('x', 'en', true, 'bn');

    expect(res.romanized).toBe('porikkha lain ek\nporikkha lain dui');
    expect(res.translated).toBe('test line one\ntest line two');
  });

  it('never uses the target transliteration when the source one is missing', async () => {
    const data = [[
      ['परीक्षा', 'test'],
      [null, null, 'pariksha', null],
    ]];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(data)));

    const res = await googleTranslate('test', 'hi', true, 'auto');

    expect(res.romanized).toBeNull();
    expect(res.translated).toBe('परीक्षा');
  });

  it('throws on a captcha (non-JSON) page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('', { contentType: 'text/html' })));
    await expect(googleTranslate('x', 'en', false)).rejects.toThrow(/captcha/);
  });
});

describe('myMemoryTranslate — langpair and status parsing', () => {
  it("maps 'auto' to 'Autodetect' and keeps explicit sources", () => {
    expect(toMyMemorySource('auto')).toBe('Autodetect');
    expect(toMyMemorySource(undefined)).toBe('Autodetect');
    expect(toMyMemorySource('ja')).toBe('ja');
  });

  it("sends langpair 'Autodetect|<tl>' for an unknown source", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ responseStatus: 200, responseData: { translatedText: 'test' } }));
    vi.stubGlobal('fetch', fetchMock);

    await myMemoryTranslate('prueba', 'en');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('langpair')).toBe('Autodetect|en');
  });

  it('sends the resolved explicit source', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ responseStatus: 200, responseData: { translatedText: 'test' } }));
    vi.stubGlobal('fetch', fetchMock);

    await myMemoryTranslate('テスト', 'en', 'ja');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('langpair')).toBe('ja|en');
  });

  it('rejects a string error status ("403") even with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      responseStatus: '403',
      responseDetails: "'AUTO' IS AN INVALID SOURCE LANGUAGE",
      responseData: { translatedText: "'AUTO' IS AN INVALID SOURCE LANGUAGE" },
    })));
    await expect(myMemoryTranslate('x', 'en')).rejects.toThrow(/403/);
  });

  it('accepts a numeric or string 200 status', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ responseStatus: 200, responseData: { translatedText: 'one' } }))
      .mockResolvedValueOnce(jsonResponse({ responseStatus: '200', responseData: { translatedText: 'two' } })));
    await expect(myMemoryTranslate('x', 'en')).resolves.toBe('one');
    await expect(myMemoryTranslate('x', 'en')).resolves.toBe('two');
  });

  it('rejects when the quota is finished', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'x' } })));
    await expect(myMemoryTranslate('x', 'en')).rejects.toThrow(/quota/);
  });
});
