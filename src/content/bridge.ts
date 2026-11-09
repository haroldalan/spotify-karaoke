// The content script's end of the page channel: answers the page script's calls and
// passes its reports on.
import { TAG, isUp, type Down, type PageConfig, type Up } from '../page/channel';
import type { FoundLyrics, NativeResult, TrackMeta } from '../shared/types';

export interface BridgeHandlers {
  findLyrics(meta: TrackMeta): Promise<FoundLyrics | null>;
  restoreNative(req: { meta: TrackMeta; lines: string[]; times: number[]; synced: boolean }): Promise<NativeResult | null>;
  onMeta(meta: TrackMeta): void;
  onLyrics(l: { id: string; lines: string[]; language: string | null; source: string }): void;
  onError(message: string): void;
}

export class Bridge {
  private config: PageConfig;

  constructor(private h: BridgeHandlers, config: PageConfig) {
    this.config = config;
    window.addEventListener('message', (e) => {
      if (e.source !== window || !isUp(e.data)) return;
      this.receive(e.data);
    });
    // In case the page script started first and said hello before we listened.
    this.send({ tag: TAG, dir: 'down', kind: 'ready', data: this.config });
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
      if (msg.type === 'meta') this.h.onMeta(msg.data as TrackMeta);
      else if (msg.type === 'lyrics') this.h.onLyrics(msg.data as Parameters<BridgeHandlers['onLyrics']>[0]);
      else if (msg.type === 'error') this.h.onError(String(msg.data));
    } else if (msg.kind === 'call' && (msg.type === 'findLyrics' || msg.type === 'restoreNative')) {
      const run = msg.type === 'findLyrics'
        ? this.h.findLyrics(msg.data as TrackMeta)
        : this.h.restoreNative(msg.data as Parameters<BridgeHandlers['restoreNative']>[0]);
      run.then(
        (v) => this.send({ tag: TAG, dir: 'down', kind: 'reply', id: msg.id, data: v }),
        () => this.send({ tag: TAG, dir: 'down', kind: 'reply', id: msg.id, data: null }),
      );
    }
  }
}
