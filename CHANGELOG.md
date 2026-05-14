# Changelog

All notable changes to Spotify Karaoke are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [3.1.2] — 2026-05-11

### Fixed
- **Firefox "Blank Panel" Resolution**: Resolved a critical regression in Firefox where playing a previously cached song in a new session resulted in a blank lyrics panel. Implemented a `safeClone` utility to strip restricted Xray proxies from cross-world objects, ensuring the injection engine can safely enrich them with DOM metadata without crashing.
- **Re-open Sync Restoration**: Fixed a bug where closing and re-opening the lyrics panel for an active song would leave the active line un-highlighted and un-scrolled until the next transition. The renderer now performs an instant sync jump on the first frame of a new DOM.
- **Premature Shimmer Suppression**: Resolved a visual annoyance where skipping a song caused the *outgoing* track's lyrics to shimmer for a split second. The loading state is now decoupled; the UI pill enters a loading state immediately, while the lyrics shimmer is deferred until the new track's native text is visible in the DOM.
- **Takeover Stutter (Skip Race Condition)**: Resolved a race condition where skipping tracks caused a momentary flash of native unsynced lyrics before the extension's synced lyrics could load. Implemented synchronous DOM-based track ID extraction in the song-change handler to eliminate the 600ms bridge-scanner latency.
- **L0 Failure Caching**: Extended the session cache to store explicit "failed" lyric results. Repeated visits to tracks where lyrics are unavailable (even after fallbacks) are now instantaneous and flicker-free, skipping the fetch cycle entirely.
- **Infinite Loop Remediation**: Introduced a dedicated `{ failed: true }` internal state to explicitly mark tracks with missing lyrics, preventing the Decision Engine from re-triggering the fetch cycle infinitely on repeated visits.
- **Seamless Swap Optimization (Pill Glitch)**: Eliminated the "pop-in" effect of the mode selector pill during track swaps. The pill is now preserved in-place during seamless swaps, avoiding the redundant rescue-to-body cycle that caused it to briefly disappear and reappear.
- **Synchronous Injection Guarding**: Hardened the injection pipeline with additional synchronous checks to ensure UI elements are correctly parented and visible before the first animation frame, preventing "ghost" lyrics or missing controls during fast navigation.
- **Renderer Watchdog**: Implemented a self-termination safety net in the synced lyrics renderer. The sync loop now automatically shuts down after a 300-frame timeout if it cannot find its target DOM elements, preventing residual CPU drain during rapid track changes or background transitions.
- **Malayalam Processing Restoration**: Resolved a critical bug where certain Malayalam lines (especially musical notation) were skipped or misaligned. Restored the robust "translation-as-fallback" logic from v3.0.5 and increased chunk context to prevent Google Translate misidentification.
- **Romanization Normalization**: Standardized all romanized lyrics (Hindi, Chinese, Japanese, etc.) to "texting style" ASCII by implementing a global diacritic stripper. All macrons, tone marks, and dots are now removed for better readability.
- **Instant Theme Architecture**: Eliminated the "one-second pop" in background colors for fetching and failure screens. Introduced a dual-layer theme cache (L0 Session + L2 Persistent) that allows vibrant backgrounds to appear synchronously from the very first frame for previously encountered tracks.
- **Source Language Hinting**: Improved the accuracy of the auto-romanization pipeline by propagating song-level script detection as a hint to the translation engine, preventing mixed-language chunks from being misidentified as English.
- **Playback Resume Sync**: Fixed a "time warp" position jump when resuming from a pause. The extrapolator now forces an immediate sync on play to prevent lyrics from flickering forward.
- **Translation Rate-Limit Hardening**: Refactored the translation engine to use a hybrid sequential queue for chunks 2-N. This ensures the 120ms safety delay is strictly enforced, eliminating simultaneous request bursts and 429 errors.
- **Zero-Latency Hijacking**: Corrected an operator precedence bug in the native detector. High-confidence cache hits now trigger UI injection instantly on page load, removing the previous 2-second "settling" delay.
- **Safe-Release Navigation**: Resolved a critical redirect bug where clicking the custom lyrics button while on a fetched panel forced a browser navigation to the New Tab Page. Implemented a "Safe Release" mechanism that clears background Genetic Locks and performs property reversion on the Fiber tree before executing a safe `history.back()`, preventing Spotify's router from crashing due to state inconsistency.
- **DOM Resilience (Scavenger v2)**: Replaced fragile hardcoded CSS class fallbacks with a robust, pattern-matching self-healing scavenger. This ensures the extension survives Spotify's dynamic class obfuscation across weekly deployments.
- **Security & Hygiene**: Restricted `postMessage` origin to `window.location.origin` to prevent data leaks to third-party iframes, and removed global window pollution by refactoring the ad manager into a clean module export.
- **Color Extraction Precision**: Reduced the pixel-sampling stride in color extraction to 4. This ensures dominant color accents on minimalist album covers are no longer missed.
- **Retry Reliability**: Updated the fetch semaphore to respect the `forceRefresh` flag, allowing users to manually re-trigger stalled or failed fetches via the Status HUD.
- **Fetch Continuity & Recovery**: Resolved a regression where closing the lyrics panel would prematurely clear the fetching state. Synchronized lyrics upgrades are now preserved across panel toggles for the same track. Fixed a race condition where fast-finishing fetches would hang on the loading screen due to asynchronous Bridge state latency.
- **Transition Smoothness & Latency**: Eliminated the 50ms debounce in the content script and implemented "Pre-Injection Mirroring," ensuring background themes appear instantly without frame-yield flicker.
- **Romanized Tab Casing**: Implemented an on-the-fly capitalization transform for processed lyrics, ensuring the first letter of each line is capitalized (e.g., "(dha-" -> "(Dha-") for both new and cached entries.
- **Bridge Reliability (Flicker Guard)**: Tapered the bridge-level toggle timeout from 300ms to 100ms, improving responsiveness and preventing "double-toggle" races during rapid interactions.
- **State Ownership Consolidation**: Fixed a state desync bug by unifying the `window` scope and module-import references under a single mutable object, ensuring all components see the same track metadata in real-time.
- **Sync Button Restoration**: Surgically fixed a miswired activation call in the `TakeoverEngine` that prevented the floating "Sync" button from appearing on custom synced lyrics.
- **Intentional Auto-Scroll Behavior**: Removed the 5-second inactivity timeout for auto-scrolling. Lyrics sync now remains paused indefinitely when the user scrolls away, allowing for uninterrupted reading.
- **Context-Aware Auto-Resume**: Implemented auto-resume logic that intelligently snaps back to sync only when the user manually scrolls the active line back into view, or when the song naturally progresses into the user's current viewport.
- **Systematic Audit Remediation**: Successfully completed a comprehensive 41-point technical audit and remediation, resolving all verified logic, security, and DOM stability findings.

