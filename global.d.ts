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
  wrapper: string;
  lyricsList: string;
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
  btnPrimary: string;
  btnPrimaryInner: string;
  btnSecondary: string;
  btnSecondaryInner: string;
  topSpacer: string;
  footerInner1: string;
  footerInner2: string;
}

declare global {
  interface Window {
    SPOTIFY_CLASSES: SpotifyClasses;
    slyScavengeClasses: () => void;
    slyDeepScavengeStyles: () => void;
  }
}

export {};
