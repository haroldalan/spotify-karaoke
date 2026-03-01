# Changelog

All notable changes to Spotify Karaoke are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.3] — 2026-03-01

### Fixed

- **Reliable fetch-interceptor injection.** The interceptor is now injected via an ISOLATED-world `document_start` content script (`spotify-inject.content.ts`) that inserts a `<script src="chrome-extension://...">` tag pointing to `fetchInterceptor.js`. Spotify's CSP explicitly whitelists the extension's `chrome-extension://` origin in `script-src`, so the injection is CSP-compliant. Because the source file is bundled inside the extension package (no network round-trip), it loads significantly faster than Spotify's own service-worker–cached scripts and reliably wins the race. An earlier attempt using `world: 'MAIN'` manifest registration and `script.textContent` inline injection were both investigated and ruled out due to a Chromium bug with `world: 'MAIN'` on Service Worker–cached sites and Spotify's `'unsafe-inline'` CSP restriction respectively.
- **Flash of original lyrics on song switch.** The previous `preloadedCacheEntry` mechanism started an async `browser.storage.local.get()` on song change, then expected the result to be available when the synchronous `syncSetup()` ran milliseconds later. The storage promise always arrived too late, causing a cache miss and a visible flash of original lyrics. Replaced with a synchronous in-memory `runtimeCache` Map that `saveSongCache` populates immediately after every API round-trip. `syncSetup` now reads from this Map with zero latency.
- **MutationObserver batch-ordering race.** Spotify can emit the `aria-label` attribute mutation (song key change) and `lyrics-line` childList mutations in the same observer batch, in any order. If lyrics nodes arrived first, `syncSetup` looked up the wrong (previous) song key in the runtime cache. Split the observer callback into two explicit passes — Pass 1 processes all attribute mutations (song key update), Pass 2 processes all childList mutations (lyrics injection) — ensuring `onSongChange` always completes before `syncSetup` reads `songKey`.
- **Gap between shimmer ending and translated lyrics appearing.** `setLoadingState(false)` was called before `applyLinesToDOM`, briefly exposing raw original lyrics after the shimmer stopped. Reversed the call order: DOM text is now updated while `.sly-loading` is still active (text content is hidden via `-webkit-text-fill-color: transparent`), then the shimmer is removed, revealing already-correct text in a single paint frame.
- **Stale `data-sly-original` attributes in Scenario A.** When `applyNativeOverride` rewrote DOM lines with native-script text, the `data-sly-original` attributes were not updated, leaving the extension's snapshot and the DOM permanently out of sync. Attributes are now updated alongside `el.textContent`.
- **Double-fetch race condition.** `syncSetup` and `trySetup` could both reach `autoSwitchIfNeeded()` for the same song and fire duplicate `PROCESS` IPC requests. A `pollId` guard now cancels the rAF chain after `syncSetup` handles a cache hit, preventing the redundant call.
- **`characterData: true` observer overhead.** The `lyricsObserver` was observing text-node mutations, firing on every karaoke highlight tick. Dropped `characterData: true` — `childList: true` alone is sufficient to detect Spotify overwriting the extension's injected text.
- **Firefox LRU cache eviction.** `getBytesInUse` is not available in Firefox, causing `evictIfNeeded` to silently fail and the cache to grow without bound. Added a count-based LRU fallback that triggers when the total entry count exceeds a threshold, compatible with both Chrome and Firefox.
- **Google Translate romanization-block detection.** The heuristic for identifying Google Translate's `dt=rm` output block was too narrow and could drop the last translated line of a chunk. Tightened the detection condition.
- **Odia language support.** Added `'or'` to `INDIAN_LANGUAGE_CODES` in the fetch interceptor so Odia songs served with romanized fallbacks correctly trigger native-script restoration.
- **Musixmatch token invalidation.** On a 401/402 response from Musixmatch, `_tokenExpiry` was not reset to `0`, so the stale token would be reused until its original TTL expired. Now resets to `0` immediately so the next call fetches a fresh token.

### Added

- **Tamil romanization via `tamil-romanizer`.** Tamil is now romanized locally using the `tamil-romanizer` library (practical phonetic output: `zh`, `th`, `aa` digraphs) instead of Google Translate's `dt=rm` (ISO 15919 diacritics). Romanization and translation now run in parallel, matching the pattern used for Japanese, Korean, Chinese, and other scripts. A `'tamil': 'ta'` entry is also added to the native-language fast-path so translation is skipped when the user's target language is already Tamil.
- Odia (`or`) added to the list of supported Indian-language scripts for native-script restoration.

### Changed

- **Popup reset confirmation.** Replaced the browser `window.confirm()` dialog with an inline two-step confirmation UI in the popup. Avoids upcoming browser restrictions on synchronous dialogs in extension contexts.
- `fetchInterceptor.js` remains in `public/` and is registered under `web_accessible_resources`; injected via `spotify-inject.content.ts` using `<script src>` at `document_start`.
- `CHUNK_DELAY_MS` annotated with a rationale comment explaining the empirical rate-limit basis.
- Synchronized `NON_LATIN_SCRIPT_RE` in `index.ts` with `detectScript()` ranges in `background.ts` via a maintenance comment.
- Removed duplicate `.wxt` entry from `.gitignore`.
- **README rewritten.** Replaced the developer-first, superlative-heavy original with a user-first document: plain description, screenshots up front, accurate romanization coverage table (Tamil now listed as local), and a clean developer setup section.

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
