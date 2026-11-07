// Port of: lyric-test/modules/core/playback.js
export {};
/* modules/playback-engine.js: Spotify Time Tracking & Media Interaction */

declare global {
  interface Window {
    slySeekTo: (time: number) => void;
    slyGetPlaybackSeconds: () => number;
    slyResetPlaybackExtrapolator: () => void;
  }
}

/** Upper bound on wall-clock extrapolation beyond the last progress-bar update (seconds). */
const MAX_EXTRAPOLATION_SEC = 1.5;
/** Locale-independent play state: the raw position moved forward within this window (ms). */
const MOTION_WINDOW_MS = 1500;
/** Forward jumps larger than this are seeks, not playback ticks (Spotify ticks about every 1000 ms). */
const MAX_TICK_ADVANCE_MS = 3000;

let lastExtrapolatedTime = 0;
let lastRecordWallTime = 0;
let lastIsPlaying = false;
// Set by slyResetPlaybackExtrapolator(): the next reading must re-baseline even if the
// new track's position happens to equal the old baseline (e.g. both 0:00).
let forceRebaseline = true;

/** Where a raw player-bar reading came from. Only 'test-position' is free of the transition lead. */
type RawPositionSource = 'test-position' | 'value' | 'transform';
interface RawPosition {
  ms: number;
  source: RawPositionSource;
}

// Motion tracking for isPlaybackPlaying(): the last raw reading and the wall time it last advanced.
let lastRawMs: number | null = null;
let lastRawSource: RawPositionSource | null = null;
let lastRawAdvanceWall = -Infinity;

/** Spotify's hidden seek slider (2026: min=0, max=<duration ms>, step=5000). */
function getProgressInput(): HTMLInputElement | null {
  return document.querySelector('[data-testid="playback-progressbar"] input[type="range"]') as HTMLInputElement | null;
}

/** Reads a finite, non-negative number from an attribute; null when absent or invalid. */
function numericAttr(el: Element | null | undefined, name: string): number | null {
  const raw = el?.getAttribute(name);
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Records a raw reading. A small forward step from the same source counts as playback
 * motion; backward jumps and large forward jumps (seeks) do not.
 */
function trackRawMotion(raw: RawPosition, now: number): void {
  if (lastRawMs !== null && raw.source === lastRawSource) {
    const advanceMs = raw.ms - lastRawMs;
    if (advanceMs > 0 && advanceMs <= MAX_TICK_ADVANCE_MS) lastRawAdvanceWall = now;
  }
  lastRawMs = raw.ms;
  lastRawSource = raw.source;
}

/**
 * Play state, independent of the UI language. Playing when any of these holds:
 * - the player-bar position moved forward within the last MOTION_WINDOW_MS
 *   (Spotify rewrites it about once a second while playing; see trackRawMotion);
 * - 2026 UI: [data-testid="control-button-playpause"] has the English aria-label "Pause";
 * - legacy UI: a dedicated [data-testid="control-button-pause"] exists.
 * The English "Play" label means paused even if the position just moved (a seek, or the
 * re-render at the moment of pausing). Other languages rely on the motion signal.
 */
function isPlaybackPlaying(now: number): boolean {
  const playPause = document.querySelector('[data-testid="control-button-playpause"]');
  const label = (playPause?.getAttribute('aria-label') || '').trim().toLowerCase();
  if (label === 'pause') return true;
  if (document.querySelector('[data-testid="control-button-pause"]')) return true;
  if (label === 'play') return false;
  return now - lastRawAdvanceWall < MOTION_WINDOW_MS;
}

/** CSS time value ("1000ms" / "1s") in milliseconds; 0 when absent. */
function parseCssTimeMs(value: string): number {
  const v = (value || '').trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return /ms$/i.test(v) ? n : (/s$/i.test(v) ? n * 1000 : n);
}

/**
 * While playing, Spotify animates the bar towards a target one transition ahead: the slider's
 * value attribute and --progress-bar-transform hold position + --progress-bar-duration (ms).
 */
function getProgressLeadMs(progressBar: HTMLElement | null): number {
  return progressBar ? parseCssTimeMs(progressBar.style.getPropertyValue('--progress-bar-duration')) : 0;
}

/**
 * Raw position in ms from Spotify's player bar, or null when nothing is readable.
 * Never reads the range input's .value PROPERTY: the browser snaps it to step=5000.
 */
function readRawPosition(durSec: number): RawPosition | null {
  const progressBar = document.querySelector('[data-testid="progress-bar"]') as HTMLElement | null;
  const input = getProgressInput();

  // a) --progress-bar-transform ratio × exact duration. The slider's max is the duration (ms)
  //    from the same render as the transform, so prefer it for the product.
  const transformStyle = progressBar?.style.getPropertyValue('--progress-bar-transform') || '';
  const ratio = parseFloat(transformStyle.replace('%', '')) / 100;
  const maxMs = numericAttr(input, 'max');
  const transformMs = transformStyle && Number.isFinite(ratio)
    ? ratio * (maxMs !== null && maxMs > 0 ? maxMs : durSec * 1000)
    : null;

  // b) The slider's value ATTRIBUTE: exact ms as written by React. Used when it agrees
  //    with the transform (guards against a build that stops syncing the attribute).
  const attrMs = numericAttr(input, 'value');
  let slider: RawPosition | null = null;
  if (attrMs !== null && (transformMs === null || Math.abs(attrMs - transformMs) <= 1500)) slider = { ms: attrMs, source: 'value' };
  else if (transformMs !== null) slider = { ms: transformMs, source: 'transform' };

  // c) Primary (2026-10/11): [data-testid="playback-duration"] data-test-position, the exact
  //    current position WITHOUT the transition lead. Used when it agrees with the slider
  //    within the lead + 1.5 s (guards against a stale attribute).
  const testPosMs = numericAttr(document.querySelector('[data-testid="playback-duration"]'), 'data-test-position');
  if (testPosMs !== null && (slider === null || Math.abs(slider.ms - testPosMs) <= getProgressLeadMs(progressBar) + 1500)) {
    return { ms: testPosMs, source: 'test-position' };
  }
  return slider;
}

/**
 * Recursively searches for media elements within Shadow DOMs.
 */
function findMediaRecursively(root: Document | ShadowRoot): HTMLMediaElement | null {
  if (!root) return null;
  let found = root.querySelector('video, audio') as HTMLMediaElement | null;
  if (found) return found;

  const walkers = document.createTreeWalker(root as unknown as Node, NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walkers.nextNode())) {
    const el = node as Element;
    if (el.shadowRoot) {
      const sub = findMediaRecursively(el.shadowRoot);
      if (sub) return sub;
    }
  }
  return null;
}

