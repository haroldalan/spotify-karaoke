// Port of: lyric-test/modules/common/languages.js

declare global {
  interface Window {
    SLY_NATIVE_LANGUAGES: Set<string>;
  }
}

/**
 * Set of language codes that require native-script verification.
 * Used by the fetch interceptor and detector to identify tracks where
 * Spotify/Musixmatch may return romanized lyrics instead of native script.
 */
export const SLY_NATIVE_LANGUAGES = new Set([
  // Indic scripts
  'hi', 'mr', 'sa', 'gu', 'pa', 'kn', 'ml', 'ta', 'te', 'bn', 'or', 'si', 'ne', 'as',
  // CJK
  'ja', 'ko', 'zh',
  // Cyrillic
  'ru', 'uk', 'bg',
  // Arabic / Persian
  'ar', 'fa',
  // Thai
  'th',
]);

window.SLY_NATIVE_LANGUAGES = SLY_NATIVE_LANGUAGES;
