// The dev kit's background side: extension-wide ops and a log of the requests the
// background served. See protocol.ts.
import type { DevAnswer, DevBackgroundReq } from './protocol';
import { cacheClear, cacheDelete, cacheGet } from '../background/cache';
import { resetSettings } from '../shared/settings';

const LOG_MAX = 300;
const trail: string[] = [];

/** Records one request the background served (dev kit builds only). */
export function devLog(line: string): void {
  trail.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
  if (trail.length > LOG_MAX) trail.shift();
}

/** The last n lines of the request log. */
export function devTrail(n = 50): string[] {
  return trail.slice(-n);
}

/** Wraps the background's handlers so each request is logged with its time and outcome. */
export function logged<H extends Record<string, (p: never) => unknown>>(handlers: H): H {
  const out = {} as Record<string, (p: never) => unknown>;
  for (const [name, fn] of Object.entries(handlers)) {
    out[name] = async (p: never) => {
      const t = performance.now();
      try {
        const v = await fn(p);
        devLog(`${name} ${Math.round(performance.now() - t)} ms ${summary(v)}${about(p)}`);
        return v;
      } catch (e) {
        devLog(`${name} ${Math.round(performance.now() - t)} ms error: ${String((e as Error)?.message || e)}${about(p)}`);
        throw e;
      }
    };
  }
  return out as H;
}

function about(p: unknown): string {
  const meta = (p as { meta?: { id?: string; name?: string } })?.meta ?? (p as { id?: string; name?: string });
  return meta?.id && meta?.name ? ` [${meta.name} ${meta.id}]` : '';
}

function summary(v: unknown): string {
  if (v === null || v === undefined) return '-> none';
  if (typeof v !== 'object') return `-> ${String(v)}`;
  const o = v as { lines?: unknown[]; source?: string; aligned?: boolean };
  if (Array.isArray(o.lines)) return `-> ${o.lines.length} lines${o.source ? ` from ${o.source}` : ''}${o.aligned === undefined ? '' : o.aligned ? ' aligned' : ' own timing'}`;
  return '-> ok';
}

async function cacheKeys(filter?: string): Promise<string[]> {
  const index = ((await chrome.storage.local.get('cache-index'))['cache-index'] ?? {}) as Record<string, number>;
  return Object.keys(index)
    .filter((k) => !filter || k.includes(filter))
    .sort((a, b) => index[b] - index[a]);
}

type Op = (args: Record<string, unknown> | undefined) => unknown;

const OPS: Record<string, Op> = {
  async forget(args) {
    const id = String(args?.id ?? '');
    if (!id) throw new Error('forget: which track id?');
    const keys = await cacheKeys(id);
    for (const k of keys) await cacheDelete(k);
    devLog(`dev forget ${id}: ${keys.length} entries`);
    return { id, removed: keys };
  },
  async clearCache() {
    await cacheClear();
    devLog('dev clearCache');
    return true;
  },
  async resetData() {
    await Promise.all([resetSettings(), cacheClear()]);
    devLog('dev resetData');
    return true;
  },
  cacheKeys: (args) => cacheKeys(args?.filter as string | undefined),
  cacheGet: async (args) => (await chrome.storage.local.get(String(args?.key)))[String(args?.key)] ?? (await cacheGet(String(args?.key))) ?? null,
  log: (args) => devTrail(Number(args?.n) || 50),
  reloadExtension() {
    devLog('dev reloadExtension');
    // Answer first: the reload ends this service worker.
    setTimeout(() => chrome.runtime.reload(), 100);
    return { reloading: true, version: chrome.runtime.getManifest().version };
  },
};

/** Serves the dev kit's background ops; other ops (health, storage) go through `extra`. */
export function serveDevkitBackground(extra: Record<string, Op>): void {
  const ops = { ...OPS, ...extra };
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply: (r: DevAnswer) => void) => {
    const req = msg as DevBackgroundReq | undefined;
    if (!req?.skDev || typeof req.op !== 'string') return false;
    const fn = Object.hasOwn(ops, req.op) ? ops[req.op] : null;
    if (!fn) {
      reply({ ok: false, error: `unknown op ${req.op} (try __skDev.help())` });
      return false;
    }
    Promise.resolve()
      .then(() => fn(req.args as Record<string, unknown> | undefined))
      .then((value) => reply({ ok: true, value }), (e) => reply({ ok: false, error: String(e?.message || e) }));
    return true;
  });
}
