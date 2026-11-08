declare module 'tamil-romanizer' {
  export function romanize(input: string): string;
}


declare module 'cyrillic-to-translit-js' {
  interface CyrillicToTranslit {
    transform(input: string): string;
    reverse(input: string): string;
  }
  interface Options {
    preset?: 'ru' | 'uk';
  }
  function CyrillicToTranslit(options?: Options): CyrillicToTranslit;
  export = CyrillicToTranslit;
}

/**
 * SPOTIFY_CLASSES: The central dictionary of hashed class names used by Spotify.
 */
interface SpotifyClasses {
  mainContainer: string;
  container: string;
  containerClasses?: string;
  wrapper: string;
  wrapperClasses?: string;
  lyricsList: string;
  lyricsListClasses?: string;
  lineBase: string;
  passedLine: string;
  activeLine: string;
  futureLine: string;
  unsynced: string;
  unsyncedMessage: string;
  textInner: string;
  attribution: string;
  paddingLineHelper: string;
  footerGrid: string;
  errorContainer: string;
  /** Secondary "lyrics unavailable" container class. Never scavenged; readers fall back to a hardcoded default. */
  errorContainerAlt?: string;
  btnPrimary: string;
  btnPrimaryInner: string;
  btnSecondary: string;
  btnSecondaryInner: string;
  topSpacer: string;
  footerInner1: string;
  footerInner2: string;
}

declare global {
  /** True in debug builds (SLY_DEBUG=1) only: enables lib/testHooks.ts. */
  const __SLY_TEST_HOOKS__: boolean | undefined;
  interface Window {
    SPOTIFY_CLASSES: SpotifyClasses;
    slyScavengeClasses: () => void;
    slyDeepScavengeStyles: () => void;
  }
}

export {};
