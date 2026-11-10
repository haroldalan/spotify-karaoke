// A stand-in for Spotify's page around the page hook: a window with routed fetch
// responses, and a fake content script on the other end of the channel.
import { TAG, isUp, type Down, type PageConfig, type Up } from '../../src/page/channel';
import { installHook, type HookTiming } from '../../src/page/hook';

export type Route = (url: string) => Response | Promise<Response>;

export interface FakePageOptions {
  /** URL substring -> response factory. */
  routes: Record<string, Route>;
  config?: Partial<PageConfig>;
  /** Answers the hook's calls (findLyrics, restoreNative). Default: null. */
  answer?: (type: string, data: unknown) => unknown | Promise<unknown>;
  /** Start with the content script not listening yet (it says ready later via page.connect()). */
  contentLate?: boolean;
  timing?: Partial<HookTiming>;
  /** The title in Spotify's player bar; undefined: no player bar. */
  playing?: string;
}

export const FAST: HookTiming = { lookupMs: 200, upgradeMs: 200, nativeMs: 200, nativeAheadMs: 600, metaWaitMs: 100, configWaitMs: 100 };

export function fakePage(o: FakePageOptions) {
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const events: { type: string; data: any }[] = [];
  const calls: { type: string; data: any }[] = [];
  const config: PageConfig = { spotifyOnly: [], ...o.config };
  let contentListening = !o.contentLate;
  let playing = o.playing;
  const bar = { querySelector: () => ({ textContent: playing }) };

  const win: any = {
    location: { origin: 'https://open.spotify.com' },
    document: { querySelector: (sel: string) => (playing !== undefined && sel.includes('now-playing') ? bar : null) },
    addEventListener: (type: string, fn: any) => { if (type === 'message') listeners.push(fn); },
    postMessage: (data: unknown) => {
      queueMicrotask(() => { for (const fn of [...listeners]) fn({ source: win, data }); });
    },
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      for (const [key, route] of Object.entries(o.routes)) if (url.includes(key)) return route(url);
      return new Response('not routed', { status: 599 });
    },
  };

  const send = (msg: Down) => win.postMessage(msg);
  // The fake content script.
  listeners.push(({ source, data }) => {
    if (source !== win || !isUp(data) || !contentListening) return;
    const msg = data as Up;
    if (msg.kind === 'hello') send({ tag: TAG, dir: 'down', kind: 'ready', data: config });
    else if (msg.kind === 'event') events.push({ type: msg.type, data: msg.data });
    else if (msg.kind === 'call') {
      calls.push({ type: msg.type, data: msg.data });
      Promise.resolve(o.answer ? o.answer(msg.type, msg.data) : null).then((v) => {
        if (v !== undefined) send({ tag: TAG, dir: 'down', kind: 'reply', id: msg.id, data: v });
      });
    }
  });

  installHook(win, { ...FAST, ...o.timing });

  return {
    win,
    events,
    calls,
    /** Spotify's fetch, as wrapped by the hook. */
    fetch: (url: string, init?: RequestInit) => win.fetch(url, init) as Promise<Response>,
    /** The content script starts late: it now listens and announces itself. */
    connect() {
      contentListening = true;
      send({ tag: TAG, dir: 'down', kind: 'ready', data: config });
    },
    log: () => win.__skLog as string[],
    /** Spotify's player bar now shows this song. */
    play(title: string) {
      playing = title;
    },
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
