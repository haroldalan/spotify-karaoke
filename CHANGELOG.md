# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
-   **Multi-Provider Romanization**: Replaced single transliteration library with 8 language-specific romanization providers:
    -   Korean: `@romanize/korean` (Revised Romanization)
    -   Japanese: `@sglkc/kuroshiro` + kuromoji (romaji with morphological analysis)
    -   Chinese: `pinyin-pro` (Mandarin pinyin)
    -   Cyrillic: `cyrillic-to-translit-js` (Russian, Ukrainian, etc.)
    -   Hindi/Telugu/Kannada/Marathi/Thai: `@indic-transliteration/sanscript` (IAST)
    -   Tamil/Malayalam/Bengali: Aksharamukha online API (IAST)
    -   Arabic: Google Translate API (Phonetic) > Aksharamukha (ISO) > Local Fallback
    -   **Batch Processing**: Implemented batch API requests for Google and Aksharamukha to improve performance and rate limits.
    -   Fallback: `yf-hk/transliteration` for all other scripts
-   **Extended Script Detection**: Added Unicode ranges for Devanagari, Bengali, Telugu, Kannada, Malayalam, Thai, Arabic, and Georgian scripts.
-   **Romanization Cache**: In-memory cache prevents re-romanizing identical text on DOM repaints.
-   **Async Provider Dispatch**: Romanization providers now run asynchronously with shimmer loading indicators.

### Changed
-   Refactored `processor.js` to use async provider dispatch with per-line error handling.
-   Updated attribution text to "Romanized by Spotify Karaoke".
-   `manifest.json` now declares `web_accessible_resources` for kuromoji dictionary files.

## [1.2.0] - 2026-02-17

### Added
-   **Dual Lyrics**: Added support for displaying original lyrics below Romanized/Translated text.
-   **UI Improvements**: Added a toggle for Dual Lyrics in the popup.

### Fixed
-   **Stability**: Fixed dependency loading issues and improved error handling.
-   **Renderer**: Fixed syntax errors in DOM manipulation logic.

## [1.1.0] - 2026-02-16

### Added
-   **Batch Translation**: Significantly improved performance by batching lyrics translation requests in groups (debounced), reducing API calls.
-   **Script Detection**: Added support for **Tamil** script detection.
-   **Eager Caching**: Implemented a zero-flicker caching system that restores processed lyrics instantly when Spotify redraws the DOM.

### Fixed
-   **Race Condition**: Fixed an issue where lyrics wouldn't process automatically when switching songs due to late observer attachment.
-   **Dependency Check**: Fixed a bug in `content.js` that caused infinite waiting for dependencies after the recent refactor.

### Changed
-   Refactored `observer.js` to be more robust against React DOM updates.
-   Replaced `dom_cache.js` with the more efficient `eager_cache.js`.

## [1.0.0] - Initial Release

-   Basic Lyrics processing (Romanization/Translation).
-   Support for multiple languages.
-   UI Integration with Spotify Web Player.