/**
 * Robustly extracts the total duration of the current track, in seconds (exact, not floored).
 * Prioritizes Spotify internal metadata, then the seek slider's max (ms), then DOM text with toggle-awareness.
 */
function getAbsoluteDuration(): number {
  const track = (window as any).spotifyState?.track;
  // 2026-11 bridge tracks use Spotify's item shape (duration: { milliseconds }); older ones use duration_ms.
  const durationMs = Number(track?.duration?.milliseconds ?? track?.duration_ms);
  if (Number.isFinite(durationMs) && durationMs > 0) return durationMs / 1000;

  const sliderMaxMs = numericAttr(getProgressInput(), 'max');
  if (sliderMaxMs !== null && sliderMaxMs > 0) return sliderMaxMs / 1000;

  const durationEl = document.querySelector('[data-testid="playback-duration"]');
  const positionEl = document.querySelector('[data-testid="playback-position"]');

  const parseTime = (el: Element | null) => {
    const text = el?.textContent || '0:00';
    const parts = text.replace(/[^0-9:-]/g, '').split(':').map(Number);
    const sign = text.includes('-') ? -1 : 1;
    let total = 0;
    if (parts.length === 3) total = Math.abs(parts[0]) * 3600 + Math.abs(parts[1]) * 60 + Math.abs(parts[2]);
    else if (parts.length === 2) total = Math.abs(parts[0]) * 60 + Math.abs(parts[1]);
    return total * sign;
  };

  const durVal = parseTime(durationEl);
  if (durVal >= 0) return durVal;

  // Remaining mode fallback: Total = Elapsed + abs(Remaining)
  const posVal = parseTime(positionEl);
  const total = Math.abs(posVal) + Math.abs(durVal);
  
  // BUG-37 Fix: If duration is ambiguous (0:00 / -0:00), return 1 as a safe divisor
  // to prevent progress bar collapse and division-by-zero errors in the renderer.
  return total || 1;
}

/**
 * Attempts to seek the current track to a specific timestamp.
 * Uses a layered approach: React State Bridge → Direct Media Access → Pointer Simulation.
 */
