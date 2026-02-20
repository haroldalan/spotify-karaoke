<div align="center">
  <img src="public/icon128.png" alt="Spotify Karaoke Logo" width="128">
  <h1>🎤 Spotify Karaoke</h1>
  <p><strong>A native-feeling browser extension to romanize and translate Spotify lyrics in real-time.</strong><br>Experience seamless dual lyrics globally, powered by local transliteration and Google Translate.</p>

  <a href="https://chromewebstore.google.com/detail/spotify-karaoke-romanize/"><img src="https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white&style=for-the-badge" alt="Chrome"></a>
  <a href="https://addons.mozilla.org/es-ES/firefox/addon/spotify-karaoke/"><img src="https://img.shields.io/badge/Firefox-Addon-orange?logo=firefox&logoColor=white&style=for-the-badge" alt="Firefox"></a>
</div>

---

## ✨ Features

### 📖 Translation Engine
Seamlessly translate lyrics into your preferred language (**100+ languages supported**) while preserving the original line structure.
> Powered by the **Google Translate API** (`translate.googleapis.com`), with automated failovers to the MyMemory API if rate-limited. Smart chunking ensures rigid limits are bypassed elegantly, and translated lyrics are cached per song for instant mode-switching.

### 🌗 Dual Lyrics Mode
Dual Lyrics mode elegantly displays the translation or romanization as the primary line, with the original lyrics positioned directly below it. 
> Dynamically injected straight into Spotify's React tree using a dedicated `MutationObserver`. **No UI flickering, just pure karaoke.**

### 🔤 Intelligent Romanization
Sing along to your favorite international songs! The extension detects the script of the playing lyrics on-the-fly and applies the most accurate romanization system.

| Language / Script | Transliteration Engine | Execution |
| :--- | :--- | :--- |
| **Japanese** *(Kanji, Kana)* | [`@sglkc/kuroshiro`](https://github.com/sglkc/kuroshiro-ts) + Kuromoji | Local ⚡ |
| **Korean** *(Hangul)* | [`@romanize/korean`](https://www.npmjs.com/package/@romanize/korean) | Local ⚡ |
| **Chinese** *(Hanzi)* | [`pinyin-pro`](https://www.npmjs.com/package/pinyin-pro) | Local ⚡ |
| **Cyrillic** *(Russian, etc.)* | [`cyrillic-to-translit-js`](https://www.npmjs.com/package/cyrillic-to-translit-js) | Local ⚡ |
| **Indic Scripts** *(Devanagari, Telugu, Kannada, Gujarati, etc.)* | [`@indic-transliteration/sanscript`](https://www.npmjs.com/package/@indic-transliteration/sanscript) | Local ⚡ |
| **Thai** | [`@dehoist/romanize-thai`](https://www.npmjs.com/package/@dehoist/romanize-thai) | Local ⚡ |
| **Tamil, Bengali, Arabic, Hebrew, etc.** | Google Translate (`dt=rm`) | Remote ☁️ |
| *(Error Fallback)* | [`transliteration`](https://www.npmjs.com/package/transliteration) | Local ⚡ |

---

## 🚀 Installation

### Official Stores
The easiest way to get started and receive automatic updates:
* 📥 **[Chrome Web Store (Chromium, Edge, Brave, etc.)](https://chromewebstore.google.com/detail/spotify-karaoke-romanize/)**
* 📥 **[Firefox Add-ons](https://addons.mozilla.org/es-ES/firefox/addon/spotify-karaoke/)**

### Developer Mode (Manual)
1. Download the latest release from the [Releases page](../../releases).
2. Extract the archive.
3. Navigate to your browser's extensions page (`chrome://extensions` or `about:debugging`).
4. Enable **Developer Mode**.
5. Click **Load unpacked** (Chrome) or **Load Temporary Add-on** (Firefox) and select the directory.

---

## 🛠️ Developers

Built for speed and maintainability using **WXT**, **Preact**, and **TypeScript**.

### Quick Start
```bash
# 1. Clone the repository
git clone https://github.com/haroldalan/spotify-karaoke.git
cd spotify-karaoke

# 2. Install dependencies (Node v18+ required)
npm install

# 3. Start the dev server
npm run dev          # Chrome
npm run dev:firefox  # Firefox

# 4. Build for production
npm run build
```

---

## 🤝 Contributing
Contributions make the open-source community an amazing place to learn and inspire. 
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 🔒 Privacy & Disclaimer

* **Privacy:** We do not track your listening habits, IP address, or any personal information. Your settings (language, mode toggles) are saved securely in your browser's synchronized storage (`storage.sync`). Translator features process lyric text temporarily through Google Translate APIs. See Google's [Privacy Policy](https://policies.google.com/privacy).
* **Disclaimer:** Spotify Karaoke is not affiliated, associated, authorized, endorsed by, or explicitly connected with Spotify AB. This extension modifies the Spotify web player for educational/accessibility purposes.

---

<div align="center">
  Distributed under the MIT License. See <code>LICENSE</code> for more information.<br>
  <i>Made with ❤️ by Harold Alan. If you love this extension, please consider starring the repository!</i>
</div>
