// Port of: lyric-test/modules/core/state.js

export interface SpotifyBridgeState {
  track: Record<string, unknown> | null;
  lyricsProvider: string | null;
  isTimeSynced: boolean;
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
  fetchingForUri: string;
  pendingLyricsData: unknown | null;
  trackChangeTime: number;
  panelOpenTime: number;
  statusHUDActive: boolean;
  isFetchingHUD: boolean;
  isAdHUDActive: boolean;
  // Added dynamically by detector:
  forceFallback?: boolean;
  // Added dynamically by messaging:
  isSpotifyFetching?: boolean;
  interceptorActive?: boolean;
  nativeUpgradedLines?: string[];
  /** Set by setupSlyBridge when Pipeline B's syncedLyricsRenderer is running.
   *  slyUpdateSync reads this and yields immediately so both loops don't
   *  fight over className on the same elements. */
  slySyncedRendererActive?: boolean;
}

declare global {
  interface Window {
    spotifyState: SpotifyBridgeState;
    slyInternalState: SlyInternalState;
    antigravityInterval?: NodeJS.Timeout | number;
    antigravitySyncAnimFrame?: number;
  }
}

/**
 * Live track and lyrics state populated by the MAIN-world scanner (slyBridge.js)
 * via SLY_BRIDGE postMessages. Updated on every scanner tick (every 600ms).
 */
export const spotifyState: SpotifyBridgeState = {
  track: null,
  lyricsProvider: null,
  isTimeSynced: false,
  syncType: null,
  isPanelOpen: false,
  nativeHasLyrics: true,
  detectionMethod: 'Initializing...',
  lastBridgeChangeTime: 0,
};

window.spotifyState = spotifyState;

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
  fetchingForUri: '',
  pendingLyricsData: null,
  trackChangeTime: Date.now(),
  panelOpenTime: 0,
  statusHUDActive: false,
  isFetchingHUD: false,
  isAdHUDActive: false,
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
    if ((event.data as Record<string, unknown>)?.source === 'SLY_BRIDGE') {
      const { track, lyricsProvider, isTimeSynced, syncType, isPanelActive, accessToken, queue } =
        (event.data as { source: string; data: Record<string, unknown> }).data;

      window.spotifyState.track = track as Record<string, unknown> | null;
      window.spotifyState.lyricsProvider = lyricsProvider as string | null;
      window.spotifyState.isTimeSynced = isTimeSynced as boolean;
      window.spotifyState.syncType = syncType as string | null;
      window.spotifyState.isPanelOpen = isPanelActive as boolean;
      if (accessToken) window.spotifyState.accessToken = accessToken as string;
      if (queue) window.spotifyState.queue = queue as unknown[];

      window.dispatchEvent(new CustomEvent('sly_state_update', { detail: window.spotifyState }));
    }
  });

  console.log('[sly] State Module: SLY_BRIDGE Listener Active.');
}
