import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 2026-11-07 flicker: the lyrics button turns inactive ~50 ms before Spotify removes its
// view; the close cleanup (pill, our root, Spotify's panel shown again) waits for that.

const overlayHtml = `<div id="main"><div data-testid="root"><div><div class="overlay">
  <div role="radiogroup"><button role="radio" value="lyrics" aria-checked="true"></button></div>
</div></div></div></div>
<aside data-testid="now-playing-bar"><button data-testid="lyrics-button" data-active="true" aria-pressed="true"></button></aside>`;

let closes = 0;
const onClose = () => { closes++; };

beforeEach(async () => {
  vi.resetModules();
  closes = 0;
  document.body.innerHTML = overlayHtml;
  document.addEventListener('sly:panel_close', onClose);
  await import('../../lib/slyCore/events');
});

afterEach(() => {
  document.removeEventListener('sly:panel_close', onClose);
  vi.useRealTimers();
});

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const closeButton = () => {
  const b = document.querySelector('[data-testid="lyrics-button"]')!;
  b.setAttribute('data-active', 'false');
  b.setAttribute('aria-pressed', 'false');
};

describe('panel close waits for Spotify to remove its view', () => {
  it('no cleanup while the view is still on screen; cleanup once it is gone', async () => {
    closeButton();
    await settle();
    expect(closes).toBe(0);
    document.querySelector('.overlay')!.remove();
    await settle();
    expect(closes).toBe(1);
  });

  it('a view that stays (another media option chosen): cleanup after the settle time, as before', async () => {
    vi.useFakeTimers();
    const { CLOSE_SETTLE_MAX_MS } = await import('../../lib/slyCore/events');
    closeButton();
    await settle();
    expect(closes).toBe(0);
    vi.advanceTimersByTime(CLOSE_SETTLE_MAX_MS + 10);
    expect(closes).toBe(1);
  });

  it('reopened before Spotify removed the view: no cleanup at all', async () => {
    vi.useFakeTimers();
    const { CLOSE_SETTLE_MAX_MS } = await import('../../lib/slyCore/events');
    closeButton();
    await settle();
    const b = document.querySelector('[data-testid="lyrics-button"]')!;
    b.setAttribute('data-active', 'true');
    await settle();
    // Past the settle time and the reopen's 2 s mount wait (no watcher outlives the test).
    vi.advanceTimersByTime(Math.max(CLOSE_SETTLE_MAX_MS, 2000) + 10);
    expect(closes).toBe(0);
  });
});

