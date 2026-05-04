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
    let active = -1;
    for (let i = 0; i < lines.length; i++) {
      if (t >= lines[i].time) active = i;
      else break;
    }
    return active;
  }

  function tick(): void {
    const outerEls = opts.getOuterElements();

    // Panel may not be visible yet on first frame — keep looping until ready.
    if (!outerEls.length) {
      animFrame = requestAnimationFrame(tick);
      return;
    }

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