## [3.1.1] — 2026-05-08

### Added
- **Stability & Hardening Release**: Conducted a comprehensive lifecycle audit to resolve intermittent desync and timing issues across all supported browsers.

### Fixed
- **Musixmatch Background Migration**: Moved all Musixmatch network operations to the Background Service Worker. This resolves the `401: captcha` error by simulating official mobile client headers, ensuring reliable lyrics fetching even during high-traffic sessions.
- **Firefox Lifecycle Hardening**: Resolved `TypeError: document.head is null` and `MutationObserver` crashes that occurred on Firefox during the initial page load. The extension now safely defers DOM injection until the browser environment is fully ready.
- **Background Desync "Death Loop"**: Patched a critical circular dependency where the extension would accidentally read its own injected DOM while the tab was throttled in the background, causing it to incorrectly assume lyrics were unsynced.
- **Self-Healing Recovery**: Pipeline A (Custom Lyrics) now actively monitors native synced state and will automatically "release" control back to Spotify if native synced lyrics are recovered mid-session.
- **DataCloneError Correction**: Fixed a messaging bug where Promises were accidentally passed to `postMessage` before resolution.

## [3.1.0] — 2026-04-30

### Added
- **Custom Lyrics Engine (`slyCore`)**: Introduced a massive new rendering engine that can fetch and display lyrics for songs that Spotify natively marks as "Missing" or "Unsynced". The extension now independently fetches lyrics from Musixmatch and seamlessly injects a custom, pixel-perfect synced lyrics UI (`#lyrics-root-sync`) directly into the page.
- **Custom Synced Renderer**: Built a standalone `requestAnimationFrame` synced lyrics renderer to animate the new custom DOM, perfectly matching Spotify's native active/passed/future highlighting behavior.
- **Status HUD**: Added a native-style Loading/Error HUD to provide visual feedback while custom lyrics are being fetched in the background.
- **Design Overhaul**: Redesigned the lyrics controls to perfectly match Spotify's native pill-shaped design aesthetics, including dynamic backdrop-filter blur effects.
- **Enhanced Loading State**: The shimmering loading effect is now more reliable, with strict teardown guarantees even when translations are aborted or fail.

