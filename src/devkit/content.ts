// The dev kit's relay in the content script: answers the ops that need the page's state,
// forwards the rest to the background. See protocol.ts.
import { DEVKIT_TAG, isDevReq, type DevAnswer, type DevBackgroundReq, type DevRes } from './protocol';

export type LocalOps = Record<string, (args: unknown) => unknown>;

export function serveDevkit(local: LocalOps, signal: AbortSignal): void {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window || !isDevReq(e.data)) return;
    const { id, op, args } = e.data;
    const answer = (r: Omit<DevRes, 'tag' | 'dir' | 'id'>) =>
      window.postMessage({ tag: DEVKIT_TAG, dir: 'res', id, ...r } satisfies DevRes, location.origin);
    const run = Object.hasOwn(local, op) ? Promise.resolve().then(() => local[op](args)) : toBackground(op, args);
    run.then(
      (value) => answer({ ok: true, value }),
      (err) => answer({ ok: false, error: String((err as Error)?.message || err) }),
    );
  }, { signal });
}

export async function toBackground(op: string, args?: unknown): Promise<unknown> {
  const res = (await chrome.runtime.sendMessage({ skDev: true, op, args } satisfies DevBackgroundReq)) as DevAnswer | undefined;
  if (!res) throw new Error(`${op}: the background didn't answer`);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}
