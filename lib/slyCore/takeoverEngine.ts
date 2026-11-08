// @ts-nocheck
import { slyInternalState, spotifyState } from './state';
import { syncLyricsChip } from './lyricsChip';
import { getNowPlayingTrackId, isLyricsButtonActive } from '../dom/domQueries';
import { slyFindOverlayLyricsSlot, slyGetNativePanel, slyRestoreOverlayContent, slyUntagLayoutHost } from './domEngine';
import { StatusEngine } from './statusEngine';
import { FetchEngine } from './fetchEngine';
import { slyPreFetchRegistry } from './preFetch';
import { nonLatinLetterRatio } from '../lyrics/romanizedDetector';

/**
 * TakeoverEngine: The orchestrator for the "0ms Swap" and DOM injection.
 * It replaces Spotify's native UI with the custom lyrics view synchronously.
 */
/** Lyrics without native script (Latin only): LRC or plain text or parsed lines. */
function isLatinOnlyLyrics(lyricsObj: any): boolean {
  const text = String(lyricsObj?.syncedLyrics || lyricsObj?.plainLyrics || '');
  const lines = text ? text.split('\n').map((l: string) => l.replace(/^\[[^\]]*\]/, '')) :
    (Array.isArray(lyricsObj?.lines) ? lyricsObj.lines.map((l: any) => String(l?.text ?? l?.words ?? '')) : []);
  if (!lines.some((l: string) => /\p{L}/u.test(l))) return false;
  return nonLatinLetterRatio(lines) < 0.02;
}

/** The track whose lyrics were held back because Spotify's lyrics style was unknown (one notice each). */
let styleRefusalNotedFor = '';

/** Checks for the slot after a mid-slide refusal: how often, and for how long (Spotify's slide takes ~0.8 s). */
export const SLOT_RETRY_EVERY_MS = 100;
export const SLOT_RETRY_FOR_MS = 2500;
let slotRetryTimer: ReturnType<typeof setTimeout> | null = null;

