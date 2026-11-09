// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bridge, type BridgeHandlers } from '../../src/content/bridge';
import { TAG } from '../../src/page/channel';

const config = { fillMissing: true, restoreNative: true, noLyrics: [] };
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<BridgeHandlers> = {}) {
  const sent: any[] = [];
  vi.spyOn(window, 'postMessage').mockImplementation((m: any) => { sent.push(m); });
  const h: BridgeHandlers = {
    findLyrics: vi.fn(async () => ({ lines: [{ startMs: 0, text: 'a' }], synced: false, source: 'LRCLIB' })),
    restoreNative: vi.fn(async () => null),
    onMeta: vi.fn(),
    onLyrics: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
  const bridge = new Bridge(h, config);
  const fromPage = (data: unknown, source: unknown = window) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
  return { h, sent, bridge, fromPage };
}

afterEach(() => vi.restoreAllMocks());

describe('content bridge', () => {
  it('announces itself, and answers the page script\'s hello', () => {
    const { sent, fromPage } = setup();
    expect(sent[0]).toMatchObject({ tag: TAG, dir: 'down', kind: 'ready', data: config });
    fromPage({ tag: TAG, dir: 'up', kind: 'hello' });
    expect(sent[1]).toMatchObject({ kind: 'ready' });
  });

  it('passes reports on', () => {
    const { h, fromPage } = setup();
    fromPage({ tag: TAG, dir: 'up', kind: 'event', type: 'meta', data: { id: 'x' } });
    fromPage({ tag: TAG, dir: 'up', kind: 'event', type: 'lyrics', data: { id: 'x', lines: ['a'] } });
    fromPage({ tag: TAG, dir: 'up', kind: 'event', type: 'error', data: 'boom' });
    expect(h.onMeta).toHaveBeenCalledWith({ id: 'x' });
    expect(h.onLyrics).toHaveBeenCalledWith({ id: 'x', lines: ['a'] });
    expect(h.onError).toHaveBeenCalledWith('boom');
  });

  it('answers calls by id, with null when the handler fails', async () => {
    const { sent, fromPage } = setup({ restoreNative: vi.fn(async () => { throw new Error('down'); }) });
    fromPage({ tag: TAG, dir: 'up', kind: 'call', id: 7, type: 'findLyrics', data: { id: 'x' } });
    fromPage({ tag: TAG, dir: 'up', kind: 'call', id: 8, type: 'restoreNative', data: { meta: {}, lines: [], times: [], synced: true } });
    await flush();
    expect(sent.find((m) => m.id === 7)).toMatchObject({ kind: 'reply', data: { source: 'LRCLIB' } });
    expect(sent.find((m) => m.id === 8)).toMatchObject({ kind: 'reply', data: null });
  });

  it('ignores messages from other windows, other tags, or its own direction', async () => {
    const { h, fromPage } = setup();
    fromPage({ tag: TAG, dir: 'up', kind: 'event', type: 'meta', data: {} }, null);
    fromPage({ tag: 'someone-else', dir: 'up', kind: 'event', type: 'meta', data: {} });
    fromPage({ tag: TAG, dir: 'down', kind: 'reply', id: 1, data: {} });
    fromPage({ tag: TAG, dir: 'up', kind: 'call', id: 9, type: 'unknownMethod', data: {} });
    await flush();
    expect(h.onMeta).not.toHaveBeenCalled();
    expect(h.findLyrics).not.toHaveBeenCalled();
  });

  it('sends new settings to the page', () => {
    const { sent, bridge } = setup();
    bridge.setConfig({ ...config, fillMissing: false });
    expect(sent.at(-1)).toMatchObject({ kind: 'config', data: { fillMissing: false } });
  });
});
