/**
 * Test hooks for live testing: switches that simulate outages the tester cannot
 * cause (Google Translate down, the Japanese dictionary unreachable).
 *
 * They exist only in debug builds (`SLY_DEBUG=1`, see wxt.config.ts, which defines
 * __SLY_TEST_HOOKS__). In store builds TEST_HOOKS_ENABLED is the constant false and
 * every hook is a no-op that the bundler drops.
 *
 * From the Spotify page console (debug build):
 *   window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_TEST_HOOK',
 *     requestId: 'x', payload: { op: 'fault', name: 'google', on: true } } }, '*')
 * The answer comes back as a SLY_TEST_HOOK_RESPONSE action with the same requestId.
 * Ops: { op: 'ping' }, { op: 'fault', name, on }, { op: 'faults' }, { op: 'reload' }
 * (reloads the extension, e.g. after a rebuild).
 * Faults are kept in storage.session, so they survive a service-worker restart
 * and end with the browser session.
 */

export const TEST_HOOKS_ENABLED: boolean =
  typeof __SLY_TEST_HOOKS__ !== 'undefined' && __SLY_TEST_HOOKS__ === true;

export type FaultName = 'google' | 'japaneseDictionary';
const FAULT_NAMES: readonly FaultName[] = ['google', 'japaneseDictionary'];
const STORAGE_KEY = 'sly_test_faults';

async function readFaults(): Promise<FaultName[]> {
  try {
    const stored = await browser.storage.session.get(STORAGE_KEY);
    const list = stored?.[STORAGE_KEY];
    return Array.isArray(list) ? list.filter((f): f is FaultName => FAULT_NAMES.includes(f)) : [];
  } catch {
    return [];
  }
}

/** Whether a simulated outage is switched on. Always false outside debug builds. */
export async function hasFault(name: FaultName): Promise<boolean> {
  if (!TEST_HOOKS_ENABLED) return false;
  return (await readFaults()).includes(name);
}

export interface TestHookPayload {
  op?: string;
  name?: string;
  on?: boolean;
}

/** Background handler for SLY_TEST_HOOK messages. */
export async function handleTestHook(payload: TestHookPayload | undefined): Promise<Record<string, unknown>> {
  if (!TEST_HOOKS_ENABLED) return { ok: false, error: 'test hooks are not in this build' };
  const op = payload?.op;
  if (op === 'ping') return { ok: true, faults: await readFaults() };
  if (op === 'faults') return { ok: true, faults: await readFaults() };
  if (op === 'reload') {
    // Picks up a rebuilt .output folder without a click on the extensions page.
    // Reload the Spotify tab afterwards: its content scripts are orphaned.
    setTimeout(() => browser.runtime.reload(), 100);
    return { ok: true, reloading: true };
  }
  if (op === 'fault') {
    const name = payload?.name as FaultName;
    if (!FAULT_NAMES.includes(name)) return { ok: false, error: `unknown fault "${String(payload?.name)}"`, known: FAULT_NAMES };
    const faults = new Set(await readFaults());
    if (payload?.on) faults.add(name);
    else faults.delete(name);
    await browser.storage.session.set({ [STORAGE_KEY]: [...faults] });
    console.warn(`[SKaraoke:TestHook] fault "${name}" ${payload?.on ? 'ON' : 'off'}`);
    return { ok: true, faults: [...faults] };
  }
  return { ok: false, error: `unknown op "${String(op)}"` };
}

/**
 * Debug builds only: records that something ran, as "name@ms" on <html data-sly-trace>
 * (last 60 entries), so a recorder in the page can line extension activity up with
 * what is on screen frame by frame. No-op in store builds.
 */
export function traceEvent(name: string): void {
  if (!TEST_HOOKS_ENABLED) return;
  try {
    const el = document.documentElement;
    const entries = (el.getAttribute('data-sly-trace') || '').split('|').filter(Boolean);
    entries.push(`${name}@${Math.round(performance.now())}`);
    el.setAttribute('data-sly-trace', entries.slice(-60).join('|'));
  } catch { /* tracing never breaks anything */ }
}
