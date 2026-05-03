// Port of: lyric-test/modules/core/pre-fetch.js

export interface PreFetchEntry {
  state: 'MISSING' | 'UNSYNCED' | 'ROMANIZED' | 'NATIVE_OK' | string;
  timestamp: number;
  title?: string;
  artist?: string;
  nativeMissing?: boolean;
  [key: string]: unknown;
}

export interface SlyPreFetchRegistry {
  states: Map<string, PreFetchEntry>;
  register(trackId: string, state: string, metadata?: Record<string, unknown>): void;
  getState(trackId: string): PreFetchEntry | undefined;
  clearOldEntries(): void;
}

declare global {
  interface Window {
    slyPreFetchRegistry: SlyPreFetchRegistry;
  }
}

/**
 * Central Registry for Pre-fetched Track States.
 * Populated by the fetch interceptor (MAIN world → postMessage) and background
 * script responses. Used by the detector to decide whether to trigger a Layer 2
 * external lyrics fetch.
 */
export const slyPreFetchRegistry: SlyPreFetchRegistry = {
  states: new Map(), // trackId → { state: 'MISSING' | 'UNSYNCED' | 'ROMANIZED', title, artist }

  register(trackId: string, state: string, metadata: Record<string, unknown> = {}): void {
    if (!trackId) return;
    if (!metadata) metadata = {};

    console.log(`[sly-prefetch] Registered ${state} for track ${trackId}`);
    this.states.set(trackId, {
      state,
      timestamp: Date.now(),
      ...metadata,
    });
  },

  getState(trackId: string): PreFetchEntry | undefined {
    return this.states.get(trackId);
  },

  clearOldEntries(): void {
    const now = Date.now();
    const MAX_AGE = 10 * 60 * 1000; // 10 minutes
    for (const [id, data] of this.states.entries()) {
      if (now - data.timestamp > MAX_AGE) {
        this.states.delete(id);
      }
    }
  },
};

window.slyPreFetchRegistry = slyPreFetchRegistry;

// Periodic cleanup
setInterval(() => window.slyPreFetchRegistry.clearOldEntries(), 60000);