### Changed
- **Architectural Rewrite**: Completely refactored the monolithic 40KB content script (`index.ts`) into a highly modular architecture within the new `lib/` directory to support the new `slyCore` engine.
- **Separation of Concerns**: Split the core extension logic into `slyCore` (handling deep Spotify DOM manipulation and custom lyrics fetching/injection) and `Pipeline B` (handling mode pill orchestration, state management, and synced lyrics rendering).

### Fixed
- **Infinite Loop on Unsynced Lyrics**: Patched a critical bug where custom unsynced lyrics would cause the DOM to rapidly re-inject every 500ms due to an orphaned `sly:takeover` event.
- **Stranded Mode Pill Bug**: Fixed a race condition where quickly skipping tracks would trap the extension's UI pill inside Spotify's hidden native container, effectively breaking all extension features until a reload.
- **Race Condition Guard**: `Pipeline B` now actively aborts UI injection if `slyCore` is busy hijacking the DOM, preventing conflicting layout rendering.

## [3.0.5] — 2026-04-07

### Added
- **Unlimited Lyrics Storage**: Integrated the `unlimitedStorage` permission and optimized the content script to bypass the default 10MB local layout quota.
- **Auto-Scaling Storage UI**: Updated the extension popup to automatically scale storage usage labels between KB and MB for high-capacity lyric libraries.
- **Romanization Fast-Path Prioritization**: Refined the mode-switching logic to prioritize high-quality romanization, preventing low-quality fallback data from entering the cache when better alternatives exist.

### Fixed
- **Cache Eviction Lifecycle**: Removed redundant LRU eviction logic and byte-size accounting from the content script to simplify the local database structure.
- **Permission Compliance**: Refined the internal security audit test suite to handle the new `unlimitedStorage` requirement while maintaining strict host-permission guards.
- **Background Synchronization Tests**: Fixed regression in background unit tests specifically relating to the internal line-truncation return types.

## [3.0.5] — 2026-04-04

