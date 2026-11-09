// Runs in Spotify's own JavaScript world from document_start. Wraps window.fetch to:
//  - report track metadata, and claim lyrics for songs Spotify has none for;
//  - report every set of lyrics Spotify loads (current song and the prefetched next one);
//  - answer Spotify's 404 for a song without lyrics with lyrics we found elsewhere.
// It never touches the DOM.
import { TAG, isDown, type Down, type PageConfig, type Up } from './channel';
import { COLOR_LYRICS_URL, METADATA_URL, buildColorLyrics, parseColorLyrics, parseMeta } from './spotifyFormat';
import type { FoundLyrics, NativeResult, TrackMeta } from '../shared/types';
import { expectedScript, songScript } from '../shared/scripts';

export interface HookTiming {
  /** How long Spotify's lyrics request may wait for our lookup (Spotify shows its spinner). */
  lookupMs: number;
  /** How long Spotify's unsynced lyrics may wait for a synced copy. */
  upgradeMs: number;
  /** How long Spotify's romanized lyrics may wait for the original script. Later results
   *  still reach the display, through the content script's line aliases. */
  nativeMs: number;
  /** How long a lyrics response may wait for its track's metadata. */
  metaWaitMs: number;
}

export const DEFAULT_TIMING: HookTiming = { lookupMs: 12_000, upgradeMs: 4_000, nativeMs: 5_000, metaWaitMs: 1_500 };