window.slySeekTo = function (time: number): void {
  console.log(`[sly-playback] Seek requested to ${time.toFixed(2)}s — trying layers...`);

  // LAYER 1: React State Bridge (Hidden Range Input)
  // The 2026 slider has step=5000: the browser would round "47820" to "50000" before
  // React's onChange reads it. Lift the step for the synchronous write + dispatch,
  // then put it back.
  const nativeInput = getProgressInput();
  if (nativeInput) {
    const prevStep = nativeInput.getAttribute('step');
    try {
      const min = numericAttr(nativeInput, 'min') ?? 0;
      const max = numericAttr(nativeInput, 'max');
      let valMs = Math.max(min, Math.round(time * 1000));
      if (max !== null && max > 0) valMs = Math.min(valMs, max);

      nativeInput.setAttribute('step', 'any');
      nativeInput.value = String(valMs);
      const applied = Math.abs(Number(nativeInput.value) - valMs) < 1;
      if (applied) {
        nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
        nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[sly-playback] Seek OK via Layer 1 (hidden range input, ${valMs}ms)`);
        return;
      }
      console.warn(`[sly-playback] Layer 1 could not apply ${valMs}ms (input reads ${nativeInput.value}) — trying next layer.`);
    } catch (e) {
      console.warn(`[sly-playback] Layer 1 failed:`, e);
    } finally {
      if (prevStep === null) nativeInput.removeAttribute('step');
      else nativeInput.setAttribute('step', prevStep);
    }
  }

  // LAYER 2: Direct Media Access (Shadow DOM Aware)
  const media = findMediaRecursively(document);
  if (media) {
    try {
      media.currentTime = time;
      console.log(`[sly-playback] Seek OK via Layer 2 (direct media access)`);
      return;
    } catch (e) {
      console.warn(`[sly-playback] Layer 2 failed:`, e);
    }
  }

  // LAYER 3: Simulated Pointer Interaction
  const progressBar = document.querySelector('[data-testid="progress-bar"]');
  if (progressBar) {
    const durSec = getAbsoluteDuration();

    if (durSec > 0) {
      const rect = progressBar.getBoundingClientRect();
      const ratio = Math.min(Math.max(time / durSec, 0), 1);
      const x = rect.left + (rect.width * ratio);
      const y = rect.top + (rect.height / 2);

      const common = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      progressBar.dispatchEvent(new PointerEvent('pointerdown', common));
      progressBar.dispatchEvent(new PointerEvent('pointerup', common));
      progressBar.dispatchEvent(new MouseEvent('click', common));
      console.log(`[sly-playback] Seek OK via Layer 3 (pointer simulation)`);
    }
  }
};

/**
 * Returns the current playback position in seconds.
 * Includes wall-clock extrapolation for smooth sub-second updates between Spotify UI refreshes.
 */
window.slyGetPlaybackSeconds = function (): number {
  // 1. Exact duration (ms precision) from metadata, slider max or UI text
  const durSec = getAbsoluteDuration();

  // 2. Raw position from the player bar (exact; never the step-snapped slider .value).
  //    Its motion drives the language-independent play state.
  const raw = readRawPosition(durSec);
  if (raw === null) return 0;
  const now = performance.now();
  trackRawMotion(raw, now);
  const isPlaying = isPlaybackPlaying(now);

  // The slider value / transform run one --progress-bar-duration ahead while playing; remove
  // that lead so extrapolation does not run early. data-test-position carries no lead.
  let baselineUiTime = raw.ms / 1000;
  if (isPlaying && raw.source !== 'test-position') {
    const leadMs = getProgressLeadMs(document.querySelector('[data-testid="progress-bar"]') as HTMLElement | null);
    if (leadMs > 0) baselineUiTime = Math.max(0, baselineUiTime - leadMs / 1000);
  }

  // 3. Extrapolate if playing
  // We only reset the baseline if Spotify's UI has moved significantly (>50ms)
  // OR if we just transitioned from pause to play (prevents pause-duration time warp).
  const isTransitioningToPlay = isPlaying && !lastIsPlaying;
  if (forceRebaseline || Math.abs(baselineUiTime - lastExtrapolatedTime) > 0.05 || !isPlaying || isTransitioningToPlay) {
    lastExtrapolatedTime = baselineUiTime;
    lastRecordWallTime = now;
    forceRebaseline = false;
  }
  lastIsPlaying = isPlaying;

  // Spotify rewrites the progress bar about once a second. Never extrapolate further than
  // MAX_EXTRAPOLATION_SEC past the last observed position: if the stream stalls while the
  // button still says "Pause", the lyrics hold instead of racing ahead.
  const timeDiff = isPlaying ? Math.min((now - lastRecordWallTime) / 1000, MAX_EXTRAPOLATION_SEC) : 0;
  const position = lastExtrapolatedTime + timeDiff;
  return durSec > 1 ? Math.min(position, durSec) : position;
};

/**
 * Resets the extrapolation baseline. Call from slyResetPlayerState() on every
 * track change so the first call to slyGetPlaybackSeconds() after a skip
 * always reads the live progress bar instead of extrapolating from the
 * previous song's position.
 */
window.slyResetPlaybackExtrapolator = function (): void {
  lastExtrapolatedTime = 0;
  lastRecordWallTime = 0;
  lastIsPlaying = false;
  forceRebaseline = true; // next read re-baselines even if the new position is also 0:00
  lastRawMs = null; // the old track's motion must not mark the new one as playing
  lastRawSource = null;
  lastRawAdvanceWall = -Infinity;
};
