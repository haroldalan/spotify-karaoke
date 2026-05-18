import './style.css';
import { isContextValid } from '../../lib/utils/browserUtils';
import { createDomObserver } from '../../lib/dom/domObserver';
import { startStorageListener } from '../../lib/core/storageListener';
import { createModeController } from '../../lib/core/modeController';
import { createLifecycleController, setupSlyBridge } from '../../lib/core/lifecycleController';
import { prewarmRuntimeCache } from '../../lib/core/lyricsCache';
import { StateStore } from '../../lib/core/store';
import { setupKeyboardShortcuts } from '../../lib/core/keyboardListener';
import { setupMessageListener, setupTokenBridge } from '../../lib/core/messageListener';
// --- slyCore initialization layer (lyric-test integration) ---
import { SLY_NATIVE_LANGUAGES } from '../../lib/slyCore/languages';
import '../../lib/slyCore/forensics';
import { initSlyState } from '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import '../../lib/slyCore/scavenger';
import '../../lib/slyCore/adManager';
import '../../lib/slyCore/styles';
import '../../lib/slyCore/playback';
import '../../lib/slyCore/detector';
import '../../lib/slyCore/domEngine';
import '../../lib/slyCore/messaging';
import '../../lib/slyCore/ui';
import '../../lib/slyCore/events';
import '../../lib/slyCore/content';
// Ensure module loads (suppresses unused-import lint warnings)
void SLY_NATIVE_LANGUAGES;

export default defineContentScript({
  matches: ['*://open.spotify.com/*'],
  runAt: 'document_start',
  main,
});


async function main(): Promise<void> {
  // 1. IMMEDIATE BRIDGE INITIALIZATION (Synchronous)
  // This must run at document_start to catch the first Musixmatch token hydration request.
  setupTokenBridge();

  // Register SLY_BRIDGE listener — populates window.spotifyState from scanner postMessages
  initSlyState();

  // BUG-31 Fix: Messaging bridge for Chrome MAIN world.
  // This isolated world script can access extension APIs (browser.runtime.sendMessage).
  window.addEventListener('message', (event) => {
    const data = event.data as Record<string, any>;
    if (data?.type === 'SLY_CHECK_CACHE') {
      const { title, artist, uri } = data.payload;
      browser.runtime.sendMessage({ type: 'SLY_CHECK_CACHE', payload: data.payload }).then((r: any) => {
        window.postMessage({
          source: 'SLY_BRIDGE_CACHE_RESULT',
          uri,
          title,
          artist,
          result: r
        }, '*');
      }).catch(() => {
        window.postMessage({
          source: 'SLY_BRIDGE_CACHE_RESULT',
          uri,
          error: true
        }, '*');
      });
    }
  });

  // 2. DEFERRED UI INITIALIZATION
  // We wait for the DOM to be ready before starting the store and controllers.
  const initUI = async () => {
    if (!isContextValid()) return;

    const store = new StateStore();
    await store.loadFromStorage();
    await prewarmRuntimeCache(store.runtimeCache);

    const modeController = createModeController({ store });
    const { switchMode, reapplyMode, autoSwitchIfNeeded } = modeController;

    const lifecycleController = createLifecycleController({
      store,
      switchMode,
      reapplyMode,
      autoSwitchIfNeeded,
    });
    const { trySetup, syncSetup, onSongChange, trySetupOrPoll, syncPill, quickApply } = lifecycleController;

    setupMessageListener(store, switchMode);
    const cleanupKeyboard = setupKeyboardShortcuts(switchMode);
    setupSlyBridge(store, switchMode, autoSwitchIfNeeded, syncPill);

    if (!store.domObserver) {
      store.domObserver = createDomObserver({
        onSongChange: (key) => onSongChange(key),
        onLyricsInjected: () => { quickApply(); syncSetup(); },
        onControlsRemoved: () => {
          // Re-inject the pill SYNCHRONOUSLY before the browser paints.
          // When React reconciles the lyrics list (new song render), it evicts our
          // pill. syncPill(true) is a pure DOM operation — no async gaps — so the
          // pill reappears in the same task, before any frame is painted.
          // trySetupOrPoll() then runs the full async setup (observer, mode etc.).
          syncPill(true);
          trySetupOrPoll();
        },
        onLyricsPanelClosed: () => {
          if (store.domObserver) {
            (store.domObserver as any).disconnectViewport();
          }
          document.dispatchEvent(new CustomEvent('sly:panel_close'));
        },
        onLyricsPanelOpened: () => {
          if (store.domObserver) {
            (store.domObserver as any).connectViewport();
          }
        },
        onInvalidate: () => { 
          store.domObserver = null; 
          cleanupKeyboard();
        },
      });
    }

    startStorageListener({
      store,
      onSwitchMode: (m, lang) => switchMode(m, lang),
      onReapplyMode: () => reapplyMode(),

    });

    trySetup();
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
}
