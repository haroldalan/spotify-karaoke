<div align="center">
  <img src="public/icon128.png" alt="Spotify Karaoke" width="96">
  <h1>Spotify Karaoke</h1>
  <p>Romanize, translate, and sing along to any song on Spotify - right in the web player.</p>

  <a href="https://chromewebstore.google.com/detail/spotify-karaoke/bhhkohameknlmcgdfafkjplpjalfedie"><img src="https://img.shields.io/badge/Chrome-Install-blue?logo=googlechrome&logoColor=white&style=for-the-badge" alt="Chrome Web Store"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/spotify-karaoke/"><img src="https://img.shields.io/badge/Firefox-Install-orange?logo=firefox&logoColor=white&style=for-the-badge" alt="Firefox Add-ons"></a>
</div>

---

## What it does

Spotify Karaoke adds three lyric display modes to the Spotify web player:

- **Original** - lyrics as Spotify shows them, unchanged.
- **Romanized** - non-Latin scripts (Japanese, Korean, Tamil, Hindi, etc.) rendered phonetically in the Latin alphabet so you can sing along.
- **Translated** - lyrics translated into any of 100+ languages.

Switch between modes using the floating pill controls injected directly into the lyrics panel, the popup, or keyboard shortcuts. No page reload, no flicker.

**Dual Lyrics mode** — in Romanized or Translated mode, the processed text becomes the primary karaoke highlight line, with the original script shown below in a smaller font for reference. Sing along phonetically in Romanized, or follow the meaning in Translated, while always keeping the original in view.

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
| **Extension popup** | The same pill is replicated inside the popup — acts as a remote control and always reflects the current mode, even if the floating pill is hidden. |
| **Keyboard shortcuts** | While the lyrics panel is open, press `O`, `R`, or `T`. Safe to use — shortcuts are ignored when focus is in a text input or search bar. |

Power users can toggle off the floating pill entirely via **Show Floating Controls** in the popup, then use keyboard shortcuts or the popup pill for a completely unobstructed lyrics view.

| Floating Controls On | Floating Controls Off |
| :---: | :---: |
| <img src="assets/popup-floating-controls-on.png" width="380" alt="Floating controls visible"> | <img src="assets/popup-floating-controls-off.png" width="380" alt="Floating controls hidden"> |


---

## Installation

**From the browser store (recommended):**
- [Chrome Web Store](https://chromewebstore.google.com/detail/spotify-karaoke/bhhkohameknlmcgdfafkjplpjalfedie) - Chrome, Edge, Brave, and other Chromium browsers
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/spotify-karaoke/)

**Manual install (Developer Mode):**
1. Download the latest `.zip` from the [Releases page](../../releases) and extract it.
2. Open your browser's extensions page (`chrome://extensions` or `about:debugging`).
3. Enable **Developer Mode**, then click **Load unpacked** (Chrome) or **Load Temporary Add-on** (Firefox) and select the extracted folder.

---

## Native Script Restoration for Non-Latin Scripts

Spotify often serves romanized fallback lyrics for non-Latin songs (e.g. Thai, Arabic, or Indian languages) even when the original native-script version exists on Musixmatch.

Spotify Karaoke fixes this automatically. When you play a'supported song, the extension intercepts Spotify's lyrics API response, detects the romanized fallback, fetches the native-script subtitles from Musixmatch, and replaces the response before Spotify renders it. The original script appears natively in the lyrics panel - no user action required.

Romanize and Translate modes then operate on the correct native source, producing significantly more accurate results.

**Supported languages:** All non-Latin scripts (Hindi, Tamil, Thai, Arabic, Telugu, Japanese, Korean, etc.).

---

## Romanization Coverage

