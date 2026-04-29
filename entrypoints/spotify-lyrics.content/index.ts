import './style.css';
import { isContextValid } from '../../lib/utils/browserUtils';
import { createDomObserver } from '../../lib/dom/domObserver';
import { startStorageListener } from '../../lib/core/storageListener';
import { createModeController } from '../../lib/core/modeController';
import { createLifecycleController } from '../../lib/core/lifecycleController';
import { StateStore } from '../../lib/core/store';
import { setupKeyboardShortcuts } from '../../lib/core/keyboardListener';
import { setupMessageListener } from '../../lib/core/messageListener';
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
import '../../lib/slyCore/statusHud';
import '../../lib/slyCore/messaging';
import '../../lib/slyCore/ui';
import '../../lib/slyCore/events';
import '../../lib/slyCore/content';
// Ensure module loads (suppresses unused-import lint warnings)
void SLY_NATIVE_LANGUAGES;

export default defineContentScript({
  matches: ['*://open.spotify.com/*'],
  runAt: 'document_idle',
  main,
});


async function main(): Promise<void> {
  // Register SLY_BRIDGE listener — populates window.spotifyState from scanner postMessages
  initSlyState();

  if (!isContextValid()) return;

  const store = new StateStore();
  await store.loadFromStorage();

  const modeController = createModeController({ store });
  const { switchMode, reapplyMode, autoSwitchIfNeeded } = modeController;

  const lifecycleController = createLifecycleController({
    store,
    switchMode,
    reapplyMode,
    autoSwitchIfNeeded,
  });
  const { trySetup, syncSetup, onSongChange } = lifecycleController;

  setupMessageListener(store, switchMode);
  setupKeyboardShortcuts(switchMode);

  if (!store.domObserver) {
    store.domObserver = createDomObserver({
      onSongChange: (key) => onSongChange(key),
      onLyricsInjected: () => syncSetup(),
      onControlsRemoved: () => trySetup(),
      onInvalidate: () => { store.domObserver = null; },
    });
  }

  startStorageListener({
    store,
    onSwitchMode: (m, lang) => switchMode(m, lang),
  });

  trySetup();
}
