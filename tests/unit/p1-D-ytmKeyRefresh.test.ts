import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FALLBACK_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

function response(status: number, body: unknown = {}, text = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

let local: any;

beforeEach(() => {
  vi.resetModules();
  local = (global as any).browser.storage.local;
  local.get = vi.fn().mockResolvedValue({ ytm_api_key: 'STALE_KEY', ytm_key_source: 'scraped' });
  local.set = vi.fn().mockResolvedValue(undefined);
  local.remove = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('YTM 403 really refreshes the API key', () => {
  it('clears the stored key, re-scrapes, then falls back to the built-in key', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url === 'https://music.youtube.com/') {
        // The fresh scrape returns the same (rejected) key.
        return response(200, {}, '<script>{"INNERTUBE_API_KEY":"STALE_KEY"}</script>');
      }
      if (url.includes('key=STALE_KEY')) return response(403);
      if (url.includes(`key=${FALLBACK_KEY}`)) return response(200, {});
      return response(500);
    }));

    const { fetchYtmLyrics } = await import('../../lib/lyricsProviders/ytm');
    const res = await fetchYtmLyrics('Test Title', 'Test Artist');

    // Empty search result → no video → null, but the request chain must have recovered.
    expect(res).toBeNull();
    expect(local.remove).toHaveBeenCalledWith(['ytm_api_key', 'ytm_key_source']);
    expect(urls[0]).toContain('key=STALE_KEY');
    expect(urls).toContain('https://music.youtube.com/'); // storage was bypassed
    expect(urls[urls.length - 1]).toContain(`key=${FALLBACK_KEY}`);
    // The stored key is read only once (the retry does not re-read it).
    expect(local.get).toHaveBeenCalledTimes(1);
  });

  it('uses a freshly scraped key when it differs from the rejected one', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url === 'https://music.youtube.com/') {
        return response(200, {}, '<script>{"INNERTUBE_API_KEY":"FRESH_KEY"}</script>');
      }
      if (url.includes('key=STALE_KEY')) return response(403);
      if (url.includes('key=FRESH_KEY')) return response(200, {});
      return response(500);
    }));

    const { fetchYtmLyrics } = await import('../../lib/lyricsProviders/ytm');
    await fetchYtmLyrics('Test Title', 'Test Artist');

    expect(urls[urls.length - 1]).toContain('key=FRESH_KEY');
    expect(local.set).toHaveBeenCalledWith({ ytm_api_key: 'FRESH_KEY', ytm_key_source: 'scraped' });
  });
});
