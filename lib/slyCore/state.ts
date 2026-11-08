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
  /** Spotify's lyrics language tag from the bridge, normalised to a bare lowercase
   *  primary subtag ('ja-JP' → 'ja'), or null. Unreliable for romanized lyrics
   *  (e.g. romanized Hindi is tagged 'id'): treat it as a hint only. */
  language?: string | null;
  /** DIAGNOSTIC only (L1 round): the first string `trackUri` prop on the full-panel
   *  lyric line's fiber chain, or null (no full-panel line, or no such prop). No
   *  decision may depend on it yet. */
  lyricsTrackUri?: string | null;
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
  failedFetchUris: Set<string>;
  /** When slyCore's check last saw an ad playing (Date.now()); 0: none yet. */
  lastAdSeenAt: number;
  pendingLyricsData: unknown | null;
  songChangeTime: number;
  songSettlingUntil: number;
  panelOpenTime: number;
  statusHUDActive: boolean;
  isFetchingHUD: boolean;
  // Added dynamically by detector:
  forceFallback?: boolean;
  // Added dynamically by messaging:
  isSpotifyFetching?: boolean;
  /** True only between SLY_INTERCEPT_START and SLY_INTERCEPT_END (a color-lyrics
   *  rewrite is in flight). Never set by the heartbeat. */
  interceptorActive?: boolean;
  /** Heartbeat: the MAIN-world interceptor has answered SLY_INTERCEPTOR_READY at
   *  least once this page load. Not cleared on track changes. */
  interceptorReady?: boolean;
  /** K5: Layer-1 (native-script) lookups that have not reported back yet,
   *  keyed by Spotify track id → expiry time (ms). Unlike interceptorActive this
   *  outlives SLY_INTERCEPT_END: on a hold-budget expiry the lookup keeps running and
   *  ends later with SKL_NATIVE_LYRICS or SLY_FORCE_FALLBACK. See markNativeLookupPending. */
  nativeLookupPendingUntil: Map<string, number>;
  /** Spotify track ids for which a color-lyrics request (or any interceptor message
   *  about one) was seen this page load → last seen time (ms). Keyed by the message's
   *  own track id, never the current track's. LRU-capped (COLOR_LYRICS_SEEN_CAP). */
  colorLyricsSeenAt: Map<string, number>;
  /** Why slyPrepareContainer last returned null for fetched lyrics (e.g. 'lyrics-style-unknown'). */
  lastPrepareRefusal?: string | null;
  /** Track id whose SLY_FETCH_START set isSpotifyFetching (cleared by its SLY_FETCH_END). */
  spotifyFetchingTrackId?: string;
  interceptorFailed?: boolean;
  nativeUpgradedLines?: string[];
  /** Set by setupSlyBridge when Pipeline B's syncedLyricsRenderer is running.
   *  slyUpdateSync reads this and yields immediately so both loops don't
   *  fight over className on the same elements. */
  slySyncedRendererActive?: boolean;
  nativeRecoveryPending?: boolean;
  userScrollTimeout?: number;
  isTransitioning?: boolean;
  /**
   * The next song's lyrics are ours and cached (set at the song change by Pipeline B's
   * onSongChange): the poll injects them as soon as the bridge names that song, without
   * waiting for Spotify's panel to load. Not cleared by slyResetPlayerState (the bridge
   * may still name the previous song when a reset runs).
   */
  stagedTakeover?: { uri: string; prevUri?: string; data: Record<string, unknown> } | null;
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
    /** Runs the slyCore check now (content.ts); the lyrics view reopened. */
    slyKickPoll?: () => void;
    antigravitySyncAnimFrame?: number;
    slyStartThrottledPoll?: () => void;
    slyCheckNowPlaying?: () => Promise<void>;
    slyPreFetchRegistry?: any;
    slyPreFetchInterval?: any;
    slyGetCoreStyles?: () => string;
    /** Pipeline B's runtime lyrics cache (lib/core/lyricsCache.ts), exposed on window. */
    slyRuntimeCache?: Map<string, any>;
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
  language: null,
  lyricsTrackUri: null,
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
  failedFetchUris: new Set<string>(),
  lastAdSeenAt: 0,
  pendingLyricsData: null,
  songChangeTime: Date.now(),
  songSettlingUntil: 0,
  panelOpenTime: 0,
  statusHUDActive: false,
  isFetchingHUD: false,
  l0Cache: new Map(),
  interceptorActive: false,
  interceptorReady: false,
  nativeLookupPendingUntil: new Map(),
  colorLyricsSeenAt: new Map(),
  interceptorFailed: false,
  panelIntentCooldown: 0,
  lastResolvedStateString: '',
};