### Added
- **Technical Audit & Resiliency**: Conducted a comprehensive technical audit of the extension architecture for v3.0.5.
- **Fetch Generation Isolation (isStale Fix)**: Implemented per-track generation maps in the fetch interceptor to prevent cross-song "poisoning" during rapid background pre-fetches.
- **Race Condition Guard**: Implemented a three-layer "Poison Guard" in the content script to prevent empty DOM snapshots from corrupting the lyrics cache during Spotify's React rendering cycles.
- **Interceptor Optimization**: Moved the generation increment after validation guards, ensuring no generations are wasted on Latin/already-dense songs.
- **Memory Management**: Fixed a memory leak in the fetch interceptor by ensuring pending metadata callbacks are properly cleaned up on timeout.
- **Robust Romanization**: Added word-boundary truncation for long lyric lines to maintain 1:1 index alignment for translations while staying within API limits.
- **Improved Resiliency**: Added retry logic for Kuroshiro initialization and defensive null-guards for track ID conversions.
- **Optimized Script Mapping**: Expanded the `LATIN_LIKE_LANGS` whitelist and refined script-to-language mappings to skip redundant API calls for most Latin script variants.
- **Test Suite Stabilization**: Resolved persistent Vitest environment invariant failures and module resolution errors for a 100% green CI pass.
- **Expert-Audited Validation**: Conducted a final technical validation with external experts, confirming architectural decisions and resolving a long-standing documentation drift for the v3.0.5 release.
- **Documentation & Privacy Polish**: Revamped the README with a technical "Under the Hood" summary and expanded the Privacy & Disclaimer section for full transparency on MyMemory fallback and cache eviction logic.

## [3.0.4] — 2026-04-01

### Added
- **Industrial-Strength Reliability**: Implemented a'global `try/catch` and "Brotli-Safe" header sanitation in the `fetch` interceptor, eliminating the "Couldn't load lyrics" error.
- **Performance Optimization**: Moved the Musixmatch token acquisition to the module initialization level, ensuring the token is ready before the first song plays. 
- **Persistent Token Warming**: Implemented 55-minute `localStorage` caching for tokens to prevent API rate-limiting on page reloads.
- **Header Sanitation**: Fixed a-bug where the internal `catch` block could return compressed responses; now ensures all fallbacks are uncompressed.

### Fixed
- **Redundant Logic**: Removed dead bootstrap code and duplicate variable declarations in the interceptor.
- **isDenseTypeface Guard**: Restored the guard to prevent unnecessary API calls when Spotify is already serving the correct native script.

## [3.0.3] — 2026-04-01

### Added
- **Intelligent Auto-Detection**: The extension now detects your browser's language (`navigator.language`) on first install and automatically selects it as the target translation language. 
- **Language List Re-organization**: Re-ordered the 100+ language list to put global-tier languages (English, Chinese, Spanish, Hindi, etc.) at the top for faster access.
- **UI Polish**: Refined the language picker's styling and hover states to match the premium Spotify-dark aesthetic.

## [3.0.2] — 2026-04-01

### Added
- **Stability Overhaul**: Moved the fetch interceptor to a Manifest-registered `world: 'MAIN'` unlisted script. This solves the "reload" race condition by ensuring the monkey-patch is applied before Spotify's code even starts.
- **Global Native Restoration**: Expanded the restoration engine to support all non-Latin languages (Thai, Arabic, Greek, etc.) where Spotify serves a Romanized fallback.
- **Metadata Guard**: Implemented smart checks to automatically skip restoration on "English Versions" or "International Covers" to prevent lyrics mismatches.

### Fixed
- **Instrumental Symbols**: Fixed a bug where music symbols (`♪`, `🎵`) were stripped during native script restoration. Instrumental breaks are now preserved exactly as in the original source.

## [3.0.1] — 2026-03-31

### Added
- **TypeScript Migration**: Refactored the core fetch interceptor from a standard JS file into a WXT-managed TypeScript unlisted script for better stability.
- **Zero-Latency Startup**: Implemented a synchronous mirror architecture in the popup. By initializing settings from `localStorage` before reconciling with the cloud, the UI now has an "instant-on" feel with zero flickering.
- **Unlimited Lyrics Cache**: Added the `unlimitedStorage` permission to bypass default browser quotas, allowing the local lyrics cache to scale with any library size.
- **UI Polish**: Refining the storage usage display and overhauling the "Reset Data" confirmation modal to match Spotify's design system.

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
