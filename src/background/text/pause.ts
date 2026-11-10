// A pause that survives the service worker stopping. The worker stops after about 30 s
// idle; a pause kept only in memory is forgotten on the next wake, and Google would be
// asked again on every song, which keeps a block going. Kept in storage.local (the popup's
// Clear cache and Reset data clear it too: the listener asked for a fresh start).

export interface Pause {
  /** When asking may resume (ms since the epoch). */
  until: number;
  /** Consecutive pauses without a success in between: 1, 2, 4 ... minutes. */
  strikes: number;
}

const local = () => (globalThis as { chrome?: typeof chrome }).chrome?.storage?.local;
const key = (name: string) => `pause:${name}`;

export async function loadPause(name: string): Promise<Pause> {
  try {
    const v = (await local()?.get(key(name)))?.[key(name)] as Partial<Pause> | undefined;
    if (v && Number.isFinite(v.until) && Number.isFinite(v.strikes)) return { until: Number(v.until), strikes: Number(v.strikes) };
  } catch { /* no storage: in memory only */ }
  return { until: 0, strikes: 0 };
}

export function savePause(name: string, p: Pause): void {
  try {
    if (p.until || p.strikes) void local()?.set({ [key(name)]: p }).catch(() => {});
    else void local()?.remove(key(name)).catch(() => {});
  } catch { /* no storage */ }
}

/** The next pause: 1, 2, 4 ... up to 30 minutes. */
export function nextPause(strikes: number, now = Date.now()): Pause {
  const n = strikes + 1;
  return { until: now + Math.min(30, 2 ** (n - 1)) * 60_000, strikes: n };
}
