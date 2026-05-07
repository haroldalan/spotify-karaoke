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

let lastExtrapolatedTime = 0;
let lastRecordWallTime = 0;

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
 * Robustly extracts the total duration of the current track.
 * Prioritizes Spotify internal metadata, falls back to DOM with toggle-awareness.
 */
function getAbsoluteDuration(): number {
  const track = (window as any).spotifyState?.track;
  if (track?.duration_ms) return Math.floor(track.duration_ms / 1000);

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
  return Math.abs(posVal) + Math.abs(durVal);
}

/**
 * Attempts to seek the current track to a specific timestamp.
 * Uses a layered approach: React State Bridge → Direct Media Access → Pointer Simulation.
 */
window.slySeekTo = function (time: number): void {
  console.log(`[sly-playback] Seek requested to ${time.toFixed(2)}s — trying layers...`);

  // LAYER 1: React State Bridge (Hidden Range Input)
  const playbackContainer = document.querySelector('[data-testid="playback-progressbar"]');
  const nativeInput = playbackContainer?.querySelector('input[type="range"]') as HTMLInputElement | null;
  if (nativeInput) {
    try {
      const valMs = Math.round(time * 1000);
      nativeInput.value = String(valMs);
      nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[sly-playback] Seek OK via Layer 1 (hidden range input)`);
      return;
    } catch (e) {
      console.warn(`[sly-playback] Layer 1 failed:`, e);
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
  const progressBar = document.querySelector('[data-testid="progress-bar"]');
  if (!progressBar) return 0;

  // 1. Extract base percentage from CSS transform
  const transformStyle = (progressBar as HTMLElement).style.getPropertyValue('--progress-bar-transform');
  const percentStr = transformStyle ? transformStyle.replace('%', '') : '0';
  const posRatio = parseFloat(percentStr) / 100;

  // 2. Extract duration from metadata or UI text
  const durSec = getAbsoluteDuration();

  const baselineUiTime = posRatio * durSec;
  const isPlaying = !!document.querySelector('[data-testid="control-button-pause"]');
  const now = performance.now();

  // 3. Extrapolate if playing
  // We only reset the baseline if Spotify's UI has moved significantly (>50ms)
  if (Math.abs(baselineUiTime - lastExtrapolatedTime) > 0.05 || !isPlaying) {
    lastExtrapolatedTime = baselineUiTime;
    lastRecordWallTime = now;
  }

  const timeDiff = isPlaying ? (now - lastRecordWallTime) / 1000 : 0;
  return lastExtrapolatedTime + timeDiff;
};

/**
 * Resets the extrapolation baseline. Call from slyResetPlayerState() on every
 * track change so the first call to slyGetPlaybackSeconds() after a skip
 * always reads the live progress bar instead of extrapolating from the
 * previous song's position.
 */
window.slyResetPlaybackExtrapolator = function (): void {
  lastExtrapolatedTime = 0;
  lastRecordWallTime = 0; // forces |baselineUiTime - 0| > 0.05 → immediate reset
};