| Script | Library | Mode |
| :--- | :--- | :--- |
| **Japanese** (Kanji + Kana) | `@sglkc/kuroshiro` + Kuromoji | Local |
| **Korean** (Hangul) | `@romanize/korean` | Local |
| **Chinese** (Hanzi) | `pinyin-pro` | Local |
| **Tamil** | `tamil-romanizer` | Local |
| **Indic** (Devanagari, Telugu, Gujarati, Gurmukhi, Kannada, Odia) | `@indic-transliteration/sanscript` | Local |
| **Cyrillic** (Russian, Ukrainian, etc.) | `cyrillic-to-translit-js` | Local |
| **Thai** | `@dehoist/romanize-thai` | Local |
| **Malayalam, Bengali, Arabic, Hebrew** | Google Translate (`dt=rm`) | API |
| *Fallback* | `transliteration` | Local |

Translation for all languages goes through Google Translate, with automatic failover to MyMemory if rate-limited.

---

## Developer Setup

**Requirements:** Node.js 18+

```bash
git clone https://github.com/haroldalan/spotify-karaoke.git
cd spotify-karaoke
npm install

npm run dev          # Chrome (live reload)
npm run dev:firefox  # Firefox (live reload)

npm run build          # Production build - Chrome
npm run build:firefox  # Production build - Firefox
npm run zip            # Package for Chrome Web Store submission
npm run zip:firefox    # Package for Firefox Add-ons submission

npm run test           # Run unit and component test suite
```

### Project Structure

```
entrypoints/
  background.ts              # Service worker: romanization + translation orchestration
  fetchInterceptor.ts        # WXT unlisted script: custom logic for Spotify API patching
  spotify-inject.content.ts  # Injects the compiled interceptor into the page's main world
  spotify-lyrics.content/
    index.ts                 # DOM engine: MutationObserver, mode switching, caching
    style.css
  popup/                     # Preact popup: zero-latency remote pill, language selector, dual lyrics + visibility toggles
```

### How it works

**Lyrics injection:** A `MutationObserver` watches Spotify's `<main>` element for newly rendered lyric lines. When the lyrics change, the engine reads the current mode (Original / Romanized / Translated), fetches processed lyrics from cache or sends a `PROCESS` message to the background worker, and writes the result back into the existing DOM elements. Spotify's own React state is never touched.

**Romanization & translation:** The background service worker receives an array of lyric strings, detects the script using Unicode range scoring, routes to the appropriate local library or Google Translate batch API, and returns both a translated array and a romanized array in a single response.

**Native script restoration:** `entrypoints/fetchInterceptor.ts` is compiled as an unlisted script and registered in the extension manifest to run in the `MAIN` world at `document_start`. This ensures the interceptor is active before Spotify's application bundle even begins to execute, solving previous race conditions. It monkey-patches `window.fetch` to intercept `color-lyrics/v2/track/*` responses. When it detects `isDenseTypeface: false` for a non-Latin track (Thai, Hindi, Arabic, etc.), it automatically fetches native-script subtitles from Musixmatch and replaces the response before Spotify renders the Romanized fallback. Instrumental symbols (`♪`) are preserved during the restoration.

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: describe what you added'`
4. Push and open a Pull Request.

Please keep PRs focused. One feature or fix per PR makes review much faster.

---

## Privacy & Disclaimer

- **Privacy:** No personal data is collected. Your settings (language preference, mode, UI preferences) are stored in `browser.storage.sync` and mirrored in `localStorage` for zero-latency UI hydration. Processed lyrics (romanized/translated text) are cached locally in `browser.storage.local` with an **unlimited quota** to avoid redundant API calls. Lyric text is sent to Google Translate when using Translated mode. See [Google's Privacy Policy](https://policies.google.com/privacy).
- **Disclaimer:** Spotify Karaoke is not affiliated with or endorsed by Spotify AB. It is an independent open-source project that modifies the Spotify web player UI for personal and accessibility use.

---

<div align="center">
  MIT License · <a href="https://ko-fi.com/haroldalan"><img src="https://img.shields.io/badge/Buy_Me_A_Coffee-FF5E5B?style=flat&logo=ko-fi&logoColor=white" alt="Ko-fi" style="vertical-align:middle"></a><br>
  <i>Made by Harold Alan. If you find it useful, a ⭐ on GitHub goes a long way.</i>
</div>
