// The dev kit's API on Spotify's page (MAIN world): window.__skDev. See protocol.ts.
import { DEVKIT_TAG, HELP, isDevRes, type DevReq } from './protocol';
import type { Mode } from '../shared/types';

const TIMEOUT_MS = 20_000;

export function installDevkit(win: Window & typeof globalThis = window): void {
  if ((win as unknown as { __skDev?: unknown }).__skDev) return;
  let nextId = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  win.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== win || !isDevRes(e.data)) return;
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.value);
    else w.reject(new Error(e.data.error ?? 'failed'));
  });

  const request = (op: string, args?: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${op}: no answer in ${TIMEOUT_MS / 1000} s (is the extension loaded, and a devkit build?)`));
      }, TIMEOUT_MS);
      waiting.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      win.postMessage({ tag: DEVKIT_TAG, dir: 'req', id, op, args } satisfies DevReq, win.location.origin);
    });

  const api = {
    help: () => HELP,
    status: () => request('status'),
    state: () => request('state'),
    settings: (patch?: Record<string, unknown>) => request('settings', patch),
    mode: (m: Mode) => request('settings', { mode: m }),
    popup: (req: Record<string, unknown>) => request('page', req),
    searchAgain: () => request('page', { sk: 'search-again' }),
    notThisSong: (on = true) => request('page', { sk: 'not-this-song', on }),
    seedNone: () => request('seedNone'),
    forget: (id?: string) => request('forget', { id }),
    fresh: async () => {
      const r = await request('forget', {});
      win.location.reload();
      return r;
    },
    clearCache: () => request('clearCache'),
    resetData: () => request('resetData'),
    cacheKeys: (filter?: string) => request('cacheKeys', { filter }),
    cacheGet: (key: string) => request('cacheGet', { key }),
    health: () => request('health'),
    log: async (n = 50) => ({
      page: ((win as unknown as { __skLog?: string[] }).__skLog ?? []).slice(-n),
      background: await request('log', { n }),
    }),
    reloadExtension: () => request('reloadExtension'),
  };
  Object.defineProperty(win, '__skDev', { value: Object.freeze(api), enumerable: false });
}
