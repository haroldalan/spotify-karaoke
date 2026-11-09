// The whole extension-internal protocol, content script -> background, in one table.
import type { FoundLyrics, NativeResult, Processed, TrackMeta } from './types';

export interface Api {
  /** Lyrics for a song Spotify has none for. null: nothing usable found. */
  findLyrics: (meta: TrackMeta) => FoundLyrics | null;
  /** The song's lyrics in its own script, when Spotify serves them romanized. */
  restoreNative: (req: { meta: TrackMeta; lines: string[]; times: number[]; synced: boolean }) => NativeResult | null;
  /** Romanize and/or translate a song's lines. */
  process: (req: { lines: string[]; language?: string | null; romanize: boolean; translateTo: string | null }) => Processed;
  /** Diagnostics for the popup. */
  status: () => { version: string };
}

export type Method = keyof Api;
export type Params<M extends Method> = Parameters<Api[M]>[0];
export type Result<M extends Method> = ReturnType<Api[M]>;

export interface Request<M extends Method = Method> {
  sk: true;
  method: M;
  params: Params<M>;
}

export type Response<M extends Method = Method> = { ok: true; value: Result<M> } | { ok: false; error: string };

/** Content script / popup side. */
export async function call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
  const req: Request<M> = { sk: true, method, params };
  const res = (await chrome.runtime.sendMessage(req)) as Response<M> | undefined;
  if (!res) throw new Error(`no answer to ${method}`);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

type Handlers = { [M in Method]: (params: Params<M>) => Promise<Result<M>> | Result<M> };

/** Background side. */
export function serve(handlers: Handlers): void {
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    const req = msg as Request | undefined;
    if (!req?.sk || !(req.method in handlers)) return false;
    const fn = handlers[req.method] as (p: unknown) => unknown;
    Promise.resolve()
      .then(() => fn(req.params))
      .then(
        (value) => sendResponse({ ok: true, value }),
        (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
      );
    return true;
  });
}
