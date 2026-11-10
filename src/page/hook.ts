// Runs in Spotify's own JavaScript world from document_start. Wraps window.fetch to:
//  - report track metadata, and claim lyrics for songs Spotify has none for;
//  - report every set of lyrics Spotify loads (current song and the prefetched next one);
//  - answer Spotify's 404 for a song without lyrics with lyrics we found elsewhere;
//  - upgrade unsynced lyrics, and restore the original script of romanized lyrics.
// It never touches the DOM.
import { TAG, isDown, type Down, type PageConfig, type Up } from './channel';
import { buildColorLyrics, classify, harvestTracks, parseColorLyrics, parseMeta, type TrackHint } from './spotifyFormat';
import type { FoundLyrics, NativeResult, TrackMeta } from '../shared/types';
import { expectedScript, songScript } from '../shared/scripts';
import { isLikelyRomanizedFallback } from '../shared/romanizedDetector';

export interface HookTiming {
  /** How long Spotify's lyrics request may wait for our lookup (Spotify shows its spinner). */
  lookupMs: number;
  /** How long Spotify's unsynced lyrics may wait for a synced copy. */
  upgradeMs: number;
  /** How long Spotify's romanized lyrics may wait for the original script. A later
   *  line-for-line copy is put on screen by the content script; another waits for the
   *  song's next load. */
  nativeMs: number;
  /** The same wait for a song that isn't playing yet (Spotify's prefetch of the next one):
   *  nobody is reading it, so the search may take its time. Once the song starts, at most
   *  nativeMs more. */
  nativeAheadMs: number;
  /** How long a lyrics response may wait for its track's metadata. */
  metaWaitMs: number;
  /** How long, once per page load, a response may wait for the extension's settings. */
  configWaitMs: number;
}

