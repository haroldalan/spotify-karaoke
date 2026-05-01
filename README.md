<div align="center">
  <h1><img src="assets/marquee-promo-tile.png" alt="Spotify Karaoke" width="500">
  </h1>
  <p>Automatically fetches synced lyrics for songs that dont have it, and provides additional functionality like romanization for all scripts and translation into 132 languages — right inside Spotify</p>
  
  <a href="https://chromewebstore.google.com/detail/spotify-karaoke/bhhkohameknlmcgdfafkjplpjalfedie" target="_blank"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/iNEddTyWiMfLSwFD6qGq.png" alt="Chrome Web Store" height="52"/></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/spotify-karaoke/" target="_blank"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Firefox Add-ons" height="52"/></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/spotify-karaoke-romaniz/gpaojfekocbgcofcbbcinfpnbagjakom" target="_blank"><img src="https://github.com/user-attachments/assets/9fcd04a5-3d1c-43d2-9253-d3e2b9510030" alt="Microsoft Edge Add-ons" height="52"/></a>
  <br><br>
  ![License](https://img.shields.io/github/license/haroldalan/spotify-karaoke?style=flat-square)
  ![GitHub release](https://img.shields.io/github/v/release/haroldalan/spotify-karaoke?style=flat-square)
  ![Chrome users](https://img.shields.io/chrome-web-store/users/bhhkohameknlmcgdfafkjplpjalfedie?style=flat-square&label=Chrome%20users&color=1DB954)
  ![Chrome rating](https://img.shields.io/chrome-web-store/rating/bhhkohameknlmcgdfafkjplpjalfedie?style=flat-square&color=1DB954)
</div>

---

## Key Features

<table>
<tr>
<td align="center">
<br>
<img src="https://api.iconify.design/lucide:search.svg?color=%231DB954" width="36" height="36">
<br>
<b>Smart Lyrics Fetch</b><br>
When Spotify can't find lyrics, the extension fetches them automatically.<br><br>
<code>Lyrics not available</code> → <code>Synced lyrics found</code>
<br><br>
</td>
<td align="center">
<br>
<img src="https://api.iconify.design/lucide:languages.svg?color=%231DB954" width="36" height="36">
<br>
<b>Phonetic Romanization</b><br>
Universal support for any script, with optimized local engines for 16 major writing systems.<br><br>
<code>안녕하세요</code> → <code>an-nyeong-ha-se-yo</code>
<br><br>
</td>
</tr>
<tr>
<td align="center">
<br>
<img src="https://api.iconify.design/lucide:globe.svg?color=%231DB954" width="36" height="36">
<br>
<b>Real-time Translation</b><br>
Read lyrics in 132 languages to understand the meaning behind every line.<br><br>
<code>君を愛してる</code> → <code>I love you</code>
<br><br>
</td>
<td align="center"> 
<br>
<img src="https://api.iconify.design/lucide:sparkles.svg?color=%231DB954" width="36" height="36">
<br>
<b>Native Restoration</b><br>
Bypass low-quality fallbacks and restore original, high-fidelity native scripts automatically.<br><br>
<code>Anyonhasyo</code> → <code>안녕하세요</code>
<br><br>
</td>
</tr>
</table>

<br>

**Coming Soon**

<table>
<tr>
<td align="center">
<br>
<img src="https://api.iconify.design/lucide:layers.svg?color=%23888888" width="36" height="36">
<br>
<b>Ultimate Triple View</b><br>
Original, Romanized, and Translated text all in a single, perfectly synced frame.<br><br>
Stacked lyrics (<code>君を愛してる</code> / <code>Kimi o aishiteru</code> / <code>I love you</code>)
<br><br>
</td>
</tr>
</table>

## Demo reel

https://github.com/user-attachments/assets/f6afc346-9dc0-4429-8733-5c8df94c8eaf

---

## What it does

Spotify's lyrics panel has two problems: it sometimes can't find lyrics at all, and when it does, it often can't help you understand them. `Spotify Karaoke` fixes both.

**Smart lyrics fetching:** When Spotify shows "Lyrics not available," the extension quietly searches YouTube Music and LRCLIB in the background. If synced lyrics exist anywhere, they get injected directly into the Spotify lyrics panel — perfectly timed, indistinguishable from native. No user action required.

**Romanization & Translation:** Once lyrics are on screen — whether fetched or native — you can switch between three display modes:

- **Original** — lyrics as Spotify shows them, unchanged.
- **Romanized** — any non-Latin script (Japanese, Korean, Arabic, Indic, Thai, etc.) rendered phonetically in the Latin alphabet for instant sing-along.
- **Translated** — lyrics translated into any of 132 languages.

Switch between modes using the floating pill controls injected directly into the lyrics panel, the popup, or keyboard shortcuts. No page reload, no flicker.

**Native script restoration:** For global non-Latin scripts (Hindi, Thai, Arabic, CJK, etc.), Spotify often serves low-quality romanized fallback lyrics even when the original native-script version exists on Musixmatch. This extension automatically intercepts and restores the original, high-fidelity native script — before Spotify even renders the page. Romanize and Translate modes then operate on the correct native source, producing significantly more accurate results.

**Dual Lyrics mode** — in Romanized or Translated mode, the processed text becomes the primary karaoke highlight line, with the original script shown below in a smaller font for reference (suppressed when identical to the primary line).

| Dual Lyrics On | Dual Lyrics Off |
| :---: | :---: |
| <img src="assets/popup-dual-lyrics-on.jpg" width="380" alt="Dual Lyrics enabled"> | <img src="assets/popup-dual-lyrics-off.jpg" width="380" alt="Dual Lyrics disabled"> |

| Original (Korean) | Romanized |
| :---: | :---: |
| <img src="assets/mode-original.jpg" width="380" alt="Original lyrics"> | <img src="assets/mode-romanized.jpg" width="380" alt="Romanized lyrics"> |

| Translated |
| :---: |
| <img src="assets/mode-translated.jpg" width="380" alt="Translated lyrics"> |

---

## Controls

There are three ways to switch between Original, Romanized, and Translated:

| Method | How |
| :--- | :--- |
| **Floating pill** | The `[Original] [Romanized] [Translated]` pill injected at the top of the Spotify lyrics panel. |
| **Extension popup** | The same pill is replicated inside the popup - acts as a remote control and always reflects the current mode, even if the floating pill is hidden. |
| **Keyboard shortcuts** | While the lyrics panel is open, press `O` (Original), `R` (Romanized), or `T` (Translated). Safe to use - shortcuts are ignored when focus is in a text input or search bar. |

> [!NOTE]
> Floating controls and keyboard shortcuts only function when Spotify's lyrics panel is open. Click the microphone icon in the player to open it.

Power users can toggle off the floating pill entirely via **Show Floating Controls** in the popup, then use keyboard shortcuts or the popup pill for a completely unobstructed lyrics view.

| Floating Controls On | Floating Controls Off |
| :---: | :---: |
| <img src="assets/popup-floating-controls-on.png" width="380" alt="Floating controls visible"> | <img src="assets/popup-floating-controls-off.png" width="380" alt="Floating controls hidden"> |

---

## Installation

### 🌐 Official Browser Stores (Recommended)
- **[Chrome Web Store](https://chromewebstore.google.com/detail/spotify-karaoke/bhhkohameknlmcgdfafkjplpjalfedie)** — Chrome, Brave, and other Chromium browsers.
- **[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/spotify-karaoke/)** — Mozilla Firefox (≥ 142.0).
- **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/spotify-karaoke-romaniz/gpaojfekocbgcofcbbcinfpnbagjakom)** — Microsoft Edge.

### 🛠️ Manual Installation (Developer Mode)

If you wish to test the latest features before they hit the stores, you can install the extension manually.

#### Google Chrome / Brave / Opera
1. Download the latest release `.zip` from the **[Releases page](../../releases)** and extract it.
2. Open your browser and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (usually a toggle in the top-right corner).
4. Click **Load unpacked** and select the folder where you extracted the extension.

#### Mozilla Firefox
> [!IMPORTANT]
> **Firefox Limitation:** Temporary add-ons are removed when the browser restarts. For a permanent install, please use the [Firefox Add-ons store](#-official-browser-stores-recommended).
1. Download and extract the latest release `.zip`.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select the `manifest.json` file inside the extracted folder.

#### Microsoft Edge
1. Download and extract the latest release `.zip`.
2. Navigate to `edge://extensions/`.
3. Enable **Developer mode** (toggle in the bottom-left sidebar).
4. Click **Load unpacked** and select the folder where you extracted the extension.

---

## Native Script Restoration for Non-Latin Scripts

Spotify often serves romanized fallback lyrics for non-Latin songs (e.g. Thai, Arabic, or Indian languages) even when the original native-script version exists on Musixmatch.

Spotify Karaoke fixes this automatically. When you play a supported song, the extension intercepts Spotify's lyrics API response, detects the romanized fallback, fetches the native-script subtitles from Musixmatch, and replaces the response before Spotify renders it. The original script appears natively in the lyrics panel — no user action required.

Romanize and Translate modes then operate on the correct native source, producing significantly more accurate results.

**Supported coverage:** Deep restoration and optimization for all major non-Latin scripts globally (Tamil, CJK, Hindi, Arabic, Thai, Cyrillic, Hebrew, etc.).

---

## Romanization Coverage

| Script | Library | Engine |
| --- | --- | --- |
| **Universal** *(fallback)* | `transliteration` | Local |
| **Japanese** (Kanji + Kana) | `@sglkc/kuroshiro` + Kuromoji | Local |
| **Korean** (Hangul) | `@romanize/korean` | Local |
| **Chinese** (Hanzi) | `pinyin-pro` | Local |
| **Tamil** | `tamil-romanizer` | Local |
| **Indic** (Devanagari, Telugu, Gujarati, Gurmukhi, Kannada, Odia) | `@indic-transliteration/sanscript` | Local |
| **Cyrillic** (Russian, Ukrainian, Bulgarian, Serbian, Belarusian) | `cyrillic-to-translit-js` | Local |
| **Thai** | `@dehoist/romanize-thai` | Local |
| **Malayalam, Bengali, Arabic, Hebrew** | Google Translate (`dt=rm`) | API |
| **Translation** (All 132 languages) | Google Translate → MyMemory fallback | API |

> ⚡ **Local** — zero latency, runs entirely in your browser. &nbsp; 🌐 **API** — requires a network call.

---

## Under the Hood

| Component | Detail |
| :--- | :--- |
| **Smart lyrics fetch** | YouTube Music synced → LRCLIB synced → YouTube Music plain → LRCLIB plain |
| **Local romanization** | 10 libraries · zero API latency for 16 optimized scripts |
| **Interception point** | `document_start`, MAIN world — before React first paint |
| **Cache** | L1: 10-song RAM · L2: unlimited persistent (`browser.storage.local`) · L3: in-flight deduplication · L4: network |
| **React Fiber bridge** | `slyBridge.ts` scans Spotify's Fiber tree at 600ms to extract tokens, track metadata, and queue state |
| **Playback sync** | Wall-clock extrapolation via `performance.now()` for 60fps sub-second accuracy between Spotify's ~500ms UI ticks |
| **Stale-cancel guards** | Generation Map + `processGen` parity counter (2 independent mechanisms) |
| **Translation fallback** | Google Translate → MyMemory → original preserved |
| **Browser support** | Chrome MV3 · Firefox MV2 (≥ 142.0) |

---

## Developer Setup

**Requirements:** Node.js 18+

```bash
git clone https://github.com/haroldalan/spotify-karaoke.git
cd spotify-karaoke
npm install

npm run dev          # Chrome (live reload)
npm run dev:firefox  # Firefox (live reload)
npm run dev:edge     # Edge (live reload)

npm run build          # Production build - Chrome
npm run build:firefox  # Production build - Firefox
npm run build:edge     # Production build - Edge

npm run zip            # Package for Chrome Web Store submission
npm run zip:firefox    # Package for Firefox Add-ons submission
npm run zip:edge       # Package for Edge Add-ons submission

npm run test           # Run unit and component test suite
```

### Project Structure

```
entrypoints/
  background.ts              # Service worker: lyrics fetching, romanization + translation orchestration, 4-layer cache
  fetchInterceptor.ts        # MAIN world unlisted script: fetch interceptor, native script restoration
  slyBridge.ts               # MAIN world unlisted script: React Fiber scanner, Genetic Lock Shield, state broadcaster
  spotify-lyrics.content/
    index.ts                 # Content script: bootstrapper, MutationObserver, mode switching, slyBridge wiring
    style.css
  popup/                     # Preact popup: mode pill, language selector, dual lyrics + visibility toggles

lib/
  core/                      # Pipeline B: lifecycle, mode controller, lyrics fetching, state store
  dom/                       # Pipeline B: DOM surgery, lyrics observer, controls pill, toast
  slyCore/                   # Pipeline A: custom DOM engine, playback sync, scavenger, status HUD, ad manager
  lyricsProviders/           # YTM scraper, LRCLIB client, 4-layer cache
  lyrics/                    # Script detector, local romanizer, lyrics processor
  translate/                 # Google Translate API, MyMemory fallback
  mxmClient.ts               # Musixmatch client for native script restoration
```

### How it works

Spotify Karaoke runs two parallel pipelines depending on what Spotify provides.

<details>
<summary>Technical deep-dive</summary>

**Pipeline B — Native lyrics exist:** A `MutationObserver` watches `document.body` for song key updates (`aria-label`) and newly rendered lyric lines. The observer processes mutations in two passes: **Pass 1** handles song key updates to ensure state coherence, and **Pass 2** handles DOM structure changes to detect lyric injection. This prevents race conditions where lyrics might be processed against the previous song's key.

When lyrics are detected, the engine reads the current mode (Original / Romanized / Translated), fetches processed lyrics from cache or sends a `PROCESS` message to the background worker, and writes the result back into the existing DOM elements. Spotify's own React state is never touched.

**Pipeline A — Lyrics missing or broken:** When Spotify reports "Lyrics not available," the `slyCore` engine takes over. It hides Spotify's native container entirely and injects a custom `#lyrics-root-sync` container in its place. Lyrics are fetched from YouTube Music or LRCLIB via the background service worker, then rendered with a `requestAnimationFrame` loop using wall-clock extrapolation for 60fps sync accuracy — completely decoupled from Spotify's own UI refresh cycle.

**Romanization & translation:** The background service worker receives an array of lyric strings, detects the script using Unicode range scoring, routes to the appropriate local library or Google Translate batch API, and returns both a translated array and a romanized array in a single response.

**Native script restoration:** `entrypoints/fetchInterceptor.ts` is compiled as an unlisted script and registered in the extension manifest to run in the `MAIN` world at `document_start`. This ensures the interceptor is active before Spotify's application bundle even begins to execute. It monkey-patches `window.fetch` to intercept `color-lyrics/v2/track/*` responses, fetches the native-script version from Musixmatch, and swaps out Spotify's romanized fallback before React renders it.

**React Fiber bridge:** `entrypoints/slyBridge.ts` runs in the `MAIN` world and traverses Spotify's React Fiber tree to extract live track metadata, access tokens, and the user's queue. It also maintains a Genetic Lock — an `Object.defineProperty` override that keeps Spotify's lyrics button permanently enabled, even for tracks where Spotify would otherwise disable it.

</details>

---

## Contributing

Issues, ideas, and PRs are welcome — especially for romanization accuracy improvements or new script support.

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: describe what you added'`
4. Push and open a Pull Request.

Please keep PRs focused. One feature or fix per PR makes review much faster.

---

## Privacy & Disclaimer

> [!NOTE]
> **No personal data is collected.** Settings are stored in `browser.storage.sync`. Processed lyrics are cached locally in `browser.storage.local` and never leave your device. Lyric text is sent to Google Translate or MyMemory only when using Translated or API-based Romanized modes. See [Google's Privacy Policy](https://policies.google.com/privacy) and [MyMemory's Terms](https://mymemory.translated.net/doc/tos.php).

> [!WARNING]
> Spotify Karaoke is not affiliated with or endorsed by Spotify AB. It is an independent open-source project that modifies the Spotify web player UI for personal and accessibility use.

---

<div align="center">

[![MIT License](https://img.shields.io/github/license/haroldalan/spotify-karaoke?style=flat)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Buy_Me_A_Coffee-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/haroldalan)
[![Chrome Review](https://img.shields.io/badge/Chrome-Leave_a_Review-yellow?logo=googlechrome&logoColor=white&style=flat)](https://chromewebstore.google.com/detail/spotify-karaoke/bhhkohameknlmcgdfafkjplpjalfedie/reviews)
[![Firefox Review](https://img.shields.io/badge/Firefox-Leave_a_Review-orange?logo=firefox&logoColor=white&style=flat)](https://addons.mozilla.org/en-US/firefox/addon/spotify-karaoke/reviews)
[![Edge Review](https://img.shields.io/badge/Edge-Leave_a_Review-blue?logo=microsoftedge&logoColor=white&style=flat)](https://microsoftedge.microsoft.com/addons/detail/spotify-karaoke-romaniz/gpaojfekocbgcofcbbcinfpnbagjakom/reviews)

*Made by Harold Alan. If you find it useful, a ⭐ on GitHub goes a long way.*

</div>