export function installHook(win: Window & typeof globalThis = window, timing: HookTiming = DEFAULT_TIMING): void {
  if ((win as unknown as { __skHook?: boolean }).__skHook) return;
  (win as unknown as { __skHook?: boolean }).__skHook = true;

  let config: PageConfig = { fillMissing: true, restoreNative: true, noLyrics: [] };
  let noLyrics = new Set<string>();
  let ready = false;
  const outbox: Up[] = [];
  const metas = new Map<string, TrackMeta>();
  // Decision log for live diagnostics: window.__skLog (last 200 entries, no personal data).
  const trail: string[] = [];
  Object.defineProperty(win, '__skLog', { value: trail, enumerable: false });
  const note = (s: string) => { trail.push(`${Math.round(performance.now())} ${s}`); if (trail.length > 200) trail.shift(); };
  const replies = new Map<number, (v: unknown) => void>();
  // Spotify sometimes asks for a track's lyrics just before its metadata (the next track's
  // prefetch, 2026-11-09): wait for the metadata a little.
  const metaWaiters = new Map<string, ((m: TrackMeta) => void)[]>();
  const metaFor = (id: string, waitMs = timing.metaWaitMs): Promise<TrackMeta | undefined> => {
    const known = metas.get(id);
    if (known) return Promise.resolve(known);
    return new Promise((resolve) => {
      const done = (m?: TrackMeta) => { clearTimeout(timer); resolve(m); };
      const timer = setTimeout(() => {
        metaWaiters.set(id, (metaWaiters.get(id) ?? []).filter((w) => w !== done));
        resolve(undefined);
      }, waitMs);
      metaWaiters.set(id, [...(metaWaiters.get(id) ?? []), done]);
    });
  };
  let nextId = 1;

  const post = (msg: Up) => {
    if (ready || msg.kind === 'hello') win.postMessage(msg, win.location.origin);
    else outbox.push(msg);
  };
  const emit = (type: string, data: unknown) => post({ tag: TAG, dir: 'up', kind: 'event', type, data });
  const call = (type: string, data: unknown, timeoutMs: number) =>
    new Promise<unknown>((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => { replies.delete(id); resolve(null); }, timeoutMs);
      replies.set(id, (v) => { clearTimeout(timer); resolve(v); });
      post({ tag: TAG, dir: 'up', kind: 'call', id, type, data });
    });

  win.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== win || !isDown(e.data)) return;
    const msg = e.data as Down;
    if (msg.kind === 'ready' || msg.kind === 'config') {
      config = msg.data;
      noLyrics = new Set(config.noLyrics);
      if (!ready) {
        ready = true;
        for (const m of outbox.splice(0)) win.postMessage(m, win.location.origin);
      }
    } else if (msg.kind === 'reply') {
      replies.get(msg.id)?.(msg.data);
      replies.delete(msg.id);
    }
  });
  post({ tag: TAG, dir: 'up', kind: 'hello' });

  const json = (body: unknown, from: Response) => {
    const headers = new Headers(from.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(body), { status: 200, statusText: 'OK', headers });
  };

  async function onMetadata(res: Response): Promise<Response | null> {
    if (!res.ok) return null;
    const raw = await res.clone().json();
    const meta = parseMeta(raw);
    if (!meta) return null;
    metas.set(meta.id, meta);
    if (metas.size > 300) metas.delete(metas.keys().next().value!);
    emit('meta', meta);
    for (const w of metaWaiters.get(meta.id) ?? []) w(meta);
    metaWaiters.delete(meta.id);
    note(`meta ${meta.id} has_lyrics=${meta.hasLyrics} lang=${meta.languages.join(',')}`);
    if (meta.hasLyrics || !config.fillMissing || noLyrics.has(meta.id)) return null;
    // Claim lyrics so Spotify enables its Lyrics button and asks color-lyrics for them.
    return json({ ...raw, has_lyrics: true }, res);
  }

  async function onColorLyrics(res: Response, id: string): Promise<Response | null> {
    if (res.ok) {
      const l = parseColorLyrics(await res.clone().json());
      if (!l) return null;
      const meta = await metaFor(id);
      note(`lyrics ${id} ${l.syncType} script=${songScript(l.lines, l.language)} meta=${meta ? 'yes' : 'no'}`);
      // Romanized lyrics for a song written in another script: restore the original script.
      if (config.restoreNative && meta && expectedScript(meta.languages) && songScript(l.lines) === 'Latn') {
        const native = (await call(
          'restoreNative',
          { meta, lines: l.lines, times: l.times, synced: l.syncType !== 'UNSYNCED' },
          timing.nativeMs,
        )) as NativeResult | null;
        note(`native ${id} ${native ? (native.aligned ? 'aligned' : 'own-timing') + ' ' + native.source : 'none/late'}`);
        if (native) {
          emit('lyrics', { id, lines: native.lines.map((x) => x.text), language: meta.languages[0] ?? null, source: native.source });
          return json(buildColorLyrics(native, meta.languages[0] ?? null), res);
        }
      }
      // Unsynced lyrics: a synced copy elsewhere is better, as long as it is in the same script.
      if (l.syncType === 'UNSYNCED' && config.fillMissing && meta) {
        const found = (await call('findLyrics', meta, timing.upgradeMs)) as FoundLyrics | null;
        const theirs = songScript(l.lines, l.language);
        if (found?.synced && (theirs === 'Latn' || songScript(found.lines.map((x) => x.text)) === theirs)) {
          emit('lyrics', { id, lines: found.lines.map((x) => x.text), language: l.language, source: found.source });
          return json(buildColorLyrics(found, l.language), res);
        }
      }
      emit('lyrics', { id, lines: l.lines, language: l.language, source: 'spotify' });
      return null;
    }
    if (res.status !== 404 || !config.fillMissing) return null;
    const meta = await metaFor(id);
    if (!meta) return null;
    const found = (await call('findLyrics', meta, timing.lookupMs)) as FoundLyrics | null;
    note(`missing ${id} ${found?.lines.length ? (found.synced ? 'synced ' : 'unsynced ') + found.source : 'none'}`);
    if (!found?.lines.length) return null;
    const language = meta.languages[0] ?? null;
    emit('lyrics', { id, lines: found.lines.map((l) => l.text), language, source: found.source });
    return json(buildColorLyrics(found, language), res);
  }

  const realFetch = win.fetch;
  win.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const res = await realFetch.apply(this, args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    try {
      let m = METADATA_URL.exec(url);
      if (m) return (await onMetadata(res)) ?? res;
      m = COLOR_LYRICS_URL.exec(url);
      if (m) return (await onColorLyrics(res, m[1])) ?? res;
    } catch (e) {
      emit('error', String((e as Error)?.message || e));
    }
    return res;
  } as typeof fetch;
}
