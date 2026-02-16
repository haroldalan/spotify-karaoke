# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
