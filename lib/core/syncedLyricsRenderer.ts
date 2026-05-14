/**
 * syncedLyricsRenderer.ts
 *
 * Pipeline B's RAF-based sync loop for synced (LRC) lyrics.
 *
 * This module is the prerequisite for eliminating slyCore's #lyrics-root-sync
 * DOM for the synced case. It is intentionally decoupled from slyCore: no
 * window globals are read directly — everything is supplied as injected opts
 * so the module is testable and portable.
 *
 * Integration (Chunk 7):
 *   - setupSlyBridge() starts the renderer on sly:takeover when isSynced is true
 *   - slyInjectLyrics() skips its own slyUpdateSync call when renderer.isRunning()
 *   - sly:release handler calls renderer.stop()
 */

export interface LrcLine {
  time: number;
  text: string;
}

export interface SyncedRendererOpts {
  /**
   * Returns current playback position in seconds (wall-clock extrapolated).
   * Supplied by window.slyGetPlaybackSeconds from playback.ts.
   */
  getPlaybackSeconds: () => number;

  /**
   * Returns the outer [data-testid="lyrics-line"] divs to apply
   * active/passed/future class transitions to.
   * These are the same elements slyCore's domElements array contains.
   */
  getOuterElements: () => Element[];

  /** Spotify's obfuscated CSS class for the base line container (scavenged). */
  lineBaseClass: () => string;
  activeClass: () => string;
  passedClass: () => string;
  futureClass: () => string;

  /**
   * Returns true while the user is manually scrolling the lyrics panel.
   * When true, auto-scroll to the active line is suppressed.
   * Mirrors slyInternalState.isUserScrolling.
   */
  isUserScrolling: () => boolean;

  /**
   * Sets the user scrolling state. Used to resume auto-scroll when the active
   * line enters the viewport. Optional — no-op if not supplied.
   */
  setUserScrolling?: (val: boolean) => void;

  /**
   * Called each time the active line index changes. The caller uses this to
   * keep external state (e.g. slyInternalState.lastActiveIndex) current for
   * the Sync button scroll handler. Optional — no-op if not supplied.
   */
  onActiveIndexChange?: (index: number) => void;
}

export function createSyncedLyricsRenderer(opts: SyncedRendererOpts) {
  let animFrame: number | null = null;
  let lastActiveIndex = -1;
  let lines: LrcLine[] = [];

  /** Binary-search style scan for the currently active line index. */
  function findActiveIndex(t: number): number {
    let low = 0;
    let high = lines.length - 1;
    let active = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (lines[mid].time <= t) {
        active = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return active;
  }

  let retryCount = 0;
  function tick(): void {
    const outerEls = opts.getOuterElements();

    // Panel may not be visible yet on first frame — keep looping until ready.
    // SLY FIX: Also guard against partial renders where outerEls.length < lines.length.
    // SLY FIX (BUG-C8): Add a safety timeout (300 frames ~ 5s) to prevent permanent CPU drain.
    if (!outerEls.length || outerEls.length !== lines.length) {
      if (++retryCount > 300) {
        console.warn(`[sly-sync] 🛑 Giving up after 300 retries. outerEls: ${outerEls.length}, lines: ${lines.length}`);
        return;
      }
      animFrame = requestAnimationFrame(tick);
      return;
    }
    retryCount = 0;

    const t = opts.getPlaybackSeconds();
    const activeIndex = findActiveIndex(t);

    if (activeIndex !== lastActiveIndex) {
      const base = opts.lineBaseClass();
      const active = opts.activeClass();
      const passed = opts.passedClass();
      const future = opts.futureClass();

      outerEls.forEach((el, i) => {
        if (activeIndex === -1)    el.className = `${base} ${future}`;
        else if (i === activeIndex) el.className = `${base} ${active}`;
        else if (i < activeIndex)  el.className = `${base} ${passed}`;
        else                       el.className = `${base} ${future}`;
      });

      // Snap on the very first active line (matches slyCore's 'instant' vs 'smooth' logic).
      const isFirstActivation = lastActiveIndex === -1;
      lastActiveIndex = activeIndex;

      opts.onActiveIndexChange?.(activeIndex);

      if (!opts.isUserScrolling() && outerEls[activeIndex]) {
        (outerEls[activeIndex] as HTMLElement).scrollIntoView({
          behavior: isFirstActivation ? 'instant' : 'smooth',
          block: 'center',
        });
      }
    }

    // SLY FIX: New UX Requirement - Auto-resume on scroll-into-view
    // This allows the renderer to "snap" back to auto-scrolling if the user
    // manually scrolls back to the active line, or if the active line
    // naturally progresses into the user's current viewport.
    if (opts.isUserScrolling() && outerEls[activeIndex]) {
      const elRect = (outerEls[activeIndex] as HTMLElement).getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const topSafe = viewportHeight * 0.2;
      const bottomSafe = viewportHeight * 0.8;
      const isInView = (elRect.top >= topSafe) && (elRect.bottom <= bottomSafe);
      
      if (isInView) {
        opts.setUserScrolling?.(false);
      }
    }

    animFrame = requestAnimationFrame(tick);
  }

  return {
    /**
     * Starts the sync loop for the given lines. 
     * Stops any previously running loop first.
     */
    start(lrcLines: LrcLine[], resumeIndex = -1): void {
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      lines = lrcLines;
      lastActiveIndex = resumeIndex;
      animFrame = requestAnimationFrame(tick);
    },

    /** Stops the sync loop and resets internal state. */
    stop(): void {
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      lastActiveIndex = -1;
      lines = [];
    },

    /** True while the RAF loop is running. Used by slyInjectLyrics to decide
     *  whether to skip its own slyUpdateSync call (Chunk 7). */
    isRunning(): boolean {
      return animFrame !== null;
    },
  };
}
