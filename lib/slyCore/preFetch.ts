// Port of: lyric-test/modules/core/pre-fetch.js

export interface PreFetchEntry {
  state: 'MISSING' | 'UNSYNCED' | 'ROMANIZED' | 'NATIVE_OK' | string;
  timestamp: number;
  title?: string;
  artist?: string;
  nativeStatus?: 'MISSING' | 'UNSYNCED' | 'ROMANIZED' | 'NATIVE_OK';
  customStatus?: 'SYNCED' | 'UNSYNCED' | 'MISSING';
  /** Reason of the report that last set nativeStatus (where it came from). */
  nativeReason?: string;
  /** nativeStatus is a local guess (e.g. no color-lyrics request seen), not Spotify's
   *  answer: never forwarded to the background for persistence. */
  heuristic?: boolean;
  [key: string]: unknown;
}

export interface SlyPreFetchRegistry {
  states: Map<string, PreFetchEntry>;
  register(uri: string, state: string, metadata?: Record<string, unknown>): void;
  getState(uri: string): PreFetchEntry | undefined;
  clearOldEntries(): void;
}

/** Reasons the detector records from on-screen rows or bridge fiber flags. */
function isDomOrBridgeEvidence(reason: string): boolean {
  return reason.startsWith('DOM Evidence') || reason.startsWith('Bridge ');
}

/**
 * Central Registry for Pre-fetched Track States.
 * Populated by the fetch interceptor (MAIN world → postMessage) and background
 * script responses. Used by the detector to decide whether to trigger a Layer 2
 * external lyrics fetch.
 */
export const slyPreFetchRegistry: SlyPreFetchRegistry = {
  states: new Map(), // uri → { state: 'MISSING' | 'UNSYNCED' | 'ROMANIZED', title, artist }

  register(uri: string, state: string, metadata: Record<string, unknown> = {}): void {
    if (!uri) return;

    const existing = this.states.get(uri) || { state: 'LOADING', timestamp: Date.now() };
    
    // Logic: If the new state is 'SYNCED' or 'UNSYNCED' coming from our fetch, 
    // we map it to customStatus. If it comes from the native report, it's nativeStatus.
    const isNativeReport = metadata.source === 'native';
    const reason = (metadata.reason as string) || (metadata.source === 'native' ? 'Network/DOM Discovery' : 'Cache/Fetch');

    const updated: PreFetchEntry = {
      ...existing,
      timestamp: Date.now(),
    };

    // Provenance: the interceptor saw Spotify's own response, and any verdict it
    // reported other than UNSYNCED implies syncType !== 'UNSYNCED'. DOM/bridge
    // evidence must not turn it into UNSYNCED. Self-heal, de-romanization and
    // WarmingEngine reasons still pass.
    const incomingNative = (metadata.nativeStatus as string | undefined) || (isNativeReport ? state : undefined);
    if (incomingNative === 'UNSYNCED' &&
        existing.nativeStatus !== undefined && existing.nativeStatus !== 'UNSYNCED' &&
        String(existing.nativeReason ?? '').startsWith('Network Intercept') &&
        isDomOrBridgeEvidence(reason)) {
      console.log(`[sly-prefetch] Kept ${existing.nativeStatus} (Network Intercept) for track ${uri}; ignored UNSYNCED from ${reason}.`);
      this.states.set(uri, updated);
      return;
    }

    const statePriority: Record<string, number> = {
      'NATIVE_OK': 3,
      'SYNCED': 3,
      'UNSYNCED': 2,
      'ROMANIZED': 1,
      'MISSING': 0,
      'LOADING': -1
    };

    const newPriority = statePriority[state] ?? 0;
    const oldPriority = statePriority[existing.state] ?? 0;

    if (newPriority >= oldPriority) {
        updated.state = state;
    } else {
        updated.state = existing.state;
    }

    // Merging Metadata: Only overwrite if the new values are actually defined
    if (metadata.title) updated.title = metadata.title as string;
    if (metadata.artist) updated.artist = metadata.artist as string;
    
    // Prioritize explicit status fields if provided in metadata
    let nativeAccepted = false;
    if (metadata.nativeStatus) {
        const newNativePriority = statePriority[metadata.nativeStatus as string] ?? 0;
        const oldNativePriority = statePriority[existing.nativeStatus || ''] ?? -1;
        if (newNativePriority >= oldNativePriority) {
            updated.nativeStatus = metadata.nativeStatus as any;
            nativeAccepted = true;
        }
    }
    if (metadata.customStatus) updated.customStatus = metadata.customStatus as any;

    // Fallback: If no explicit status was provided, use the 'state' argument
    if (isNativeReport && !metadata.nativeStatus) {
      const newNativePriority = statePriority[state] ?? 0;
      const oldNativePriority = statePriority[existing.nativeStatus || ''] ?? -1;
      if (newNativePriority >= oldNativePriority) {
        updated.nativeStatus = state as any;
        nativeAccepted = true;
      }
    } else if (!isNativeReport && !metadata.customStatus && (state === 'SYNCED' || state === 'UNSYNCED')) {
      updated.customStatus = state as any;
    }

    // Remember where nativeStatus came from and whether it is only a local guess.
    // A real report that confirms a guessed value clears the guess.
    if (nativeAccepted && (updated.nativeStatus !== existing.nativeStatus || (existing.heuristic && !metadata.heuristic))) {
      updated.nativeReason = reason;
      if (metadata.heuristic) updated.heuristic = true;
      else delete updated.heuristic;
    }

    // Log only real changes (repeated identical reports only refresh the timestamp).
    const changed = updated.state !== existing.state ||
      updated.nativeStatus !== existing.nativeStatus ||
      updated.customStatus !== existing.customStatus;
    if (changed) {
      console.log(`[sly-prefetch] Merged ${state} for track ${uri} | Native: ${updated.nativeStatus || 'N/A'} | Custom: ${updated.customStatus || 'N/A'} | Reason: ${reason}`);
    }
    this.states.set(uri, updated);
  },

  getState(uri: string): PreFetchEntry | undefined {
    return this.states.get(uri);
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
window.slyPreFetchInterval = window.setInterval(() => window.slyPreFetchRegistry.clearOldEntries(), 60000);
console.log('[sly] Pre-fetch registry and background cleanup interval (60s) initialized.');
