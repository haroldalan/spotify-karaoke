# Changelog

All notable changes to Spotify Karaoke are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [3.0.0] — 2026-03-31

### Added

- **Popup remote control pill.** A miniaturized replica of the on-page lyrics pill is now embedded at the top of the extension popup, under the label "Active Mode". Clicking Original, Romanized, or Translated in the popup instantly switches the live lyrics on the Spotify page — no need to open the lyrics panel or interact with the floating controls. The pill always reflects the current active mode.
- **Show Floating Controls toggle.** A new toggle in the popup ("Show Floating Controls") allows users to permanently hide the on-page mode-selector pill. When hidden, the popup pill and keyboard shortcuts provide full control, keeping the Spotify lyrics view completely unobstructed for a distraction-free experience.
- **Keyboard shortcuts.** While the Spotify lyrics panel is open, press `O`, `R`, or `T` to instantly switch to Original, Romanized, or Translated mode respectively. Shortcuts are context-safe: they do not fire when the cursor is in a text input, search bar, or any contenteditable element, and they ignore modified combos (`Ctrl`, `Alt`, `Meta`) to avoid browser conflicts.
- **Shortcut hint in popup.** The popup now displays a plain-language shortcut reference beneath the Active Mode pill: *"While viewing lyrics, press O for Original, R for Romanized, or T for Translated — works even when the floating controls are hidden."*

### Fixed

- **Redundant shimmer on cached songs.** When returning to a previously listened song, the fetch interceptor would deliver native lyrics to the content script even though the persistent cache had already loaded the correct lines. The content script was incorrectly treating this as a new native override, wiping the in-memory translated cache and triggering a needless shimmer + re-translation cycle. Added an early-exit check: if the intercepted native lines are byte-for-byte identical to the already-loaded `cache.original`, the payload is discarded silently.
- **Romanized mode cache miss after language change.** Changing the target translation language in the popup while on the Romanized tab caused subsequent song skips to miss the cache. Romanized lines are script-intrinsic and do not depend on the translation target language; the extension now resolves romanized text from any existing cached language bucket rather than requiring an exact language-key match.
- **Button state regression during async translation.** Clicking the Translated button while a translation network request was in flight could cause the active pill button to snap back to the previous mode when Spotify scrolled the active lyric line. This happened because `syncSetup()` fired mid-request and overwrote the optimistic button state. Introduced `isSwitchingMode` flag: `syncSetup` now yields without touching button states or mode variables when a manual switch is already in progress.
- **`currentActiveLang` not updated on language change while in Romanized mode.** The storage listener only updated `currentActiveLang` when the active mode was Translated. This caused the next switch to Translated to use a stale language code. `currentActiveLang` is now always updated when `targetLang` changes in storage, regardless of current mode.
- **Native lyrics fetch reliability.** Hardened the fetch interceptor token management and retry logic. Fixed a critical early-exit bug where the absence of `providerLyricsId` in Spotify's API response aborted the entire interceptor before fallback Strategy 2 (Spotify Track ID lookup) could be attempted. Added strict empty-array detection so a zero-line result from Strategy 1 properly falls through to Strategy 2 instead of being treated as a successful (but empty) response.

---

## [2.0.4] — 2026-03-12

### Fixed

- **Persistent cache destruction.** Spotify occasionally injects temporary "dummy" text (e.g., `♪` or blank lines) before the real lyrics arrive over the network. The extension's strict `JSON.stringify` coherence checks were failing against this dummy text, leading to the destructive wipe of previously saved romanizations and translations from `browser.storage.local`. Replaced the strict coherence algorithm with a simple line-count equivalence check; if the lengths match, the extension forcefully restores the persistent disk cache, ignoring Spotify's temporary UI state.
- **Delayed cache hydration (Flash of Original Lyrics).** When skipping songs quickly, the async `browser.storage.local.get` API was yielding control to the DOM renderer before resolving, allowing Spotify to paint a flashing frame of the native lyrics text. Re-architected the `main()` initialization to perform a synchronous bulk-load of all cache entries directly into the `runtimeCache` map immediately on script boot, and paired it with aggressive pre-loading inside `onSongChange`. This guarantees zero-latency, synchronous cache retrieval precisely before `requestAnimationFrame` fires.
- **Orphaned `handleNativeLyrics` cache miss.** Native script restoration loops from `fetchInterceptor` were failing to pull the translated cache from disk because `handleNativeLyrics` was overwriting the active snapshot before a disk check occurred. Inserted an explicit `loadSongCache()` await immediately after updating `cache.original` during intersection.

### Testing & Verification

- **Rigorous JSDOM Integration Overhaul.** Excised the simplistic `happy-dom` abstraction from the testing pipeline entirely in favor of a full `jsdom` DOM implementation. `index.test.ts` was rewritten to structurally simulate Spotify's physical DOM shapes, explicitly forcing deterministic `MutationObserver` race conditions to mathematically verify the cache coherency optimizations.
- **Network Interception Mocks.** `fetchInterceptor.test.ts` was isolated and reinforced with a dual-tiered mock HTTP stack that authenticates simulated Musixmatch payload intercepts, guaranteeing cross-origin API extraction paths remain uncompromised.

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

### Testing & Pipeline

- **Hybrid Testing Suite.** Replaced legacy, brittle E2E frameworks with a rigorous hybrid workflow. Core mathematical logic (background chunking scripts) and Preact UI interactions are covered by a highly-concurrent `vitest` unit/component testing suite running in isolation.
- **Static Security Audit.** Added strict abstract syntax tree checks (`security.test.ts`) that analyze the WXT compilation manifest to algorithmically guarantee the absence of broad host permissions (`<all_urls>`) or heavy capabilities (`webRequestBlocking`), preventing security regressions before they build.

### Changed

- **Custom Settings UI Modal.** Replaced the brittle native browser extension `window.confirm()` popup calls with a fully synthesized, custom Preact modal overlay matching the Spotify design system. This resolves a known Firefox squishing bug where native alerts render restricted inside the 400x500 popup frame rather than full screen.
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