// Spotify's own lyrics wait at most 1.5 s for a better copy (12 s for a song not playing
// yet). A native-script copy that comes later and matches line for line is put on screen by
// the content script; anything else later is used the next time the song loads (from cache).
export const DEFAULT_TIMING: HookTiming = { lookupMs: 12_000, upgradeMs: 1_500, nativeMs: 1_500, nativeAheadMs: 12_000, metaWaitMs: 1_500, configWaitMs: 800 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Whether the player bar shows this song. Unknown (no player bar yet, at page load) counts as
 * playing: the short wait is the safe one.
 */
export function playingNow(doc: Document | undefined, meta: TrackMeta): boolean {
  if (!doc) return true;
  const bar = doc.querySelector('[data-testid="now-playing-widget"]') ?? doc.querySelector('[data-testid="now-playing-bar"]');
  const title = bar?.querySelector('[data-testid="context-item-link"]')?.textContent?.trim();
  return !title || title === meta.name;
}

export function installHook(win: Window & typeof globalThis = window, timing: HookTiming = DEFAULT_TIMING): void {
  if ((win as unknown as { __skHook?: boolean }).__skHook) return;
  (win as unknown as { __skHook?: boolean }).__skHook = true;

  let config: PageConfig = { noLyrics: [], spotifyOnly: [] };
  let noLyrics = new Set<string>();
  let spotifyOnly = new Set<string>();
  let ready = false;
  let configArrived!: () => void;
  const configReady = new Promise<void>((r) => (configArrived = r));
  /** Until the extension's settings (and its no-lyrics list) arrive, decisions wait briefly. */
  const settled = () => Promise.race([configReady, sleep(timing.configWaitMs)]);

  const outbox: Up[] = [];
  const metas = new Map<string, TrackMeta>();
  /** Track details from GraphQL responses: the fallback when metadata/4 never came. */
  const hints = new Map<string, TrackHint>();
  // Decision log for live diagnostics: window.__skLog (last 200 entries, no personal data).
  const trail: string[] = [];
  Object.defineProperty(win, '__skLog', { value: trail, enumerable: false });
  const note = (s: string) => { trail.push(`${Math.round(performance.now())} ${s}`); if (trail.length > 200) trail.shift(); };
  const replies = new Map<number, (v: unknown) => void>();

  // Spotify sometimes asks for a track's lyrics just before its metadata (the next track's
  // prefetch, 2026-11-09): wait for the metadata a little, then fall back to GraphQL details.
  const metaWaiters = new Map<string, ((m: TrackMeta) => void)[]>();
  const metaFor = (id: string): Promise<TrackMeta | undefined> => {
    const known = metas.get(id);
    if (known) return Promise.resolve(known);
    return new Promise((resolve) => {
      const done = (m?: TrackMeta) => { clearTimeout(timer); resolve(m); };
      const timer = setTimeout(() => {
        metaWaiters.set(id, (metaWaiters.get(id) ?? []).filter((w) => w !== done));
        const hint = hints.get(id);
        if (hint) note(`meta ${id} from graphql`);
        resolve(hint ? { ...hint, languages: [], hasLyrics: true } : undefined);
      }, timing.metaWaitMs);
      metaWaiters.set(id, [...(metaWaiters.get(id) ?? []), done]);
    });
  };
  let nextId = 1;

  const post = (msg: Up) => {
    if (ready || msg.kind === 'hello') win.postMessage(msg, win.location.origin);
    else outbox.push(msg);
  };
  /**
   * The last reports about songs. A copy of the content script that takes over in this page
   * (after an extension update) starts knowing nothing about the song playing or the one
   * already fetched: when it says it is ready, it is told again.
   */
  const recent: Up[] = [];
  const RECENT_MAX = 12;
  const emit = (type: string, data: unknown) => {
    const msg: Up = { tag: TAG, dir: 'up', kind: 'event', type, data };
    if (type !== 'error') {
      recent.push(msg);
      if (recent.length > RECENT_MAX) recent.shift();
    }
    post(msg);
  };
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
      spotifyOnly = new Set(config.spotifyOnly ?? []);
      configArrived();
      if (!ready) {
        ready = true;
        for (const m of outbox.splice(0)) win.postMessage(m, win.location.origin);
      } else if (msg.kind === 'ready') {
        for (const m of recent) win.postMessage(m, win.location.origin);
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
    if (meta.hasLyrics) return null;
    await settled();
    if (noLyrics.has(meta.id) || spotifyOnly.has(meta.id)) return null;
    // Claim lyrics so Spotify enables its Lyrics button and asks color-lyrics for them.
    return json({ ...raw, has_lyrics: true }, res);
  }

  /** The language whose script romanized lyrics stand in for, or null when they aren't romanized. */
  function romanizedLanguage(lines: string[], meta: TrackMeta, tag: string | null): string | null {
    if (songScript(lines) !== 'Latn') return null;
    const fromMeta = meta.languages.find((l) => expectedScript([l]));
    if (fromMeta) return fromMeta;
    // No (or a Latin) language in the metadata: judge by the words and Spotify's lyrics tag.
    const verdict = isLikelyRomanizedFallback(lines, tag);
    return verdict.romanized && verdict.lang && expectedScript([verdict.lang]) ? verdict.lang : null;
  }

  /**
   * Waits for a native-script copy: nativeMs for the song playing; for one not playing yet,
   * until it starts playing (then nativeMs more) or nativeAheadMs pass.
   */
  function nativeWithin(search: Promise<unknown>, meta: TrackMeta, ahead: boolean): Promise<unknown> {
    if (!ahead) return Promise.race([search, sleep(timing.nativeMs).then(() => null)]);
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        if (!playingNow(win.document, meta)) return;
        clearInterval(poll);
        sleep(timing.nativeMs).then(() => resolve(null));
      }, 250);
      search.then((v) => { clearInterval(poll); resolve(v); });
    });
  }

  async function onColorLyrics(res: Response, id: string): Promise<Response | null> {
    if (res.ok) {
      const raw = await res.clone().json();
      const l = parseColorLyrics(raw);
      if (!l) return null;
      note(`dense ${id} ${raw?.lyrics?.isDenseTypeface} lang=${raw?.lyrics?.language} provider=${raw?.lyrics?.providerDisplayName}`);
      const meta = await metaFor(id);
      await settled();
      note(`lyrics ${id} ${l.syncType} script=${songScript(l.lines, l.language)} meta=${meta ? 'yes' : 'no'}`);
      // Romanized lyrics for a song written in another script: restore the original script.
      const ours = !spotifyOnly.has(id);
      const lang = ours && meta ? romanizedLanguage(l.lines, meta, l.language) : null;
      if (meta && lang) {
        const ahead = !playingNow(win.document, meta);
        const native = (await nativeWithin(
          call('restoreNative', { meta: { ...meta, languages: [lang] }, lines: l.lines, times: l.times, synced: l.syncType !== 'UNSYNCED' }, timing.nativeAheadMs),
          meta,
          ahead,
        )) as NativeResult | null;
        if (ahead) note(`native ${id} asked ahead of play`);
        note(`native ${id} ${native ? (native.aligned ? 'aligned' : 'own-timing') + ' ' + native.source : 'none/late'}`);
        if (native) {
          emit('lyrics', { id, lines: native.lines.map((x) => x.text), language: lang, source: native.source, kind: 'restored' });
          return json(buildColorLyrics(native, lang, raw), res);
        }
      }
      // Unsynced lyrics: a synced copy elsewhere is better, as long as it is in the same script.
      if (l.syncType === 'UNSYNCED' && ours && meta) {
        const found = (await call('findLyrics', meta, timing.upgradeMs)) as FoundLyrics | null;
        const theirs = songScript(l.lines, l.language);
        if (found?.synced && (theirs === 'Latn' || songScript(found.lines.map((x) => x.text)) === theirs)) {
          emit('lyrics', { id, lines: found.lines.map((x) => x.text), language: l.language, source: found.source, kind: 'upgraded' });
          return json(buildColorLyrics(found, l.language, raw), res);
        }
      }
      emit('lyrics', { id, lines: l.lines, language: l.language, source: 'spotify', kind: 'spotify' });
      return null;
    }
    if (res.status !== 404) return null;
    await settled();
    if (spotifyOnly.has(id)) return null;
    const meta = await metaFor(id);
    if (!meta) return null;
    const found = (await call('findLyrics', meta, timing.lookupMs)) as FoundLyrics | null;
    note(`missing ${id} ${found?.lines.length ? (found.synced ? 'synced ' : 'unsynced ') + found.source : 'none'}`);
    emit('missing', { id, found: !!found?.lines.length });
    if (!found?.lines.length) return null;
    const language = meta.languages[0] ?? null;
    emit('lyrics', { id, lines: found.lines.map((l) => l.text), language, source: found.source, kind: 'found' });
    return json(buildColorLyrics(found, language), res);
  }

  function onGraphql(res: Response) {
    if (!res.ok) return;
    // Off the main path: Spotify gets its response now; we read the copy when we can.
    res.clone().json().then((j) => {
      const found = harvestTracks(j);
      for (const h of found) hints.set(h.id, h);
      if (found.length) note(`graphql ${found.length} tracks`);
      while (hints.size > 2000) hints.delete(hints.keys().next().value!);
    }, () => {});
  }

  const realFetch = win.fetch;
  win.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const res = await realFetch.apply(this, args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    try {
      const req = classify(url);
      if (req?.kind === 'metadata') return (await onMetadata(res)) ?? res;
      if (req?.kind === 'lyrics') return (await onColorLyrics(res, req.id)) ?? res;
      if (req?.kind === 'graphql') onGraphql(res);
    } catch (e) {
      emit('error', String((e as Error)?.message || e));
    }
    return res;
  } as typeof fetch;
}
