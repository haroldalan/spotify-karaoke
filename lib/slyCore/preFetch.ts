// Port of: lyric-test/modules/core/pre-fetch.js

export interface PreFetchEntry {
  state: 'MISSING' | 'UNSYNCED' | 'ROMANIZED' | 'NATIVE_OK' | string;
  timestamp: number;
  title?: string;
  artist?: string;
  nativeStatus?: 'MISSING' | 'UNSYNCED' | 'ROMANIZED' | 'NATIVE_OK';
  customStatus?: 'SYNCED' | 'UNSYNCED' | 'MISSING';
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

    const existing = this.states.get(trackId) || { state: 'LOADING', timestamp: Date.now() };
    
    // Logic: If the new state is 'SYNCED' or 'UNSYNCED' coming from our fetch, 
    // we map it to customStatus. If it comes from the native report, it's nativeStatus.
    const isNativeReport = metadata.source === 'native';
    
    const updated: PreFetchEntry = {
      ...existing,
      state: state || existing.state,
      timestamp: Date.now(),
    };

    // Merging Metadata: Only overwrite if the new values are actually defined
    if (metadata.title) updated.title = metadata.title as string;
    if (metadata.artist) updated.artist = metadata.artist as string;
    
    // Prioritize explicit status fields if provided in metadata
    if (metadata.nativeStatus) updated.nativeStatus = metadata.nativeStatus as any;
    if (metadata.customStatus) updated.customStatus = metadata.customStatus as any;

    // Fallback: If no explicit status was provided, use the 'state' argument
    if (isNativeReport && !metadata.nativeStatus) {
      updated.nativeStatus = state as any;
    } else if (!isNativeReport && !metadata.customStatus && (state === 'SYNCED' || state === 'UNSYNCED')) {
      updated.customStatus = state as any;
    }

    const reason = (metadata.reason as string) || (metadata.source === 'native' ? 'Network/DOM Discovery' : 'Cache/Fetch');
    console.log(`[sly-prefetch] Merged ${state} for track ${trackId} | Native: ${updated.nativeStatus || 'N/A'} | Custom: ${updated.customStatus || 'N/A'} | Reason: ${reason}`);
    this.states.set(trackId, updated);
  },

  getState(trackId: string): PreFetchEntry | undefined {
    return this.states.get(trackId);
  },

  clearOldEntries(): void {
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
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
