import { useState, useEffect } from 'preact/hooks';

const LANGUAGES = [
  { code: 'af', label: 'Afrikaans' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hy', label: 'Armenian' },
  { code: 'as', label: 'Assamese' },
  { code: 'ay', label: 'Aymara' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'bm', label: 'Bambara' },
  { code: 'eu', label: 'Basque' },
  { code: 'be', label: 'Belarusian' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bho', label: 'Bhojpuri' },
  { code: 'bs', label: 'Bosnian' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'ca', label: 'Catalan' },
  { code: 'ceb', label: 'Cebuano' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'co', label: 'Corsican' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'dv', label: 'Dhivehi' },
  { code: 'doi', label: 'Dogri' },
  { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },
  { code: 'eo', label: 'Esperanto' },
  { code: 'et', label: 'Estonian' },
  { code: 'ee', label: 'Ewe' },
  { code: 'fil', label: 'Filipino' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'fy', label: 'Frisian' },
  { code: 'gl', label: 'Galician' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gn', label: 'Guarani' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ht', label: 'Haitian Creole' },
  { code: 'ha', label: 'Hausa' },
  { code: 'haw', label: 'Hawaiian' },
  { code: 'iw', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hmn', label: 'Hmong' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'ig', label: 'Igbo' },
  { code: 'ilo', label: 'Ilocano' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ga', label: 'Irish' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'jv', label: 'Javanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'gom', label: 'Konkani' },
  { code: 'ko', label: 'Korean' },
  { code: 'kri', label: 'Krio' },
  { code: 'ku', label: 'Kurdish (Kurmanji)' },
  { code: 'ckb', label: 'Kurdish (Sorani)' },
  { code: 'ky', label: 'Kyrgyz' },
  { code: 'lo', label: 'Lao' },
  { code: 'la', label: 'Latin' },
  { code: 'lv', label: 'Latvian' },
  { code: 'ln', label: 'Lingala' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'lg', label: 'Luganda' },
  { code: 'lb', label: 'Luxembourgish' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'mai', label: 'Maithili' },
  { code: 'mg', label: 'Malagasy' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mt', label: 'Maltese' },
  { code: 'mi', label: 'Māori' },
  { code: 'mr', label: 'Marathi' },
  { code: 'lus', label: 'Mizo' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'my', label: 'Myanmar (Burmese)' },
  { code: 'ne', label: 'Nepali' },
  { code: 'no', label: 'Norwegian' },
  { code: 'ny', label: 'Nyanja (Chichewa)' },
  { code: 'or', label: 'Odia (Oriya)' },
  { code: 'om', label: 'Oromo' },
  { code: 'ps', label: 'Pashto' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'qu', label: 'Quechua' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sm', label: 'Samoan' },
  { code: 'sa', label: 'Sanskrit' },
  { code: 'gd', label: 'Scots Gaelic' },
  { code: 'nso', label: 'Sepedi' },
  { code: 'sr', label: 'Serbian' },
  { code: 'st', label: 'Sesotho' },
  { code: 'sn', label: 'Shona' },
  { code: 'sd', label: 'Sindhi' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'so', label: 'Somali' },
  { code: 'es', label: 'Spanish' },
  { code: 'su', label: 'Sundanese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tg', label: 'Tajik' },
  { code: 'ta', label: 'Tamil' },
  { code: 'tt', label: 'Tatar' },
  { code: 'te', label: 'Telugu' },
  { code: 'th', label: 'Thai' },
  { code: 'ti', label: 'Tigrinya' },
  { code: 'ts', label: 'Tsonga' },
  { code: 'tr', label: 'Turkish' },
  { code: 'tk', label: 'Turkmen' },
  { code: 'ak', label: 'Twi (Akan)' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ug', label: 'Uyghur' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'cy', label: 'Welsh' },
  { code: 'xh', label: 'Xhosa' },
  { code: 'yi', label: 'Yiddish' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'zu', label: 'Zulu' },
];

function openTab(url: string) {
  browser.tabs.create({ url });
}

export default function App() {
  const [targetLang, setTargetLang] = useState('en');
  const [dualLyrics, setDualLyrics] = useState(true); // ← default ON
  const [storageInfo, setStorageInfo] = useState('Calculating...');
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    browser.storage.sync.get(['targetLang', 'dualLyrics']).then((data) => {
      if (data.targetLang) setTargetLang(data.targetLang as string);

      if (data.dualLyrics !== undefined) {
        setDualLyrics(data.dualLyrics as boolean);
      } else {
        // First install — write the default so the content script
        // and popup are always in sync from the very first load
        browser.storage.sync.set({ dualLyrics: true });
      }
    });
    refreshStorageInfo();
  }, []);

  async function refreshStorageInfo() {
    try {
      let bytes: number;
      if (typeof browser.storage.sync.getBytesInUse === 'function') {
        bytes = await browser.storage.sync.getBytesInUse(null);
      } else {
        const all = await browser.storage.sync.get(null);
        bytes = new TextEncoder().encode(JSON.stringify(all)).length;
      }
      const kb = (bytes / 1024).toFixed(1);
      setStorageInfo(`${bytes} bytes · ${kb} / 100 KB used`);
    } catch {
      setStorageInfo('Unable to calculate');
    }
  }

  function flashSaved() {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }

  async function handleLangChange(e: Event) {
    const lang = (e.target as HTMLSelectElement).value;
    setTargetLang(lang);
    await browser.storage.sync.set({ targetLang: lang });
    flashSaved();
  }

  async function handleDualLyricsChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    setDualLyrics(checked);
    await browser.storage.sync.set({ dualLyrics: checked });
    flashSaved();
  }

  async function handleReset() {
    if (!confirm('Reset all settings to defaults?')) return;
    await browser.storage.sync.clear();
    // Write defaults explicitly so onChanged fires with real values,
    // not undefined. Without this the content script can't react correctly.
    await browser.storage.sync.set({ targetLang: 'en', dualLyrics: true, preferredMode: 'original' });
    setTargetLang('en');
    setDualLyrics(true);
    flashSaved();
    refreshStorageInfo();
  }

  return (
    <div className="container">
      <div className="header">
        <div className="logo-container">
          <img src="/icon48.png" alt="Logo" className="logo" />
          <h1>Spotify Karaoke</h1>
        </div>
        <div className={`status${showSaved ? ' visible' : ''}`}>Saved</div>
      </div>

      <div className="content">
        <div className="setting-group">
          <label htmlFor="language-select">Target Language</label>
          <div className="select-wrapper">
            <select id="language-select" value={targetLang} onChange={handleLangChange}>
              {LANGUAGES.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <p className="description">Select the language for translation.</p>
        </div>

        <div className="setting-group toggle-group">
          <div className="toggle-label">
            <label htmlFor="dual-lyrics-check">Dual Lyrics Mode</label>
            <p className="description">
              Show original lyrics below translated/romanized lines.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="dual-lyrics-check"
              checked={dualLyrics}
              onChange={handleDualLyricsChange}
            />
            <span className="slider round"></span>
          </label>
        </div>

        <div className="setting-group">
          <label>Storage Usage</label>
          <div className="storage-row">
            <span className="info-text">{storageInfo}</span>
            <button className="text-btn danger" onClick={handleReset}>
              Reset Data
            </button>
          </div>
        </div>

        <div
          className="promo-card"
          onClick={() => openTab('https://github.com/haroldalan')}
        >
          <div className="promo-icon">⭐</div>
          <div className="promo-text">
            <h3>Star this project</h3>
            <p>Show your love on GitHub!</p>
          </div>
          <div className="promo-arrow">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.5 2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V4.207l-7.146 7.147a.5.5 0 0 1-.708-.708L10.793 3.5H7a.5.5 0 0 1-.5-.5z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="footer">
        <div className="social-links">
          <a href="#" title="GitHub" onClick={(e) => { e.preventDefault(); openTab('https://github.com/haroldalan'); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
          <a href="#" title="LinkedIn" onClick={(e) => { e.preventDefault(); openTab('https://www.linkedin.com/in/tharoldalan/'); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
          </a>
          <a href="#" title="Ko-Fi" onClick={(e) => { e.preventDefault(); openTab('https://ko-fi.com/haroldalan'); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 5.422-4.29 4.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.005z"/></svg>
          </a>
        </div>
        <div className="footer-text">Made with ❤️ by Harold Alan</div>
      </div>
    </div>
  );
}
