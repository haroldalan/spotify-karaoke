/**
 * Group B2 (phase 1): K4 interceptor lifecycle.
 * interceptorReady = heartbeat (SLY_INTERCEPTOR_READY), interceptorActive = in flight
 * (SLY_INTERCEPT_START..END); SLY_INTERCEPT_END dispatches sly:interceptor_settled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const w = window as any;

function postGateway(action: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: { source: 'SLY_ACTION_GATEWAY', action },
    source: window,
  }));
}

function postReady(): void {
  // fetchInterceptor.ts posts both shapes.
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'SLY_INTERCEPTOR_READY' }, source: window }));
  postGateway({ type: 'SLY_INTERCEPTOR_READY' });
}

async function loadContentScript(): Promise<void> {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = '';
  // Same order as entrypoints/spotify-lyrics.content/index.ts (styles before content).
  await import('../../lib/slyCore/state');
  await import('../../lib/slyCore/preFetch');
  await import('../../lib/slyCore/adManager');
  await import('../../lib/slyCore/styles');
  await import('../../lib/slyCore/detector');
  await import('../../lib/slyCore/domEngine');
  await import('../../lib/slyCore/messaging');
  await import('../../lib/slyCore/content');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('interceptor heartbeat (content.ts)', () => {
  it('READY sets interceptorReady, never interceptorActive', async () => {
    await loadContentScript();
    postReady();
    expect(w.slyInternalState.interceptorReady).toBe(true);
    expect(w.slyInternalState.interceptorActive).toBe(false);
  });

  it('a track reset clearing interceptorActive does not cause a false heartbeat failure', async () => {
    await loadContentScript();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    postReady();
    // ui.ts slyResetPlayerState clears the in-flight flag on every track switch.
    w.slyInternalState.interceptorActive = false;
    await vi.advanceTimersByTimeAsync(2100);
    expect(w.slyInternalState.interceptorFailed).toBe(false);
    expect(warn.mock.calls.some(c => String(c[0]).includes('Heartbeat: FAILED'))).toBe(false);
  });

  it('flags interceptorFailed when no READY arrives within 2s, and self-heals on a late READY', async () => {
    await loadContentScript();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(2100);
    expect(w.slyInternalState.interceptorFailed).toBe(true);
    postReady();
    expect(w.slyInternalState.interceptorFailed).toBe(false);
    expect(w.slyInternalState.interceptorReady).toBe(true);
  });
});

describe('intercept in-flight signals (messaging.ts)', () => {
  it('START/END toggle interceptorActive and END dispatches sly:interceptor_settled', async () => {
    await loadContentScript();
    const settled = vi.fn();
    document.addEventListener('sly:interceptor_settled', settled);

    postGateway({ type: 'SLY_INTERCEPT_START', trackId: '0000000000000000000001' });
    expect(w.slyInternalState.interceptorActive).toBe(true);
    expect(w.slyInternalState.interceptorReady).toBe(true);
    expect(settled).not.toHaveBeenCalled();

    postGateway({ type: 'SLY_INTERCEPT_END', trackId: '0000000000000000000001' });
    expect(w.slyInternalState.interceptorActive).toBe(false);
    // vi.resetModules() leaves earlier module instances' window listeners attached,
    // so each loaded instance dispatches once; only presence matters here.
    expect(settled).toHaveBeenCalled();

    document.removeEventListener('sly:interceptor_settled', settled);
  });

  it('a lost SLY_INTERCEPT_END is settled by the watchdog', async () => {
    await loadContentScript();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const settled = vi.fn();
    document.addEventListener('sly:interceptor_settled', settled);

    postGateway({ type: 'SLY_INTERCEPT_START', trackId: '0000000000000000000002' });
    await vi.advanceTimersByTimeAsync(7000);
    expect(w.slyInternalState.interceptorActive).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(w.slyInternalState.interceptorActive).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);

    document.removeEventListener('sly:interceptor_settled', settled);
  });
});
