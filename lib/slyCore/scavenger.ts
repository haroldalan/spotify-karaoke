// Port of: lyric-test/modules/core/scavenger.js

/**
 * SPOTIFY_CLASSES: The central dictionary of hashed class names used by Spotify.
 * These are updated dynamically by the scavenger if Spotify changes them.
 */
export interface SpotifyClasses {
  container: string;
  wrapper: string;
  lyricsList: string;
  lineBase: string;
  // Synced States (Native Hashes)
  passedLine: string;
  activeLine: string;
  futureLine: string;
  // Unsynced States
  unsynced: string;
  unsyncedMessage: string;
  // Utils
  textInner: string;
  attribution: string;
  paddingLineHelper: string;
  footerGrid: string;
}

declare global {
  interface Window {
    SPOTIFY_CLASSES: SpotifyClasses;
    slyScavengeClasses: () => void;
  }
}

export const SPOTIFY_CLASSES: SpotifyClasses = {
  container:         'bbJIIopLxggQmv5x',
  wrapper:           'ktJDHL_Wb5k6zJxf',
  lyricsList:        'GmI3DMxKYRsaA5DM',
  lineBase:          'WnslfFBWTgOIUgNH',
  // Synced States (Native Hashes)
  passedLine:        'XiH9KR6bhDwEFykV',
  activeLine:        'RL7r4lsMHxMySdFr',
  futureLine:        'Mnf9PkrVHsX90BNf',
  // Unsynced States
  unsynced:          'AQFBg9wNhDoKJHvS',
  unsyncedMessage:   'ReC7DlF3I_k9g6Vv',
  // Utils
  textInner:         'a8PTgYsfzc07Np9G',
  attribution:       'NUBq_wlyuwoDUsSg',
  paddingLineHelper: 'aLaX8poOH8kdbmGf',
  footerGrid:        'T0IQrE6mvz4Fs7rc',
};

window.SPOTIFY_CLASSES = SPOTIFY_CLASSES;

/**
 * DYNAMIC CLASS SCAVENGER
 * Inspects live Spotify elements to discover updated hashed classes.
 * This allows the extension to survive Spotify updates without a manual patch.
 */
export function slyScavengeClasses(): void {
  console.log('[sly-scavenger] Inspecting DOM for class updates...');

  const nativeContainer = document.querySelector(`main.J6wP3V0xzh0Hj_MS div[class^="bbJ"]:not(#lyrics-root-sync)`) as HTMLElement | null;
  if (nativeContainer) {
    window.SPOTIFY_CLASSES.container = nativeContainer.classList[0] || window.SPOTIFY_CLASSES.container;

    const wrapper = nativeContainer.querySelector('div[class^="ktJ"]');
    if (wrapper) window.SPOTIFY_CLASSES.wrapper = wrapper.classList[0] || window.SPOTIFY_CLASSES.wrapper;

    const list = nativeContainer.querySelector('div[class^="GmI"]');
    if (list) window.SPOTIFY_CLASSES.lyricsList = list.classList[0] || window.SPOTIFY_CLASSES.lyricsList;

    const lines = nativeContainer.querySelectorAll('[data-testid="lyrics-line"]');
    if (lines.length > 0) {
      window.SPOTIFY_CLASSES.lineBase = lines[0].classList[0] || window.SPOTIFY_CLASSES.lineBase;
    }
    console.log('[sly-scavenger] Fingerprinting complete — dictionary updated from live DOM.');
  } else {
    console.log('[sly-scavenger] Native container not visible — using cached fingerprints.');
  }

  const attr = document.querySelector('div[class^="NUB"]');
  if (attr) window.SPOTIFY_CLASSES.attribution = attr.classList[0] || window.SPOTIFY_CLASSES.attribution;

  const foot = document.querySelector('div[class^="T0I"]');
  if (foot) window.SPOTIFY_CLASSES.footerGrid = foot.classList[0] || window.SPOTIFY_CLASSES.footerGrid;
}

window.slyScavengeClasses = slyScavengeClasses;