window.slyInternalState = slyInternalState;

/**
 * K5: how long a Layer-1 lookup counts as pending after the interceptor starts it:
 * the 4000ms hold budget plus time for a late finish. A lookup that never reports
 * back (interceptor exception, superseded lookup) simply expires.
 */
export const NATIVE_LOOKUP_PENDING_MS = 10_000;

function nativeLookupPendingMap(): Map<string, number> {
  const s = (window.slyInternalState ?? slyInternalState) as SlyInternalState;
  if (!(s.nativeLookupPendingUntil instanceof Map)) s.nativeLookupPendingUntil = new Map();
  return s.nativeLookupPendingUntil;
}

/** Marks the track's Layer-1 (native-script upgrade) result as pending. */
export function markNativeLookupPending(trackId: string | null | undefined, now = Date.now()): void {
  if (!trackId) return;
  const pending = nativeLookupPendingMap();
  for (const [id, until] of pending) {
    if (until <= now) pending.delete(id);
  }
  pending.set(trackId, now + NATIVE_LOOKUP_PENDING_MS);
}

/**
 * Layer 1 reported back for the track (SKL_NATIVE_LYRICS or SLY_FORCE_FALLBACK).
 * Returns true if the lookup was still pending (marked and not yet expired).
 */
export function clearNativeLookupPending(trackId: string | null | undefined, now = Date.now()): boolean {
  if (!trackId) return false;
  const pending = nativeLookupPendingMap();
  const until = pending.get(trackId);
  pending.delete(trackId);
  return until !== undefined && until > now;
}

/** How long after the last ad check a song change still counts as leaving an ad (checks run every 500 ms). */
export const AD_RECENT_MS = 2000;

/**
 * An ad is playing or has just ended: a song change now leaves the ad, which has nothing on
 * a lyrics slide (songTransition). Neither lastTitle (trySetup rewrites it during the ad)
 * nor the track ids (none during an ad) tell this reliably.
 */
export function isLeavingAnAd(now = Date.now()): boolean {
  const at = window.slyInternalState?.lastAdSeenAt ?? 0;
  return at > 0 && now - at < AD_RECENT_MS;
}

/** True while the track's Layer-1 lookup is still running (including a late finish after SLY_INTERCEPT_END). */
export function isNativeLookupPending(trackId: string | null | undefined, now = Date.now()): boolean {
  if (!trackId) return false;
  const pending = nativeLookupPendingMap();
  const until = pending.get(trackId);
  if (until === undefined) return false;
  if (until <= now) {
    pending.delete(trackId);
    return false;
  }
  return true;
}

/** Upper bound of the color-lyrics "seen" map (oldest entries are evicted first). */
export const COLOR_LYRICS_SEEN_CAP = 500;

function colorLyricsSeenMap(): Map<string, number> {
  const s = (window.slyInternalState ?? slyInternalState) as SlyInternalState;
  if (!(s.colorLyricsSeenAt instanceof Map)) s.colorLyricsSeenAt = new Map();
  return s.colorLyricsSeenAt;
}

/**
 * Records that Spotify requested color-lyrics for this track id (or the interceptor
 * reported on it). Call with the message's own id: a next-track prefetch counts for
 * that track once it becomes current.
 */
