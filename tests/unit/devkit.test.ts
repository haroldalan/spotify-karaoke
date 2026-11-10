// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDevkit } from '../../src/devkit/page';
import { serveDevkit } from '../../src/devkit/content';
import { devLog, devTrail, logged } from '../../src/devkit/background';
import { DEVKIT } from '../../src/devkit/protocol';

type Dev = { settings: (p?: unknown) => Promise<unknown>; status: () => Promise<unknown>; clearCache: () => Promise<unknown> };
const dev = () => (window as unknown as { __skDev: Dev }).__skDev;

// happy-dom's postMessage leaves event.source empty: fill it in, as a browser does.
window.postMessage = ((data: unknown) => {
  setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, source: window as unknown as MessageEventSource, origin: location.origin })), 0);
}) as typeof window.postMessage;

describe('dev kit', () => {
  const life = new AbortController();
  afterEach(() => vi.unstubAllGlobals());

  it('is on outside production builds (tests run in mode "test")', () => {
    expect(DEVKIT).toBe(true);
  });

  it('answers page-side ops in the content script and forwards the rest to the background', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('chrome', { runtime: { sendMessage: async (m: unknown) => { sent.push(m); return { ok: true, value: 'cleared' }; } } });
    installDevkit(window as never);
    serveDevkit({ settings: (patch) => ({ mode: 'romanized', ...(patch as object) }) }, life.signal);
    expect(await dev().settings({ allLines: true })).toEqual({ mode: 'romanized', allLines: true });
    expect(await dev().clearCache()).toBe('cleared');
    expect(sent).toEqual([{ skDev: true, op: 'clearCache', args: undefined }]);
  });

  it('passes errors back to the caller', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ ok: false, error: 'unknown op status' }) } });
    await expect(dev().status()).rejects.toThrow('unknown op status');
  });

  it('logs each background request with its outcome and the song it was for', async () => {
    const h = logged({
      restoreNative: async (_p: never) => ({ lines: [{}, {}], source: 'LRCLIB', aligned: true }),
      findLyrics: async (_p: never) => { throw new Error('HTTP 503'); },
    });
    await h.restoreNative({ meta: { id: 'x1', name: 'Song' } } as never);
    await expect(h.findLyrics({ id: 'x2', name: 'Other' } as never)).rejects.toThrow('HTTP 503');
    devLog('marker');
    const [ok, failed, marker] = devTrail(3);
    expect(ok).toMatch(/restoreNative \d+ ms -> 2 lines from LRCLIB aligned \[Song x1\]$/);
    expect(failed).toMatch(/findLyrics \d+ ms error: HTTP 503 \[Other x2\]$/);
    expect(marker).toMatch(/ marker$/);
  });
});

