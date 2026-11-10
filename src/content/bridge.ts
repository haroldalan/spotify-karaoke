// The content script's end of the page channel: answers the page script's calls and
// passes its reports on.
import { TAG, isUp, type Down, type LyricsKind, type PageConfig, type Up } from '../page/channel';
import type { FoundLyrics, NativeResult, TrackMeta } from '../shared/types';
import { isNativeRequest, isTrackMeta } from '../shared/validate';

export interface BridgeHandlers {
  findLyrics(meta: TrackMeta): Promise<FoundLyrics | null>;
  restoreNative(req: { meta: TrackMeta; lines: string[]; times: number[]; synced: boolean }): Promise<NativeResult | null>;
  onMeta(meta: TrackMeta): void;
  onLyrics(l: { id: string; lines: string[]; language: string | null; source: string; kind: LyricsKind }): void;
  /** Spotify had no lyrics for a song and asked for them: whether we found any. */
  onMissing(m: { id: string; found: boolean }): void;
  onError(message: string): void;
  /** The page script is running in this page (before any song went by). */
  onAlive?(): void;
}

export class Bridge {
  private config: PageConfig;

  constructor(private h: BridgeHandlers, config: PageConfig) {
    this.config = config;
    window.addEventListener('message', this.onMessage);
    // In case the page script started first and said hello before we listened.
    this.send({ tag: TAG, dir: 'down', kind: 'ready', data: this.config });
  }

  private onMessage = (e: MessageEvent) => {
    if (e.source !== window || !isUp(e.data)) return;
    this.receive(e.data);
  };

  /** Stops listening to the page. */
  dispose() {
    window.removeEventListener('message', this.onMessage);
  }

  setConfig(config: PageConfig) {
    this.config = config;
    this.send({ tag: TAG, dir: 'down', kind: 'config', data: config });
  }

  private send(msg: Down) {
    window.postMessage(msg, window.location.origin);
  }

  private receive(msg: Up) {
    if (msg.kind === 'hello') {
      this.send({ tag: TAG, dir: 'down', kind: 'ready', data: this.config });
    } else if (msg.kind === 'event') {
      if (msg.type === 'meta') { if (isTrackMeta(msg.data)) this.h.onMeta(msg.data); }
      else if (msg.type === 'lyrics') this.h.onLyrics(msg.data as Parameters<BridgeHandlers['onLyrics']>[0]);
      else if (msg.type === 'missing') {
        const m = msg.data as { id?: unknown; found?: unknown };
        if (typeof m?.id === 'string' && typeof m.found === 'boolean') this.h.onMissing({ id: m.id, found: m.found });
      }
      else if (msg.type === 'error') this.h.onError(String(msg.data));
      else if (msg.type === 'alive') this.h.onAlive?.();
    } else if (msg.kind === 'call' && (msg.type === 'findLyrics' || msg.type === 'restoreNative')) {
      // Only well-formed requests reach the background; anything else is answered with null.
      const run =
        msg.type === 'findLyrics'
          ? isTrackMeta(msg.data) ? this.h.findLyrics(msg.data) : Promise.resolve(null)
          : isNativeRequest(msg.data) ? this.h.restoreNative(msg.data) : Promise.resolve(null);
      run.then(
        (v) => this.send({ tag: TAG, dir: 'down', kind: 'reply', id: msg.id, data: v }),
        () => this.send({ tag: TAG, dir: 'down', kind: 'reply', id: msg.id, data: null }),
      );
    }
  }
}