export function recordColorLyricsSeen(trackId: unknown, now = Date.now()): void {
  if (typeof trackId !== 'string' || !trackId) return;
  const seen = colorLyricsSeenMap();
  seen.delete(trackId); // re-insert so the Map's order stays least-recently-seen first
  seen.set(trackId, now);
  while (seen.size > COLOR_LYRICS_SEEN_CAP) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

/** True if a color-lyrics request (or interceptor report) for this track id was seen this page load. */
export function wasColorLyricsSeen(trackId: string | null | undefined): boolean {
  if (!trackId) return false;
  return colorLyricsSeenMap().has(trackId);
}

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

    const msg = event.data as Record<string, unknown> | undefined;
    if (msg?.source !== 'SLY_ACTION_GATEWAY') return;
    const action = msg.action as { type?: string; payload?: any } | undefined;
    if (action?.type !== 'SLY_TRACK_UPDATE') return;

    const data = action.payload;
    if (!data) return;
    
    // BUG-41 Fix: Mutate the existing object by reference instead of potentially 
    // replacing window.spotifyState with a new object literal. This ensures 
    // that modules which imported 'spotifyState' at boot time see the updates.
    const state = spotifyState as unknown as Record<string, unknown>;
    const previousUri = (state.track as Record<string, unknown> | null)?.uri;
    
    state.track = data.track as Record<string, unknown> | null;
    state.lyricsProvider = data.lyricsProvider as string | null;
    state.isTimeSynced = data.isTimeSynced as boolean;
    state.syncType = data.syncType as string | null;
    state.isPanelOpen = data.isPanelActive as boolean;
    state.nativeHasLyrics = data.nativeHasLyrics as boolean;
    state.detectionMethod = data.detectionMethod as string;
    state.lastBridgeChangeTime = data.lastBridgeChangeTime as number;
    
    // K2: the bridge reads `language` from lyric-line fibers, so it reports null
    // whenever no lyric component is mounted (e.g. panel closed). Keep the last
    // known tag while the track is unchanged; reset it on a track change.
    const language = normalizeLanguageTag(data.language);
    const currentUri = (state.track as Record<string, unknown> | null)?.uri;
    if (language !== null || currentUri !== previousUri) state.language = language;
    state.lyricsTrackUri = typeof data.lyricsTrackUri === 'string' ? data.lyricsTrackUri : null;

    if (data.accessToken) state.accessToken = data.accessToken as string;
    if (data.queue) state.queue = data.queue as unknown[];

    window.dispatchEvent(new CustomEvent('sly_state_update', { detail: spotifyState }));
  });

  initSlyCacheResetListener();

  console.log('[sly] State Module: SLY_BRIDGE Listener Active.');
}

/** 'ja-JP' / 'ja_JP' / 'JA' → 'ja'; anything that is not a non-empty string → null. */
export function normalizeLanguageTag(tag: unknown): string | null {
  if (typeof tag !== 'string') return null;
  const primary = tag.trim().split(/[-_]/)[0].toLowerCase();
  return primary || null;
}

/** K7: drop this content script's in-memory lyrics caches (L0 session cache and Pipeline B's runtime cache). */
export function clearSlyRuntimeCaches(): void {
  slyInternalState.l0Cache.clear();
  const runtimeCache = window.slyRuntimeCache;
  if (runtimeCache && typeof runtimeCache.clear === 'function') runtimeCache.clear();
  console.log('[sly] Cache reset: cleared L0 session cache and runtime cache.');
}

let cacheResetListenerAttached = false;

/** K7: the popup writes `sly_cacheResetAt` to storage.local after wiping stored lyrics. */
function initSlyCacheResetListener(): void {
  if (cacheResetListenerAttached) return;
  if (typeof browser === 'undefined' || !browser?.storage?.onChanged?.addListener) return;
  cacheResetListenerAttached = true;
  browser.storage.onChanged.addListener((changes: Record<string, unknown> | undefined, areaName?: string) => {
    if (areaName && areaName !== 'local') return;
    if (!changes || !Object.prototype.hasOwnProperty.call(changes, 'sly_cacheResetAt')) return;
    clearSlyRuntimeCaches();
  });
}
