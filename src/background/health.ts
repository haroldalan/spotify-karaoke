// Whether each outside service is answering, for the popup's status section.
// Kept in memory and in storage.session (cleared when the browser closes).

export type Source = 'lrclib' | 'ytm' | 'google';

export interface SourceHealth {
  ok: boolean;
  /** When this was last seen (ms). */
  at: number;
  /** Why it failed, when it did. */
  detail?: string;
}

const KEY = 'health';
let state: Partial<Record<Source, SourceHealth>> = {};
let loaded = false;

const session = () => (globalThis as { chrome?: typeof chrome }).chrome?.storage?.session;

export function recordHealth(source: Source, ok: boolean, detail?: string) {
  state[source] = { ok, at: Date.now(), ...(detail ? { detail: detail.slice(0, 200) } : {}) };
  void session()?.set({ [KEY]: state }).catch(() => {});
}

export async function getHealth(): Promise<Partial<Record<Source, SourceHealth>>> {
  if (!loaded) {
    loaded = true;
    const stored = (await session()?.get(KEY).catch(() => undefined))?.[KEY] as typeof state | undefined;
    state = { ...stored, ...state };
  }
  return state;
}

/** Wraps a request to a source: records success, or failure with its reason. */
export async function tracked<T>(source: Source, run: () => Promise<T>): Promise<T> {
  try {
    const v = await run();
    recordHealth(source, true);
    return v;
  } catch (e) {
    recordHealth(source, false, String((e as Error)?.message || e));
    throw e;
  }
}
