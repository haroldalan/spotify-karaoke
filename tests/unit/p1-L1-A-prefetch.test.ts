/**
 * Live round 1, group A1.4 (lib/slyCore/preFetch.ts register()):
 * - "Merged" is logged only when state, nativeStatus or customStatus changed;
 * - nativeReason / heuristic record where a nativeStatus came from;
 * - DOM/bridge UNSYNCED evidence cannot override a Network Intercept verdict.
 * Invented ids only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { slyPreFetchRegistry } from '../../lib/slyCore/preFetch';

const URI = 'spotify:track:L1aPrefetchTrack000001';
let logSpy: ReturnType<typeof vi.spyOn>;
const merges = () => logSpy.mock.calls.filter((c: any[]) => String(c[0]).startsWith('[sly-prefetch] Merged'));

beforeEach(() => {
  slyPreFetchRegistry.states.clear();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('register() log dedupe', () => {
  it('an identical repeated register() logs once but still refreshes the timestamp', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const meta = { source: 'native', nativeStatus: 'UNSYNCED', reason: 'Bridge isTimeSynced=false (full panel)' };
      slyPreFetchRegistry.register(URI, 'UNSYNCED', meta);
      const first = slyPreFetchRegistry.getState(URI)!.timestamp;
      vi.setSystemTime(Date.now() + 1000);
      slyPreFetchRegistry.register(URI, 'UNSYNCED', meta);
      slyPreFetchRegistry.register(URI, 'UNSYNCED', meta);
      expect(merges()).toHaveLength(1);
      expect(slyPreFetchRegistry.getState(URI)!.timestamp).toBe(first + 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs again when the custom status changes', () => {
    slyPreFetchRegistry.register(URI, 'MISSING', { source: 'native', reason: 'Network Intercept (404)' });
    slyPreFetchRegistry.register(URI, 'SYNCED', { customStatus: 'SYNCED', reason: 'FetchEngine Success' });
    slyPreFetchRegistry.register(URI, 'SYNCED', { customStatus: 'SYNCED', reason: 'FetchEngine Success' });
    expect(merges()).toHaveLength(2);
  });
});

describe('nativeStatus provenance', () => {
  it('DOM/bridge UNSYNCED evidence cannot override a Network Intercept ROMANIZED', () => {
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', reason: 'Network Intercept' });
    expect(slyPreFetchRegistry.getState(URI)?.nativeReason).toBe('Network Intercept');

    slyPreFetchRegistry.register(URI, 'UNSYNCED', { source: 'native', nativeStatus: 'UNSYNCED', reason: 'DOM Evidence (Unsynced)' });
    slyPreFetchRegistry.register(URI, 'UNSYNCED', { source: 'native', nativeStatus: 'UNSYNCED', reason: 'Bridge isTimeSynced=false (full panel)' });
    const entry = slyPreFetchRegistry.getState(URI)!;
    expect(entry.nativeStatus).toBe('ROMANIZED');
    expect(entry.state).toBe('ROMANIZED');
    expect(merges()).toHaveLength(1);
  });

  it('a later network ROMANIZED is still kept after such an attempt', () => {
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', reason: 'Network Intercept' });
    slyPreFetchRegistry.register(URI, 'UNSYNCED', { source: 'native', nativeStatus: 'UNSYNCED', reason: 'DOM Evidence (Unsynced)' });
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', reason: 'Network Intercept' });
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('ROMANIZED');
  });

  it('self-heal, de-romanization and WarmingEngine reasons still pass', () => {
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', reason: 'Network Intercept' });
    slyPreFetchRegistry.register(URI, 'UNSYNCED', { nativeStatus: 'UNSYNCED', reason: 'WarmingEngine Hydration' });
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('UNSYNCED');

    slyPreFetchRegistry.states.clear();
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', reason: 'Network Intercept' });
    slyPreFetchRegistry.register(URI, 'NATIVE_OK', { source: 'native', reason: 'De-Romanization Success' });
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('NATIVE_OK');
    expect(slyPreFetchRegistry.getState(URI)?.nativeReason).toBe('De-Romanization Success');
  });

  it('a network UNSYNCED is not blocked (and DOM evidence for it is a no-op)', () => {
    slyPreFetchRegistry.register(URI, 'UNSYNCED', { source: 'native', reason: 'Network Intercept' });
    slyPreFetchRegistry.register(URI, 'UNSYNCED', { source: 'native', nativeStatus: 'UNSYNCED', reason: 'DOM Evidence (Unsynced)' });
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('UNSYNCED');
    expect(slyPreFetchRegistry.getState(URI)?.nativeReason).toBe('Network Intercept');
  });

  it('DOM UNSYNCED evidence over a non-network ROMANIZED (forensic) still follows the priority rule', () => {
    slyPreFetchRegistry.register(URI, 'ROMANIZED', { source: 'native', nativeStatus: 'ROMANIZED', reason: 'Forensic DOM scan (romanized-hi)' });
    slyPreFetchRegistry.register(URI, 'UNSYNCED', { source: 'native', nativeStatus: 'UNSYNCED', reason: 'DOM Evidence (Unsynced)' });
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('UNSYNCED');
  });
});

describe('heuristic nativeStatus', () => {
  it('is flagged when set by a heuristic report and cleared by a real confirmation', () => {
    slyPreFetchRegistry.register(URI, 'MISSING', {
      source: 'native', nativeStatus: 'MISSING', reason: 'No color-lyrics request (4s)', heuristic: true,
    });
    expect(slyPreFetchRegistry.getState(URI)?.heuristic).toBe(true);

    // FetchEngine success (custom status only) keeps the guess flagged.
    slyPreFetchRegistry.register(URI, 'SYNCED', { customStatus: 'SYNCED', reason: 'FetchEngine Success' });
    expect(slyPreFetchRegistry.getState(URI)?.heuristic).toBe(true);
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('MISSING');

    // The interceptor's 404 confirms it.
    slyPreFetchRegistry.register(URI, 'MISSING', { source: 'native', reason: 'Network Intercept (404)' });
    const entry = slyPreFetchRegistry.getState(URI)!;
    expect(entry.nativeStatus).toBe('MISSING');
    expect(entry.heuristic).toBeUndefined();
    expect(entry.nativeReason).toBe('Network Intercept (404)');
  });

  it('a higher native status replaces the guess and drops the flag', () => {
    slyPreFetchRegistry.register(URI, 'MISSING', {
      source: 'native', nativeStatus: 'MISSING', reason: 'No color-lyrics request (4s)', heuristic: true,
    });
    slyPreFetchRegistry.register(URI, 'NATIVE_OK', { source: 'native', nativeStatus: 'NATIVE_OK', reason: 'Self-Heal (Live full-panel DOM evidence)' });
    expect(slyPreFetchRegistry.getState(URI)?.nativeStatus).toBe('NATIVE_OK');
    expect(slyPreFetchRegistry.getState(URI)?.heuristic).toBeUndefined();
  });
});
