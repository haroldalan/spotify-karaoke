![Spotify Karaoke Icon](extension/assets/icon128.png)

# Spotify Karaoke

**Upgrade your lyrical experience!**

Cleanly designed to integrate seamlessly into the Spotify Web Player, **Spotify Karaoke** lets you **Romanize** and **Translate** your song lyrics in real-time. Whether you're singing along to K-Pop, deciphering Anime intros, or learning a new language, this extension has you covered.

## Features

-   **Romanized Lyrics**: Automatically transliterate lyrics into Roman characters.
    -   **Specialized Libraries**: tailored support for:
        -   🇰🇷 **Korean** (Hangul → Romaja)
        -   🇯🇵 **Japanese** (Kanji/Kana → Romaji)
        -   🇨🇳 **Chinese** (Mandarin → Pinyin)
        -   🇷🇺 **Cyrillic** (Russian, Ukrainian, etc.)
        -   🇮🇳 **Indic Scripts** (Hindi, Telugu, Tamil, Malayalam, Kannada, Marathi, Bengali, etc.)
        -   🇸🇦 **Arabic** & **Persian**
-   **Dual Lyrics Mode**: **[NEW]** View the original lyrics underneath the Romanized/Translated text for comparison.
-   **Translated Lyrics**: Translate lyrics into 100+ languages (powered by Google Translate).
-   **Smart Integration**: Adds "Original", "Romanized", and "Translated" pills directly to Spotify's lyrics UI.
-   **Performance**: Intelligent caching and batched processing for zero-flicker updates.

## Download

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-blue?style=for-the-badge&logo=google-chrome)](https://chromewebstore.google.com/detail/spotify-karaoke-romanize/bhhkohameknlmcgdfafkjplpjalfedie)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-orange?style=for-the-badge&logo=firefox)](https://addons.mozilla.org/es-ES/firefox/addon/spotify-karaoke/)

## Installation

### Chrome / Edge / Brave

1.  Download the latest release (`.zip`) from the [Releases Page](../../releases).
2.  Unzip the file.
3.  Go to `chrome://extensions`.
4.  Enable **Developer Mode** (top right).
5.  Click **Load unpacked**.
6.  Select the unzipped `extension` folder.

### Firefox

1.  Download the latest release (`.zip`) from the [Releases Page](../../releases).
2.  Go to `about:debugging#/runtime/this-firefox`.
3.  Click **Load Temporary Add-on...**.
4.  Select `manifest.json` from the unzipped folder.

## Usage

1.  Open **[Spotify Web Player](https://open.spotify.com)**.
2.  Play a song and click the **Microphone** icon to view lyrics.
3.  Use the new pills at the top to switch modes:
    -   **Romanized**: See pronunciation.
    -   **Translated**: See meaning.
4.  **Dual Lyrics**: Click the extension icon in your toolbar and toggle **"Dual Lyrics Mode"** to see both original and processed text.

## Supported Scripts for Romanization
This extension uses a combination of high-quality libraries and APIs to provide the best romanization:

| Language Family | Scripts | Method |
| :--- | :--- | :--- |
| **Korean** | Hangul | `@romanize/korean` |
| **Japanese** | Kanji, Hiragana, Katakana | `kuroshiro` + `kuromoji` (Morphological Analysis) |
| **Chinese** | Hanzi (Simplified/Traditional) | `pinyin-pro` |
| **Indic** | Devanagari, Telugu, Tamil, etc. | `sanscript` + `Aksharamukha` |
| **Cyrillic** | Cyrillic | `cyrillic-to-translit` |
| **Semitic** | Arabic, Hebrew | API + Fallback |

## Support

If you find this useful, please star the repo! ⭐

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/haroldalan)

## License

MIT License.
