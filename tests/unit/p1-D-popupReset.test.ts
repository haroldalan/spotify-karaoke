import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h } from 'preact';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

// Imported dynamically (path cast to string) so `tsc --noEmit` does not resolve the
// .tsx module, which the repo's tsconfig cannot type-check without a jsx setting.
const loadApp = async () => (await import('../../entrypoints/popup/App' as string)).default;

describe('Popup Reset Data (K7)', () => {
  let local: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).browser.storage.sync.get.mockResolvedValue({ targetLang: 'en', dualLyrics: true, preferredMode: 'original' });
    local = (global as any).browser.storage.local;
    local.get = vi.fn(async (keys: any) => (keys === null
      ? {
          'lc:spotify:track:test1': {},
          lc_index: {},
          l2_index: [],
          'spotify:track:test1': {},
          'test title|test artist': {},
          sly_native_status: {},
          ytm_api_key: 'K',
          ytm_key_source: 'scraped',
          't:https://example.test/art.jpg': '#123456',
          sly_theme_index: [],
        }
      : {}));
    local.set = vi.fn().mockResolvedValue(undefined);
    local.remove = vi.fn().mockResolvedValue(undefined);
    if (typeof TextEncoder === 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (global as any).TextEncoder = require('util').TextEncoder;
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('removes the lyrics caches and then writes the sly_cacheResetAt sentinel', async () => {
    const App = await loadApp();
    render(h(App, null));

    fireEvent.click(screen.getByText('Reset Data'));
    await screen.findByText('Reset settings?');
    fireEvent.click(screen.getByText('Reset'));

    await waitFor(() => {
      expect(local.set).toHaveBeenCalledWith({ sly_cacheResetAt: expect.any(Number) });
    });

    const removed: string[] = local.remove.mock.calls[0][0];
    expect(removed).toEqual(expect.arrayContaining([
      'lc:spotify:track:test1', 'lc_index', 'l2_index', 'spotify:track:test1',
      'test title|test artist', 'sly_native_status', 'ytm_api_key', 'ytm_key_source',
    ]));
    expect(removed).not.toContain('sly_theme_index');

    // The sentinel is written after the removal.
    const removeOrder = local.remove.mock.invocationCallOrder[0];
    const sentinelCall = local.set.mock.calls.findIndex((c: any[]) => 'sly_cacheResetAt' in c[0]);
    expect(local.set.mock.invocationCallOrder[sentinelCall]).toBeGreaterThan(removeOrder);
  });
});
