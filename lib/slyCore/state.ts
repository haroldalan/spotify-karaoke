// Port of: lyric-test/modules/core/state.js

export interface SpotifyBridgeState {
  track: Record<string, unknown> | null;
  lyricsProvider: string | null;
  isTimeSynced: boolean | undefined;
  syncType: string | null;
  isPanelOpen: boolean;
  nativeHasLyrics: boolean;
  detectionMethod: string;
  lastBridgeChangeTime: number;
  // Added dynamically by bridge listener:
  accessToken?: string;
  queue?: unknown[];
}

export interface SlyInternalState {
  lastTitle: string;
  lastUri: string;
  currentLyrics: unknown | null;
  customRoot: HTMLElement | null;
  syncAnimFrame: number | null;
  lastDecision: string;
  fetchGeneration: number;
  isUserScrolling: boolean;
  lastActiveIndex: number;
  fetchingForTitle: string;
  fetchingForUri: Set<string>;
  pendingLyricsData: unknown | null;
  songChangeTime: number;
  songSettlingUntil: number;
  panelOpenTime: number;
  statusHUDActive: boolean;
  isFetchingHUD: boolean;
  isAdHUDActive: boolean;
  // Added dynamically by detector:
  forceFallback?: boolean;
  // Added dynamically by messaging:
  isSpotifyFetching?: boolean;
  interceptorActive?: boolean;
  interceptorFailed?: boolean;
  nativeUpgradedLines?: string[];
  /** Set by setupSlyBridge when Pipeline B's syncedLyricsRenderer is running.
   *  slyUpdateSync reads this and yields immediately so both loops don't
   *  fight over className on the same elements. */
  slySyncedRendererActive?: boolean;
  nativeRecoveryPending?: boolean;
  userScrollTimeout?: number;
  isTransitioning?: boolean;
  /** L0 Session Cache: Synchronous in-memory store for lyrics objects.
   *  Eliminates async fetch delays for repeated tracks in the same session. */
  l0Cache: Map<string, any>;
  /** Timestamp until which automatic panel detection/takeover is suppressed.
   *  Used to prevent "re-opening flicker" when closing panels. */
  panelIntentCooldown: number;
  lastResolvedStateString?: string;
}

declare global {
  interface Window {
    spotifyState: any;
    slyInternalState: any;
    antigravityInterval?: any;
    antigravitySyncAnimFrame?: number;
    slyStartThrottledPoll?: () => void;
    slyCheckNowPlaying?: () => Promise<void>;
    slyResetPlayerState?: (title: string, uri?: string) => void;
    slyDetectNativeState?: () => Promise<any>;
    slyTriggerLyricsFetch?: (...args: any[]) => void;
    slyPreFetchRegistry?: any;
    slyPreFetchInterval?: any;
    slyInjectCoreStyles?: () => void;
    slyDeepScavengeStyles?: () => void;
    SPOTIFY_CLASSES?: any;
    slyUpdateButtonState?: (m: string) => void;
    slyGetCoreStyles?: () => string;
  }
}

declare const browser: any;

/**
 * Live track and lyrics state populated by the MAIN-world scanner (slyBridge.js)
 * via SLY_BRIDGE postMessages. Updated on every scanner tick (every 600ms).
 */
export const spotifyState: SpotifyBridgeState = {
  track: null,
  lyricsProvider: null,
  isTimeSynced: undefined,
  syncType: null,
  isPanelOpen: false,
  nativeHasLyrics: false, // BUG-31 Fix: Pessimistic initial state prevents "Blank Panel" stand-down race.
  detectionMethod: 'Initializing...',
  lastBridgeChangeTime: 0,
};

// SLY FIX (BUG-41): Assigning to window by reference ensures module imports and
// global lookups stay in sync. DO NOT replace the object reference in listeners.
window.spotifyState = spotifyState as unknown as Record<string, unknown>;

/**
 * Extension's own operational state — tracks what the extension is currently
 * doing (injecting, syncing, what it has fetched, generation counter for
 * async race condition protection).
 */
export const slyInternalState: SlyInternalState = {
  lastTitle: '',
  lastUri: '',
  currentLyrics: null,
  customRoot: null,
  syncAnimFrame: null,
  lastDecision: '',
  fetchGeneration: 0,
  isUserScrolling: false,
  lastActiveIndex: -1,
  fetchingForTitle: '',
  fetchingForUri: new Set<string>(),
  pendingLyricsData: null,
  songChangeTime: Date.now(),
  songSettlingUntil: 0,
  panelOpenTime: 0,
  statusHUDActive: false,
  isFetchingHUD: false,
  isAdHUDActive: false,
  l0Cache: new Map(),
  interceptorActive: false,
  interceptorFailed: false,
  panelIntentCooldown: 0,
  lastResolvedStateString: '',
};

window.slyInternalState = slyInternalState;

/**
 * Registers the SLY_BRIDGE window message listener.
 * Must be called once from the content script entry point (after isContextValid check).
 *
 * The listener receives postMessages from slyBridge.js (MAIN world) and
 * updates window.spotifyState in the isolated world. Also dispatches
 * a 'sly_state_update' CustomEvent so other modules can react.
 */
export function initSlyState(): void {
  window.addEventListener('message', (event) => {
    // Security: Only accept messages from the same window (MAIN world bridge)
    if (event.source !== window) return;

    if ((event.data as Record<string, unknown>)?.source === 'SLY_BRIDGE') {
      const data = (event.data as { source: string; data: Record<string, unknown> }).data;
      
      // BUG-41 Fix: Mutate the existing object by reference instead of potentially 
      // replacing window.spotifyState with a new object literal. This ensures 
      // that modules which imported 'spotifyState' at boot time see the updates.
      const state = spotifyState as unknown as Record<string, unknown>;
      
      state.track = data.track as Record<string, unknown> | null;
      state.lyricsProvider = data.lyricsProvider as string | null;
      state.isTimeSynced = data.isTimeSynced as boolean;
      state.syncType = data.syncType as string | null;
      state.isPanelOpen = data.isPanelActive as boolean;
      state.nativeHasLyrics = data.nativeHasLyrics as boolean;
      state.detectionMethod = data.detectionMethod as string;
      state.lastBridgeChangeTime = data.lastBridgeChangeTime as number;
      
      if (data.accessToken) state.accessToken = data.accessToken as string;
      if (data.queue) state.queue = data.queue as unknown[];

      window.dispatchEvent(new CustomEvent('sly_state_update', { detail: spotifyState }));
    }
  });

  console.log('[sly] State Module: SLY_BRIDGE Listener Active.');
}