export const TakeoverEngine = {
  /**
   * After a 'lyrics-slot-busy' refusal: runs the takeover again once the view shows one
   * slot (or the playing song's can be told apart), for the same track only. A newer
   * call replaces a waiting one.
   */
  _retryWhenSlotSettles(lyricsObj: any, store: any, syncPill: Function, isInstant: boolean): void {
    if (slotRetryTimer) clearTimeout(slotRetryTimer);
    const uri = lyricsObj?._slyUri || spotifyState.track?.uri || '';
    const until = Date.now() + SLOT_RETRY_FOR_MS;
    const check = () => {
      slotRetryTimer = null;
      const playing = spotifyState.track?.uri || '';
      const id = getNowPlayingTrackId();
      if (!uri || (playing && playing !== uri && !(id && uri.endsWith(id)))) return; // another song now
      if (document.getElementById('lyrics-root-sync')?.querySelector('[data-testid="lyrics-line"]')) return; // shown meanwhile
      if (slyFindOverlayLyricsSlot()) {
        console.log('[TakeoverEngine] The view finished sliding: showing the lyrics now.');
        void this.executeTakeover(lyricsObj, store, syncPill, isInstant);
        return;
      }
      if (Date.now() < until) slotRetryTimer = setTimeout(check, SLOT_RETRY_EVERY_MS);
    };
    slotRetryTimer = setTimeout(check, SLOT_RETRY_EVERY_MS);
  },

  /**
   * Executes the full takeover process: Theme mirroring -> DOM building -> Injection dispatch.
   * This is the "0ms Path" that eliminates UI flickers.
   */
  async executeTakeover(lyricsObj: any, store: any, syncPill: Function, isInstant = false) {
    if (!lyricsObj || lyricsObj.failed) return;

    const currentUri = spotifyState.track?.uri;
    const domTrackId = getNowPlayingTrackId();

    console.log(`[TakeoverEngine] 🚀 INITIATING 0ms SWAP for: "${lyricsObj.title || spotifyState.track?.name || lyricsObj._slyUri || 'Unknown'}"`);

    // 1. STALENESS GUARDS
    // Verify that injected lyrics actually match the active track in both state and DOM.
    // Cached lyrics put in at the song change (lifecycleController.injectStagedNow) may go
    // in while the bridge still names the previous track, and only then.
    const bridgeCatchingUp = !!lyricsObj._slyEarly && !!lyricsObj._slyPrevUri && currentUri === lyricsObj._slyPrevUri;
    if (lyricsObj._slyUri && currentUri && lyricsObj._slyUri !== currentUri && !bridgeCatchingUp) {
        console.warn(`[TakeoverEngine] 🚫 ABORT: Data URI (${lyricsObj._slyUri}) mismatches Spotify State (${currentUri})`);
        return;
    }
    if (domTrackId && lyricsObj._slyUri && !(lyricsObj._slyUri as string).includes(domTrackId)) {
        console.warn(`[TakeoverEngine] 🚫 ABORT: Data URI (${lyricsObj._slyUri}) mismatches DOM Track ID (${domTrackId})`);
        return;
    }

    const sly = window as any;

    // Spotify shows a romanized fallback for this track: only native-script lyrics are an
    // improvement. A fallback that is romanized too (live: Malang Sajna from YouTube
    // Music) must not replace Spotify's synced lines: keep Spotify's.
    const uri = lyricsObj._slyUri || currentUri || '';
    if (uri && slyPreFetchRegistry.getState(uri)?.nativeStatus === 'ROMANIZED' && isLatinOnlyLyrics(lyricsObj)) {
      console.log(`[TakeoverEngine] The fallback lyrics are romanized too: keeping Spotify's own lyrics for ${uri}.`);
      slyInternalState.failedFetchUris?.add(uri);
      slyInternalState.l0Cache?.delete(uri);
      if (slyInternalState.pendingLyricsData?._slyUri === uri) slyInternalState.pendingLyricsData = null;
      FetchEngine._standDownToNative(uri);
      return;
    }

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
    const root: HTMLElement | null = sly.slyPrepareContainer?.({ forLyrics: true });
    const refusal = slyInternalState.lastPrepareRefusal;
    if (!root && refusal === 'lyrics-style-broken') {
      if (styleRefusalNotedFor !== `broken:${lyricsObj._slyUri || currentUri || ''}`) {
        styleRefusalNotedFor = `broken:${lyricsObj._slyUri || currentUri || ''}`;
        console.warn('[TakeoverEngine] Spotify\'s lyrics style is not available with the known names: keeping Spotify\'s own lyrics.');
      }
      return;
    }
    if (!root && refusal === 'lyrics-slot-busy') {
      // Spotify is sliding between two songs' views and the slot of the song now playing
      // cannot be told apart yet: no status (it would stop every later attempt), try again
      // as soon as the slide is over (live 2026-11-08: refused once, never shown).
      this._retryWhenSlotSettles(lyricsObj, store, syncPill, isInstant);
      return;
    }
    if (!root && (refusal === 'lyrics-style-unknown' || refusal === 'lyrics-slot-unknown')) {
      // Spotify shows no lyrics for this track and its lyrics classes are not known yet:
      // never show lyrics in a look that is not Spotify's. Say so once per track.
      const uri = lyricsObj._slyUri || currentUri || '';
      // Again whenever it is no longer on screen (the view was closed and reopened): the
      // status on show also stops content.ts from re-injecting this takeover every poll.
      if (styleRefusalNotedFor !== uri || !StatusEngine.isShowing()) {
        styleRefusalNotedFor = uri;
        if (refusal === 'lyrics-slot-unknown') {
          // Spotify's lyrics style is known, but this view's layout is not recognised.
          console.warn('[TakeoverEngine] Lyrics found, but the place for them in Spotify\'s Now Playing view is not recognised: not rendering them.');
          StatusEngine.show('Spotify Karaoke found lyrics for this song.', 'They can\'t be shown in this view yet. Try the Artwork view.', false, { noticeFade: true });
        } else {
          console.warn('[TakeoverEngine] Lyrics found, but Spotify\'s lyrics style is not available on this page yet: not rendering them.');
          StatusEngine.show('Spotify Karaoke found lyrics for this song.', 'Open any song that has Spotify lyrics once, then come back to see them here.', false, { noticeFade: true });
        }
      }
      return;
    }
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
    // This track's lyrics are ours: when the view is closed and reopened, Spotify's panel is
    // held invisible until ours replace it again (styles.ts: data-sly-takeover-uri).
    const takenUri = lyricsObj._slyUri || currentUri;
    if (takenUri) document.documentElement.setAttribute('data-sly-takeover-uri', takenUri);
    // In Spotify's expanded Now Playing view (no Spotify lyrics): follow its media switch.
    syncLyricsChip();

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
    // Spotify's own Now Playing content comes back even when our root already left the page.
    slyRestoreOverlayContent();
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
