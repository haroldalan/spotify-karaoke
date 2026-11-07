// @ts-nocheck
import { slyInternalState, spotifyState } from './state';
import { getNowPlayingTrackId, isLyricsButtonActive } from '../dom/domQueries';
import { slyGetNativePanel, slyUntagLayoutHost } from './domEngine';

/**
 * TakeoverEngine: The orchestrator for the "0ms Swap" and DOM injection.
 * It replaces Spotify's native UI with the custom lyrics view synchronously.
 */
export const TakeoverEngine = {
  /**
   * Executes the full takeover process: Theme mirroring -> DOM building -> Injection dispatch.
   * This is the "0ms Path" that eliminates UI flickers.
   */
  async executeTakeover(lyricsObj: any, store: any, syncPill: Function, isInstant = false) {
    if (!lyricsObj || lyricsObj.failed) return;

    const currentUri = spotifyState.track?.uri;
    const domTrackId = getNowPlayingTrackId();

    console.log(`[TakeoverEngine] 🚀 INITIATING 0ms SWAP for: "${lyricsObj.title || 'Unknown'}"`);

    // 1. STALENESS GUARDS
    // Verify that injected lyrics actually match the active track in both state and DOM.
    if (lyricsObj._slyUri && currentUri && lyricsObj._slyUri !== currentUri) {
        console.warn(`[TakeoverEngine] 🚫 ABORT: Data URI (${lyricsObj._slyUri}) mismatches Spotify State (${currentUri})`);
        return;
    }
    if (domTrackId && lyricsObj._slyUri && !(lyricsObj._slyUri as string).includes(domTrackId)) {
        console.warn(`[TakeoverEngine] 🚫 ABORT: Data URI (${lyricsObj._slyUri}) mismatches DOM Track ID (${domTrackId})`);
        return;
    }

    const sly = window as any;

    // Synced takeovers must be built from the current LRC source, never from a
    // stale plain-lyrics snapshot captured before the upgrade completed.
    if (lyricsObj.isSynced) {
      const parsedLines = sly.slyParseLRC?.(String(lyricsObj.syncedLyrics || '')) || [];
      if (parsedLines.length === 0) {
        console.warn('[TakeoverEngine] ABORT: Synced takeover has no parsed LRC lines.');
        return;
      }
      lyricsObj.lines = parsedLines;
    }
    
    // 2. PRE-INJECTION MIRRORING (Sync)
    // We do this BEFORE any async yields to eliminate the "background flash".
    // 2026 UI: themed container is DIV[style*="--lyrics-color-active"] in the overlay (no DIV#root exists).
    // Refresh classes while native full-panel markup is still present. The NPV
    // preview has a different tree and must never seed the custom renderer's layout.
    if (typeof sly.slyScavengeClasses === 'function') sly.slyScavengeClasses();
    const root: HTMLElement | null = sly.slyPrepareContainer?.();
    // Full-panel themed container (NPV preview excluded); legacy main selector as fallback.
    const nativeRef = slyGetNativePanel();

    if (root) {
      store.godState = 'PIPELINE_A';
      const color = lyricsObj.extractedColor || (lyricsObj.data?.extractedColor) || 'None';
      console.log(`[TakeoverEngine] 🎨 MIRRORING THEME: Using color ${color}. Source: ${lyricsObj.extractedColor ? 'Extracted' : 'Native Mirror'}`);
      
      sly.slyMirrorNativeTheme?.(root, lyricsObj, nativeRef);
      
      // Relocate pill synchronously to eliminate "pop-in" glitch
      if (typeof syncPill === 'function') syncPill('PIPELINE_A'); 
    }

    // 3. RENDER STABILIZATION (Async)
    // Only yield if we aren't already active to allow 0ms transitions on repeated skips.
    // Skip entirely if we are in an 'isInstant' cache-hit swap.
    if (!isInstant && !document.getElementById('lyrics-root-sync')) {
      await new Promise(r => requestAnimationFrame(r));
    }

    // 4. PANEL OPEN VALIDATION
    // If the user closed the panel during the 1-frame async yield, abort.
    // 2026 UI: the panel is an overlay, pathname no longer changes to /lyrics (kept as a legacy OR).
    // NPV preview lines in the aside do NOT mean the panel is open.
    const isReallyOpen = isLyricsButtonActive() || location.pathname.startsWith('/lyrics');

    if (!isReallyOpen) {
      console.log('[TakeoverEngine] ⏹️ CANCELLED: Panel closed during render stabilization.');
      return;
    }

    if (!root) return;

    // 5. DOM CONSTRUCTION
    const lineCount = lyricsObj.lines?.length || 0;
    const mode = lyricsObj.isSynced ? 'Synced (LRC)' : 'Plain';
    console.log(`[TakeoverEngine] 🏗️ BUILDING DOM: Injecting ${lineCount} lines. Mode: ${mode}`);
    
    if (typeof sly.slyInjectCoreStyles === 'function') sly.slyInjectCoreStyles();
    if (typeof sly.slyBuildLyricsList === 'function') {
      sly.slyBuildLyricsList(root, lyricsObj, store.preferredMode, store.currentActiveLang);
    }

    // 6. PIPELINE HANDOFF (Takeover Event)
    // This notifies the shared lifecycle modules that we have taken control of the screen.
    const plainLines = lyricsObj.isSynced
      ? (lyricsObj.lines || []).map(l => l.text)
      : ((lyricsObj.plainLyrics as string) || '').split('\n');

    const lrcLines = lyricsObj.isSynced ? (lyricsObj.lines || []) : [];
    const domElements = (lyricsObj.domElements as HTMLElement[]) ?? [];

    document.dispatchEvent(new CustomEvent('sly:takeover', {
      detail: { 
          container: root, 
          plainLines, 
          isSynced: !!lyricsObj.isSynced, 
          lrcLines, 
          domElements, 
          trackId: store.songKey,
          processed: lyricsObj.processed,
          renderedMode: (lyricsObj.processed && store.preferredMode !== 'original') ? store.preferredMode : 'original'
      },
    }));

    console.log(`[TakeoverEngine] ✅ SUCCESS: Custom lyrics are now live.`);

    // 7. SYNC BUTTON SETUP
    if (lyricsObj.isSynced && typeof sly.slySetupSyncButton === 'function') {
      sly.slySetupSyncButton(lyricsObj);
    }
  },

  /**
   * Synchronously removes the custom lyrics container and restores native UI visibility.
   * Essential for preventing "Ghost Lyrics" during track transitions.
   */
  purge(): void {
    const root = document.getElementById('lyrics-root-sync');
    if (!root) return;

    console.log('[TakeoverEngine] 🧹 Synchronously purging custom container.');
    
    // 1. Restore native container visibility (themed DIV first, legacy main fallback)
    const nativeRef = slyGetNativePanel();
    
    if (nativeRef) {
      nativeRef.style.display = '';
      nativeRef.style.opacity = '1';
      nativeRef.style.visibility = 'visible';
    }

    // K11: sly-active lives on the themed panel's parent (legacy fallback: main.<mainContainer>).
    slyUntagLayoutHost('sly-active');

    // 2. Remove custom root
    root.remove();
    if (slyInternalState.customRoot === root) slyInternalState.customRoot = null;
  }
};
