# Changelog

All notable changes to Spotify Karaoke are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.2] — 2026-02-23

### Added
- **Native script restoration for Indian-language songs.** Spotify surfaces romanized fallback lyrics (e.g. *"un peyaryl en perai cherttu"*) even when Musixmatch holds the original native-script version. A `document_start` content script now monkey-patches `window.fetch` in the page's main world to intercept `spclient.wg.spotify.com/color-lyrics/v2/track/*` responses. When `isDenseTypeface: false` is detected for a supported Indian-script language, the extension fetches an anonymous Musixmatch token and retrieves native-script synced subtitles via three fallback strategies (`commontrack_id` subtitle → Spotify ID lookup → unsynced lyrics). The original `Response` is replaced entirely so Spotify's React renderer displays native script as the primary lyrics — no DOM patching required. Romanize and Translate modes now operate on the correct source script.
- Supported scripts: Hindi, Tamil, Telugu, Kannada, Malayalam, Gujarati, Punjabi, Marathi, Sanskrit, Bengali.
- Added `*://spclient.wg.spotify.com/*` and `*://apic-desktop.musixmatch.com/*` host permissions.

---

## [2.0.1] — 2026-02-23

### Fixed
- Resolved `Identifier 'text' has already been declared` build error in the background script.
- Corrected Firefox `strict_min_version` to `142.0` for AMO compliance with the new `data_collection_permissions` manifest field.

---

## [2.0.0] — 2026-02-19

### Changed
- **Complete architectural rewrite** using [WXT](https://wxt.dev), Vite, TypeScript, and Preact. The previous vanilla JS manifest was replaced with a full build pipeline producing optimized Chrome MV3 and Firefox MV2 bundles.
- Background script migrated to a proper WXT `background.ts` entrypoint with structured romanization orchestration and smart chunking translation.
- Content script rewritten as a `MutationObserver`-driven DOM injection engine with debounced setup, per-song caching, and `processGen` request cancellation to handle Spotify's aggressive React recycling.

### Added
- **Dual Lyrics Mode** — displays the romanized/translated line as the primary with the original interleaved directly below, injected into Spotify's React tree with zero flicker.
- **Persistent Preferred Mode** — user's last-selected mode (Original / Romanized / Translated) is saved to `storage.sync` and auto-applied on the next song or page load.
- **On-page pill controls** — Original / Romanized / Translated switcher injected directly into the lyrics panel, no popup required.
- **Preact popup** with language selector (100+ languages), Dual Lyrics toggle, and storage usage indicator.
- Romanization support for Japanese (Kuroshiro + Kuromoji local dictionary), Korean (`@romanize/korean`), Chinese (`pinyin-pro`), Indic scripts (`@indic-transliteration/sanscript`), Cyrillic (`cyrillic-to-translit-js`), Thai (`@dehoist/romanize-thai`), and a `transliteration` error fallback.
- Translation via Google Translate API with automated MyMemory fallback and smart chunking to avoid 429 rate limits.
- Firefox Xray wrapper fix for Kuroshiro: deep-clones the `Uint8Array` buffer before passing it to `fflate.gunzipSync` to strip Firefox's content script isolation wrappers.
- Batch romanization: lyrics are queued and dispatched per-provider in a single round-trip.

---

## [1.x] — Prior to 2026-02-17

Legacy vanilla JS extension. No formal changelog maintained.
