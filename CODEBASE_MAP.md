# Spotify Karaoke Codebase Map (God Doc)

> [!WARNING]
> **LIVING DOCUMENT**
> This file is the definitive navigation helper for the entire codebase. It must be updated immediately whenever structural or architectural changes are made to the project.

---

## 🏗️ Architecture Overview & Data Flow
Spotify Karaoke uses a multi-layered architecture powered by the WXT framework. Because Spotify relies heavily on React Fiber state, this extension operates by injecting code directly into the webpage's environment (`MAIN` world) to extract tokens and force UI changes.

**The Two Pipelines:**
* **Pipeline B (Native Hijack):** If Spotify *has* lyrics, Pipeline B runs. It reads Spotify's React Fiber tree to extract the original text, sends it to the background for processing, and then surgically overwrites Spotify's native DOM nodes to inject Dual Lyrics without breaking React's event listeners.
* **Pipeline A (`slyCore` Engine):** If Spotify *lacks* lyrics, Pipeline A runs. It hides Spotify's native UI entirely and injects a custom, fully independent DOM container (`#lyrics-root-sync`). It uses `requestAnimationFrame` and a wall-clock extrapolation loop to animate lyrics identically to Spotify's native engine.

---

## 📑 Table of Contents
- [Domain 1: Framework, Configuration & Entrypoints](#domain-1:-framework-configuration-entrypoints)
- [Domain 2: Pipeline B (Native React Hijacking)](#domain-2:-pipeline-b-native-react-hijacking)
- [Domain 3: Pipeline A (slyCore Fallback Engine)](#domain-3:-pipeline-a-slycore-fallback-engine)
- [Domain 4: Data Fetching & Caching](#domain-4:-data-fetching-caching)
- [Domain 5: Transliteration & Translation](#domain-5:-transliteration-translation)
- [Domain 6: User Interface & State Syncing](#domain-6:-user-interface-state-syncing)
- [Domain 7: Security, Testing & CI/CD](#domain-7:-security-testing-ci/cd)

---

## Domain 1: Framework, Configuration & Entrypoints

The boot sequence. This covers the extension manifest, build dependencies, and the fundamental scripts that inject into Spotify's `MAIN` world to hijack React.

### `wxt.config.ts` & `package.json`
The Framework configuration.
- `wxt.config.ts`: Dynamically generates the `manifest.json`. Configures the `MAIN` world content script injections (`slyBridge.ts`), declares host permissions for external APIs (Google Translate, LRCLIB, YouTube Music), and sets up `declarativeNetRequest` rules for YTM fetch spoofing.
- `package.json`: Manages the 10+ local transliteration dependencies (Kuroshiro, Sanscript, Pinyin-Pro, etc.) and exposes the Vite/WXT build commands (`wxt build`, `wxt zip -b edge`, etc.).

### `entrypoints/background.ts`
The Background Service Worker. This is the brain of the extension. It runs in an isolated background thread to keep Spotify's UI silky smooth. It handles messages from the content scripts:
- **`PROCESS`**: Takes an array of lyric strings and routes them to local transliteration libraries or Google Translate APIs.
- **`GET_COLOR`**: Fast-tracks album art color extraction for the custom UI.
- **`FETCH_LYRICS` & `PREFETCH_LYRICS`**: Orchestrates the multi-source smart fetch engine (YouTube Music / LRCLIB) when Spotify fails to provide lyrics. It utilizes a highly optimized **4-Layer Cache** (`L1: Memory` -> `L2: Persistent` -> `L3: In-Flight deduplication` -> `L4: Network`). It also includes an "Upgrade Logic" system that silently checks unsynced lyrics in the background to see if a synced version has become available.

### `entrypoints/fetchInterceptor.ts`
An unlisted script compiled and injected into the `MAIN` world.
- **Purpose:** Native Script Restoration.
- **How it works:** It monkey-patches the browser's native `window.fetch` method. When Spotify tries to download lyrics (`spclient.wg.spotify.com/color-lyrics/v2/track/`), the interceptor holds the response, asks the background for the native script (`lib/lyricsProviders/nativeLyrics.ts`: YouTube Music, then LRCLIB), and swaps out the romanized fallback that Spotify was trying to serve. Spotify's React app is entirely unaware it received injected data.

### `entrypoints/slyBridge.ts`
An unlisted script injected into the `MAIN` world, serving as the ultimate "hack" into Spotify's React state. 
- **The Scanner:** Runs a `setInterval` loop that traverses the DOM, finds the React Fiber nodes (`__reactFiber$*`), and extracts the current track metadata, access tokens, and the user's upcoming queue directly from React's memoized props. It broadcasts this state out via `window.postMessage`.
- **The Genetic Shield:** Spotify often disables the "Lyrics" button when it thinks lyrics aren't available. The shield constantly scans the React tree, finds the internal `disabled` prop on the lyrics button, and forcefully overrides it using `Object.defineProperty` (a "Genetic Lock"), forcing the button to be clickable so our custom `slyCore` engine can inject missing lyrics. It also extracts the internal `toggleLyrics()` function so the extension can open the lyrics panel programmatically.

### `lib/slyCore/state.ts`
The Global Brain.
- Defines two massive, globally accessible state objects: `window.spotifyState` (which the `MAIN` world interceptors continuously update with live React props) and `window.slyInternalState` (which tracks the extension's own operational state, like active fetches and UI locks).

---

## Domain 2: Pipeline B (Native React Hijacking)

The system used when Spotify natively provides lyrics. We interoperate with React, read its internal props, and surgically overwrite DOM nodes to inject translations without breaking Spotify's UI.

### `lib/core/lifecycleController.ts`
The Maestro.
- Manages the extension's entire lifecycle on the Spotify page.
- **`trySetup` & `syncSetup`**: Detects when the lyrics panel has loaded, triggers the extraction of native lyrics, and injects the floating control pill.
- **`onSongChange`**: Instantly clears caches, resets modes, and broadcasts a signal to the `slyCore` engine.
- Contains the `setupSlyBridge()` logic, which dictates how Pipeline B gracefully hands over control to the `slyCore` engine if native lyrics fail.

### `lib/core/modeController.ts`
The State Machine.
- Handles the core logic behind the `switchMode` function (`original`, `romanized`, `translated`).
- Determines when to fire off a `fetchProcessed` translation request. Once translations arrive, it dynamically calculates which DOM nodes to target and rewrites them on the fly.

### `lib/dom/domObserver.ts`
The Sentinel.
- A surgically precise `MutationObserver` watching `document.body`.
- Watches `[data-testid="now-playing-widget"]`'s `aria-label` to instantly detect track skips.
- Watches `[data-testid="lyrics-button"]`'s `data-active` attribute to instantly detect when the user closes the lyrics panel.

### `lib/dom/lyricsDOM.ts`
The DOM Surgeons.
- **`snapshotOriginals`**: Extracts the original text right out of Spotify's React nodes and saves them in the `SongCache` memory before we overwrite them.
- **`applyLinesToDOM`**: Physically rewrites the text content of the React nodes to inject our custom translations. It specifically creates the `sly-main-line` and `sly-dual-line` `<span>` elements to render Dual Lyrics safely.

### `lib/core/syncedLyricsRenderer.ts`
The Independent Synchronizer.
- A standalone `requestAnimationFrame` loop.
- When injecting synced lyrics, we completely hijack Spotify's native scrolling and highlighting mechanism. This renderer calculates the exact millisecond `activeIndex` based on wall-clock extrapolation (from Phase 2's `playback.ts`) and manually applies Spotify's own CSS classes (`active`, `passed`, `future`) to the lyric lines, ensuring 60fps buttery-smooth scrolling that is completely decoupled from Spotify's slow UI refreshes.

### `lib/dom/lyricsControls.ts`
The Pill Builder.
- Pipeline B's DOM logic specifically for building the floating `Original | Romanized | Translated` control pill.
- Handles the click events, state synchronization (`syncButtonStates`), and the glowing loading animation (`setLoadingState`).

### `lib/dom/lyricsObserver.ts`
The Inner Loop Guardian.
- While `domObserver.ts` watches the entire page for track changes, this observer specifically targets the native lyrics container.
- Spotify's React app will frequently attempt to re-render the lyrics container when scrolling. This observer catches those re-renders and instantly re-applies our translations (`applyLinesToDOM`) to ensure the Dual Lyrics never disappear.

### `lib/dom/domQueries.ts` & `toast.ts`
The DOM Helpers.
- `domQueries.ts`: Centrally manages all `data-testid` queries used to navigate Spotify's React DOM.
  - **Panel identity:** Spotify can keep earlier songs' lyrics panels mounted beside the current one. `slyBridge.ts` tags each panel with its track (`data-sly-track-uri`, from the list's `trackUri` / the themed container's `item.uri` React props) and `<html>` with the playing track (`data-sly-playing-uri`). `currentSongOnly()` drops other songs' panels; every panel query goes through it. With one song's panels, or no tags, nothing is filtered.
- `toast.ts`: Manages the sleek animated popups at the bottom of the screen.

### `lib/dom/songTransition.ts`
Song changes in the expanded view, the way Spotify slides them.
- `beginSongTransition` marks the song being left's slide as leaving (`data-sly-leaving`): queries skip it, and a still copy of the extension's lyrics slides out on it. The slide is chosen by the panel's track tag (previous track), never the playing track's slide, nor a just-mounted untagged panel, and nothing is marked when an ad is being left (`isLeavingAnAd` in `state.ts`).
- `kickWhenPanelMounts` runs slyCore's check the moment a new panel mounts.
- `purgeSlyDOM({ keep, keepSongsOtherThan })` (`lyricsDOM.ts`) keeps the playing song's painted rows and other songs' panels at a track switch; `watchPanelSongChanges` cleans a panel whose track tag changes.

### `lib/core/fetchProcessed.ts` & `nativeLyricsHandler.ts`
The Pipeline B Glues.
- `fetchProcessed.ts`: Fires the `PROCESS` request to the background worker to translate a string array, catching any truncation errors to display a toast.
- `nativeLyricsHandler.ts`: Handles the complex logic of "Layer 1 Upgrades" (when the native-script lookup retrieves native lyrics and replaces Spotify's romanized native lyrics dynamically).

---

## Domain 3: Pipeline A (slyCore Fallback Engine)

The custom engine used when Spotify has *no* lyrics (or unsynced text). `slyCore` completely bypasses React, injecting a custom `#lyrics-root-sync` container and handling playback extrapolation manually.

### `entrypoints/spotify-lyrics.content/index.ts`
The isolated WXT Content Script (`document_idle`).
- Acts as the main bootstrapper for the UI. It initializes the `StateStore` (loading user preferences from `localStorage`), mounts the Preact popup, and registers the `MutationObserver` (`createDomObserver`) that watches for track changes.
- Connects the isolated world to the `MAIN` world via `setupSlyBridge`, converting `window.postMessage` broadcasts into structured events.

### `lib/slyCore/content.ts`
The heart of the DOM Engine loop (`window.slyCheckNowPlaying`).
- **The Poller:** Runs a relentless `setInterval` every 500ms to monitor state.
- **The Decision Engine:** If Spotify reports "Lyrics not available," this engine decides to trigger the fallback fetch pipeline.
- **Injection Gate:** When lyrics are fetched or processed, it catches the `sly:inject` event and prepares the data for the renderer. 
- **Ad Silencer:** Detects audio ads and stands down: Spotify shows its own full-screen ad page during the break, so the extension resets and removes any status screen of its own, then resumes when Spotify reopens the lyrics view.

### `lib/slyCore/domEngine.ts`
The DOM Surgeon. 
- **`slyPrepareContainer`**: Creates the custom `#lyrics-root-sync` container that hides Spotify's native container and takes its place.
- **`slyMirrorNativeTheme`**: Extracts Spotify's dynamic CSS variables (background colors, active text colors) and mirrors them into our custom container so the injected lyrics look 100% native.
- **`slyBuildLyricsList`**: Maps over the romanized/translated strings and constructs physical `HTMLDivElement` nodes for every single lyric line, wiring up the click-to-seek listeners.

### `lib/slyCore/playback.ts`
The High-Performance Synchronizer.
- **Wall-Clock Extrapolation:** Spotify's UI only updates progress every ~500ms, which makes lyrics look jittery. `slyGetPlaybackSeconds` reads the base percentage from the progress bar, but then uses `performance.now()` to extrapolate smooth, 60fps sub-second accuracy between Spotify's updates.
- **The 3-Layer Seek Mechanism:** When a user clicks a custom lyric line, `slySeekTo` attempts to scrub the track using 3 fallback layers:
  1. *React Bridge:* Interacts directly with the hidden `input[type="range"]`.
  2. *Direct Media Access:* Recursively pierces the Shadow DOM to find the `<video>` or `<audio>` tag and sets `currentTime`.
  3. *Pointer Simulation:* Physically simulates a mouse click on the exact x-coordinate of the visible progress bar.

### `lib/slyCore/ui.ts`
The Custom UI Engine.
- Contains `slyParseLRC` for converting raw LRC strings into time-indexed arrays.
- Contains `slyResetPlayerState` which acts as the "nuclear cleanup" function during track skips (destroying the custom DOM and restoring native Spotify elements).
- Runs `slyUpdateSyncButton` (viewport math to gracefully float the sync button) and `slyUpdateSync` (the fallback sync loop used exclusively by Pipeline A).

### `lib/slyCore/lyricsStatus.ts` & `lyricsChip.ts`
Lyrics status, kept apart from where it is drawn.
- `lyricsStatus.ts`: one status record for the current song (searching / not found / found-but-not-shown, with its label, message and actions).
- `StatusEngine` picks the surface (`slyStatusPlacement` in `domEngine.ts`): Spotify's lyrics panel → its full status screen; Spotify's expanded Now Playing view for a song without Spotify lyrics → the extension's Lyrics button in Spotify's media switch (`lyricsChip.ts`: spinner, a short label beside the switch, a popover with Add lyrics / Retry); no media switch → the toast. Nothing is drawn over Spotify's artwork or cards.

### `lib/slyCore/events.ts`
The Interaction Observers.
- Wraps Spotify's SPA router (`history.pushState`) to detect page navigations instantly.
- Listens to user scroll events (`handleUserInteraction`) to temporarily pause auto-scrolling lyrics.
- **The Pointerdown Hijack:** Intercepts clicks on Spotify's lyrics button at the capture phase to safely route the open/close events through our Main World bridge without crashing React.

### `lib/slyCore/messaging.ts`
The Communication Bridge.
- Acts as the main pipeline between the `MAIN` world UI and the isolated background worker.
- Executes `slyTriggerLyricsFetch` which dispatches `FETCH_LYRICS` payloads and elegantly handles race conditions (e.g., if a user skips a track while a native-script lookup is mid-flight, the stale response is safely discarded).

### `lib/slyCore/styles.ts`
The Custom CSS Payload.
- Injects the raw CSS rules required for Pipeline A to function.
- Features the `Zero-Flicker Hijack`—a CSS trick using the `:has()` selector that instantly hides Spotify's native "Lyrics aren't available" message before JavaScript even processes the event.

### `lib/slyCore/scavenger.ts`
The CSS Thief.
- Spotify heavily obfuscates its CSS classes (e.g., `bbJIIopLxggQmv5x`). This file stores a known dictionary of these classes.
- **Dynamic Scavenging:** Rather than breaking every time Spotify updates, `slyScavengeClasses()` dynamically inspects the live DOM, finds Spotify's native UI elements by their structure, and extracts their new active class names. Our injected elements then perfectly mimic the new classes.

### `lib/slyCore/detector.ts`
The State Evaluator.
- High-level scanner for Spotify's DOM state (`slyDetectNativeState()`).
- Determines if the current track is an Ad, if the user is on the lyrics page, and the status of Spotify's native lyrics (`SYNCED`, `UNSYNCED`, `MISSING`).
- Evaluates the "Pre-Fetch Registry" from the background worker and executes a "Forensic Scan" of the native lyrics to determine if a `slyCore` hijack is necessary.

### `lib/slyCore/statusEngine.ts`
The status orchestrator.
- `StatusEngine.show/clear/isShowing`: records the lyrics status (`lyricsStatus.ts`) and draws it on the surface `slyStatusPlacement()` picks: Spotify's lyrics panel (full status screen), the extension's Lyrics button in the expanded Now Playing view (`lyricsChip.ts`), or a short toast.
- Gives back whatever it hid (Spotify's panel, artwork) when the status goes away.

### `lib/slyCore/takeoverEngine.ts`
The takeover ("0ms swap") for songs Spotify has no lyrics for.
- Builds the extension's lyrics in Spotify's own slot and style (`slyPrepareContainer` in `domEngine.ts`), mirrors the theme, hands the pill over.
- Refusals: Spotify's lyric style unknown or its slot not recognised → a "Lyrics found" status; mid-slide between two songs (`lyrics-slot-busy`) → no status, `_retryWhenSlotSettles` tries again once one slot is left.

### `lib/slyCore/nowPlayingOpener.ts`
Opens Spotify's expanded Now Playing view for songs Spotify has no lyrics for (its own lyrics button does nothing then), only when Spotify's click did not open a lyrics view.

---

## Domain 4: Data Fetching & Caching

The logic for finding lyrics when Spotify fails. Contains the multi-source fetchers and the 4-layer caching system (Memory -> Disk -> Promise Deduplication -> Network).

### `lib/lyricsProviders/lyricsEngine.ts`
The Orchestrator. 
- Defines the fallback search hierarchy: **YTM Synced > LRCLIB Synced > YTM Plain > LRCLIB Plain**.
- If synced lyrics are found anywhere, it stops the chain and returns them. It also triggers `extractImageColor` so the `slyCore` UI can match the Spotify theme.

### `lib/lyricsProviders/ytm.ts`
The YouTube Music Scraper.
- Spoofs an Android client request (`clientName: 'ANDROID_MUSIC'`) to hit YouTube Music's internal API directly without needing OAuth.
- Performs a 3-step scrape: `search` (to find the video ID) ➡️ `next` (to find the Lyrics Tab browse ID) ➡️ `browse` (to extract the actual lyrics payload).
- Parses `timedLyricsData` and automatically converts YouTube's millisecond-timestamp format into standard LRC format (`[mm:ss.xx]Text`).

### `lib/lyricsProviders/lrclib.ts`
The Open-Source Fallback. 
- If YTM fails, it searches `lrclib.net/api/get` using the song title and artist. If that fails, it falls back to a fuzzy `/api/search` to find the closest match.

### `lib/lyricsProviders/lyricsCache.ts`
The RAM Manager (L1 & L3 Caches).
- **L1 (Memory Cache):** A blazing-fast `Map` limited to the last 10 songs. If you hit "previous track," it returns instantly.
- **L3 (In-Flight Deduplication):** An ingenious `inFlight` Map that stores the JavaScript `Promise` of an ongoing network request. If a user rapidly clicks the lyrics button 5 times while a fetch is happening, all 5 requests will hook into the exact same single Promise instead of triggering 5 duplicate network calls.

### `lib/lyricsProviders/lyricsPersistence.ts`
The SSD Manager (L2 Cache).
- Connects to `browser.storage.local`. Every fetched song is saved permanently to the user's hard drive. 
- *Note:* In `background.ts`, there is an **"Upgrade Logic"** loop: if the persistent cache holds unsynced lyrics, the background worker will silently query YTM once a week to see if a synced version has become available, automatically upgrading the local cache if so.

### `lib/slyCore/preFetch.ts`
The Temporal Registry.
- Maintains a 10-minute sliding window cache (`slyPreFetchRegistry`). 
- When the background script detects a track change, it races Spotify to fetch external lyrics. It stores the result here ("This track is MISSING" or "This track is ROMANIZED") so that when Spotify finally renders the page, our extension already knows if it needs to trigger a fallback hijack.

---

## Domain 5: Transliteration & Translation

The processing layer. Identifies Unicode scripts, routes to local romanizers for zero-latency output, and fetches Google Translations.

### `lib/lyrics/lyricsProcessor.ts`
The Pipeline Orchestrator.
- Evaluates the song using `detectScript`. 
- If the language is Latin (e.g. English, Spanish), it skips romanization.
- If it's an unsupported script (like Arabic or Hebrew), it routes both translation and romanization to Google's API (`dt=rm`).
- For supported scripts (Japanese, Korean, Chinese, Cyrillic, Indic, etc.), it routes the romanization to the lightning-fast `localRomanizer` while simultaneously translating the text via Google in parallel.

### `lib/lyrics/scriptDetector.ts`
The Offline Language Identifier.
- Rather than relying on unreliable metadata or slow API calls, this file uses raw Unicode Regex counting. 
- It scans the lyrics against 15 different Unicode blocks (`\u3040-\u30FF` for Japanese, `\uAC00-\uD7AF` for Korean, etc.) and tallies a score to determine the `dominant` script of the song with near 100% accuracy.

### `lib/lyrics/localRomanizer.ts`
The Zero-Latency Transliteration Hub.
- To prevent rate-limiting and minimize network latency, Spotify Karaoke bundles **10 local transliteration libraries**. 
- It dynamically loads massive dictionaries (like Kuroshiro/Kuromoji for Japanese Kanji parsing) and handles Pinyin, Korean, Cyrillic, Thai, Tamil, and several Indic scripts (via Sanscript) entirely inside the user's browser memory.
- Built-in engines: `thaiRomanizer.ts` (word segmentation + RTGS-style syllable reader, library fallback per word), `japaneseRomanizer.ts` (kuromoji tokens grouped into words, particles read as pronounced; the dictionary comes from jsDelivr on first use; unread kanji go to Google in `lyricsProcessor.ts`), `hindiRomanizer.ts` (Devanagari with schwa deletion: "hum baatein").
- `lib/core/spotifyRomanization.ts`: for native lines the extension restored, Romanized mode uses Spotify's own romanized line paired with each.
- `lib/core/processedCache.ts` `ROMANIZER_VERSION` retires cached romanizations of scripts whose romanizer changed.

### `lib/translate/googleApi.ts`
The Translation Fetchers.
- `googleApi.ts`: Uses the free `client=gtx` endpoint. Contains highly specific logic to parse Google's nested array response structure. It correctly identifies the hidden `dt=rm` romanization block that Google appends to the end of the payload.

### `lib/lyricsProviders/nativeLyrics.ts`
The native-script lookup (background).
- Answers the interceptor's request for a song's lyrics in the original script: remembered lines first (30 days), then YouTube Music's synced lyrics when they are native script, then a synced LRCLIB copy that matches the track's duration and line count.
- Musixmatch was the first source until 2026-11, when it stopped serving anonymous clients; it was removed.
- `lrclibNative.ts`: picks a native-script LRCLIB copy only when its duration and line count match the track.

### `lib/slyCore/forensics.ts`
The Character Investigator.
- Exposes `analyzeText()`, which breaks down a raw string and counts exactly how many native script characters (`Hiragana`, `Hangul`, `Devanagari`, etc.) vs Latin characters are present. This prevents the extension from mistakenly overwriting native lyrics.

---

## Domain 6: User Interface & State Syncing

The user-facing extension popup and the background listeners that broadcast user preferences to the Spotify tab in real-time.

### `entrypoints/popup/App.tsx`
The Preact UI.
- Displays the control menu when the user clicks the extension icon.
- **Zero-Latency Hydration:** It initializes its React state synchronously using `localStorage` to prevent UI flicker, then asynchronously reconciles with `browser.storage.sync`.
- Manages Target Language, Display Mode, Dual Lyrics toggle, and Floating Controls toggle. It also calculates the total storage space used by the persistent lyrics cache.

### `entrypoints/popup/style.css`
The Theme.
- A custom CSS file strictly adhering to Spotify's design system tokens (`#121212` background, `#1ed760` green) so the extension menu feels like a native part of the Spotify ecosystem.

### `lib/core/store.ts`
The State Store.
- The single source of truth for the extension's configuration within the content script. It loads the `sync` settings on startup and preloads the runtime `lc:` cache from `local` storage.

### `lib/core/storageListener.ts`
The Real-Time Messenger.
- A background observer (`browser.storage.onChanged`) that acts as a bridge between the Popup UI and the live Spotify webpage. 
- If a user changes their preferred language or toggles Dual Lyrics in the popup, this listener immediately catches the event and triggers a live re-render (`applyLinesToDOM` or `onSwitchMode`) inside the Spotify tab—no page refresh required.

---

## Domain 7: Security, Testing & CI/CD

The administrative outer shell. Declarative net rules for bypassing CORS, testing setups, automated GitHub Action releases, and documentation.

### `.github/workflows/release.yml`
The Deployment Automation.
- A highly optimized GitHub Action that runs every time a `v*` tag is pushed. **Pushing a tag publishes to all three stores.**
- Store credentials come from the repository's GitHub secrets (`CHROME_*`, `FIREFOX_*`, `EDGE_*`).
- It builds zip files for Chrome, Firefox, and Edge simultaneously.
- Uses `softprops/action-gh-release` to create a public GitHub release.
- Executes `npx wxt submit` to automatically upload the built extension to the Chrome Web Store, Mozilla Add-ons, and Microsoft Edge Add-ons directories.

### `lib/testHooks.ts` (debug builds only)
- `SLY_DEBUG=1` builds (`npm run build:chrome:debug`, `build:firefox:debug`) keep the logs and define `__SLY_TEST_HOOKS__`: fault switches (`google`, `japaneseDictionary`), extension reload, and `traceEvent` markers on `<html data-sly-trace>` for frame-by-frame recorders. Store builds contain none of it.

### `tests/`, `vitest.config.ts` & `vitest.setup.ts`
The Testing Environment.
- Uses `Vitest` running in a `jsdom` environment to simulate the browser.
- `vitest.setup.ts` mocks the `browser.runtime` and `browser.storage` APIs so that the 10+ local transliteration libraries and complex React controllers can be unit tested locally without needing to compile a full extension payload.

### `public/rules.json`
The Network Spoofing Rules.
- A Declarative Net Request configuration.
- Tells the browser to silently intercept background API requests made to `*://music.youtube.com/*` and forcibly overwrite the `Origin`, `Referer`, and `User-Agent` headers. This is the lynchpin security bypass that allows `ytm.ts` (Phase 3) to successfully fetch synchronized lyrics from YouTube Music without triggering CORS errors or bot-detection blockades.

### `README.md`
The Public Face.
- Comprehensive end-user documentation. Details the "Original / Romanized / Translated" feature set, provides installation instructions for different browsers, and lists the romanization libraries used. Also includes an "Under the Hood" section for curious developers.

### `CHANGELOG.md`
The Historical Ledger.
- A detailed version history (following "Keep a Changelog" formatting) documenting the massive architectural leaps from the v1.x vanilla JS extension, through the v2.0 WXT rewrite, all the way to the v3.1.0 custom `slyCore` engine injection.

### `LICENSE` & `.gitignore`
The Legal & Safety Nets.
- `LICENSE`: Standard MIT License permitting open-source use.
- `.gitignore`: Ensures that build artifacts (`.output`, `.wxt`) and secret tokens (`.env*`) are never accidentally committed to the public repository.

---