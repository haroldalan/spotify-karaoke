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
let cachedMedia: HTMLMediaElement | null = null;
let lastMediaCheck = 0;

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
      
      // SLY FIX (BUG-W): Robustly detect if Spotify is using seconds or milliseconds.
      // We compare the input's 'max' with the parsed song duration.
      const durationEl = document.querySelector('[data-testid="playback-duration"]');
      const p = (durationEl?.textContent || '0:00').replace(/[^0-9:]/g, '').split(':').map(Number);
      const durSec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
      
      const maxAttr = parseFloat(nativeInput.max || '0');
      // If max is closer to durSec than durSec*1000, it's seconds.
      const isSeconds = durSec > 0 && Math.abs(maxAttr - durSec) < Math.abs(maxAttr - (durSec * 1000));
      
      nativeInput.value = isSeconds ? String(Math.round(time)) : String(valMs);
      nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      // SLY FIX (Bug 1): Force extrapolator to target time immediately
      lastExtrapolatedTime = time;
      lastRecordWallTime = performance.now();

      console.log(`[sly-playback] Seek OK via Layer 1 (hidden range input)`);
      return;
    } catch (e) {
      console.warn(`[sly-playback] Layer 1 failed:`, e);
    }
  }

  // LAYER 2: Direct Media Access (Shadow DOM Aware)
  const now = performance.now();
  if (!cachedMedia || (now - lastMediaCheck > 5000)) {
    cachedMedia = findMediaRecursively(document);
    lastMediaCheck = now;
  }
  const media = cachedMedia;
  if (media) {
    try {
      media.currentTime = time;

      // SLY FIX (Bug 1): Force extrapolator to target time immediately
      lastExtrapolatedTime = time;
      lastRecordWallTime = performance.now();

      console.log(`[sly-playback] Seek OK via Layer 2 (direct media access)`);
      return;
    } catch (e) {
      console.warn(`[sly-playback] Layer 2 failed:`, e);
    }
  }

  // LAYER 3: Simulated Pointer Interaction
  const progressBar = document.querySelector('[data-testid="progress-bar"]');
  if (progressBar) {
    const durationEl = document.querySelector('[data-testid="playback-duration"]');
    const p = (durationEl?.textContent || '0:00').replace(/[^0-9:]/g, '').split(':').map(Number);
    const durSec = p.length === 3
      ? p[0] * 3600 + p[1] * 60 + p[2]
      : p.length === 2
        ? p[0] * 60 + p[1]
        : 0;

    if (durSec > 0) {
      const rect = progressBar.getBoundingClientRect();
      const ratio = Math.min(Math.max(time / durSec, 0), 1);
      const x = rect.left + (rect.width * ratio);
      const y = rect.top + (rect.height / 2);

      const common = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      progressBar.dispatchEvent(new PointerEvent('pointerdown', common));
      progressBar.dispatchEvent(new PointerEvent('pointerup', common));
      progressBar.dispatchEvent(new MouseEvent('click', common));

      // SLY FIX (Bug 1): Force extrapolator to target time immediately
      lastExtrapolatedTime = time;
      lastRecordWallTime = performance.now();

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

  // 2. Extract duration from UI text
  const durationEl = document.querySelector('[data-testid="playback-duration"]');
  const durationStr = durationEl?.textContent || '0:00';
  // SLY FIX (Bug 8): Sanitize duration string to remove LTR/RTL/hidden marks
  const p = durationStr.replace(/[^0-9:]/g, '').split(':').map(Number);
  const durSec = p.length === 3
    ? p[0] * 3600 + p[1] * 60 + p[2]
    : p.length === 2
      ? p[0] * 60 + p[1]
      : 0;

  const baselineUiTime = posRatio * durSec;
  const isPlaying = !!document.querySelector('[data-testid="control-button-pause"]');
  const now = performance.now();

  // BUG-T FIX: Reset baseline immediately on resume to prevent wall-clock jump
  const wasPaused = (window as any).slyLastIsPlaying === false;
  (window as any).slyLastIsPlaying = isPlaying;

  // 3. Extrapolate if playing
  // We only reset the baseline if Spotify's UI has moved significantly (>50ms),
  // OR if we just resumed from a pause, OR if we are currently paused.
  if (Math.abs(baselineUiTime - lastExtrapolatedTime) > 0.05 || !isPlaying || (isPlaying && wasPaused)) {
    lastExtrapolatedTime = baselineUiTime;
    lastRecordWallTime = now;
  }

  const timeDiff = isPlaying ? (now - lastRecordWallTime) / 1000 : 0;
  return Math.max(0, lastExtrapolatedTime + timeDiff);
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
