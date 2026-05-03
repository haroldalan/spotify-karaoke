import { useState, useEffect, useRef } from 'preact/hooks';

import { ALL_LANGUAGES, QUICK_CODES, LANGUAGES } from '../../lib/utils/languages';
import { SearchablePicker } from './components/SearchablePicker';

function openTab(url: string) {
  browser.tabs.create({ url });
}

export default function App() {
  const [isInitialHydrating, setIsInitialHydrating] = useState(true);

  // Synchronous initialization from localStorage (Zero-latency First Paint)
  const [targetLang, setTargetLang] = useState(() => localStorage.getItem('sly_targetLang') || 'en');
  const [dualLyrics, setDualLyrics] = useState(() => localStorage.getItem('sly_dualLyrics') !== 'false');
  const [showPill, setShowPill] = useState(() => localStorage.getItem('sly_showPill') !== 'false');
  const [preferredMode, setPreferredMode] = useState<string>(() => localStorage.getItem('sly_preferredMode') || 'original');

  const [syncInfo, setSyncInfo] = useState('Calculating...');
  const [localInfo, setLocalInfo] = useState('Calculating...');
  const [showSaved, setShowSaved] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    // Cloud Sync: Reconcile local state with cross-device storage.sync
    browser.storage.sync.get(['targetLang', 'dualLyrics', 'showPill', 'preferredMode']).then((data) => {
      if (data.targetLang) {
        setTargetLang(data.targetLang as string);
        localStorage.setItem('sly_targetLang', data.targetLang as string);
      } else {
        // First install intuition: Auto-detect browser language
        const browserLocale = navigator.language.split('-')[0];
        const matchedLang = LANGUAGES.find(l => l.code === browserLocale || l.code.startsWith(browserLocale))
          || ALL_LANGUAGES.find(l => l.code === browserLocale || l.code.startsWith(browserLocale));
        const finalDefault = matchedLang?.code || 'en';

        setTargetLang(finalDefault);
        browser.storage.sync.set({ targetLang: finalDefault });
        localStorage.setItem('sly_targetLang', finalDefault);
      }
      if (data.preferredMode) {
        setPreferredMode(data.preferredMode as string);
        localStorage.setItem('sly_preferredMode', data.preferredMode as string);
      }

      if (data.dualLyrics !== undefined) {
        setDualLyrics(data.dualLyrics as boolean);
        localStorage.setItem('sly_dualLyrics', String(data.dualLyrics));
      } else {
        browser.storage.sync.set({ dualLyrics: true });
        localStorage.setItem('sly_dualLyrics', 'true');
      }

      if (data.showPill !== undefined) {
        setShowPill(data.showPill as boolean);
        localStorage.setItem('sly_showPill', String(data.showPill));
      } else {
        browser.storage.sync.set({ showPill: true });
        localStorage.setItem('sly_showPill', 'true');
      }

      // Briefly keep transitions disabled to allow the state update to 'snap' instantly
      setTimeout(() => setIsInitialHydrating(false), 50);
    });
    refreshStorageInfo();
  }, []);

  useEffect(() => {
    const listener = (
      changes: Record<string, browser.storage.StorageChange>,
      area: string
    ) => {
      if (area !== 'sync') return;
      if ('preferredMode' in changes && changes.preferredMode.newValue !== undefined) {
        setPreferredMode(changes.preferredMode.newValue as string);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  async function refreshStorageInfo() {
    try {
      // Settings in sync storage
      let syncBytes: number;
      if (typeof browser.storage.sync.getBytesInUse === 'function') {
        syncBytes = await browser.storage.sync.getBytesInUse(null);
      } else {
        const all = await browser.storage.sync.get(null);
        syncBytes = new TextEncoder().encode(JSON.stringify(all)).length;
      }

      // Lyrics cache in local storage
      let localBytes: number;
      if (typeof browser.storage.local.getBytesInUse === 'function') {
        localBytes = await browser.storage.local.getBytesInUse(null);
      } else {
        const all = await browser.storage.local.get(null);
        localBytes = new TextEncoder().encode(JSON.stringify(all)).length;
      }

      setSyncInfo(`Settings: ${formatBytes(syncBytes)}`);
      setLocalInfo(`Cache: ${formatBytes(localBytes)}`);
    } catch {
      setSyncInfo('Unable to calculate');
      setLocalInfo('Unable to calculate');
    }
  }

  function flashSaved() {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }

  async function handleLangChange(lang: string) {
    if (lang === targetLang) return;
    const prev = targetLang;
    setTargetLang(lang);
    localStorage.setItem('sly_targetLang', lang);
    try {
      await browser.storage.sync.set({ targetLang: lang });
      flashSaved();
    } catch {
      setTargetLang(prev);
      localStorage.setItem('sly_targetLang', prev);
    }
  }

  async function handleDualLyricsChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked === dualLyrics) return;
    const prev = dualLyrics;
    setDualLyrics(checked);
    localStorage.setItem('sly_dualLyrics', String(checked));
    try {
      await browser.storage.sync.set({ dualLyrics: checked });
      flashSaved();
    } catch {
      setDualLyrics(prev);
      localStorage.setItem('sly_dualLyrics', String(prev));
    }
  }

  async function handleShowPillChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked === showPill) return;
    const prev = showPill;
    setShowPill(checked);
    localStorage.setItem('sly_showPill', String(checked));
    try {
      await browser.storage.sync.set({ showPill: checked });
      flashSaved();
    } catch {
      setShowPill(prev);
      localStorage.setItem('sly_showPill', String(prev));
    }
  }

  async function handleModeChange(mode: string) {
    const prev = preferredMode;
    setPreferredMode(mode);
    localStorage.setItem('sly_preferredMode', mode);
    try {
      await browser.storage.sync.set({ preferredMode: mode });
    } catch {
      setPreferredMode(prev);
      localStorage.setItem('sly_preferredMode', prev);
    }
  }

  async function handleReset(e: React.MouseEvent) {
    e.preventDefault();
    setShowConfirmModal(true);
  }

  async function executeReset() {
    setShowConfirmModal(false);
    
    const syncKeys = ['targetLang', 'dualLyrics', 'showPill', 'preferredMode'];
    await browser.storage.sync.remove(syncKeys);
    
    localStorage.removeItem('sly_targetLang');
    localStorage.removeItem('sly_dualLyrics');
    localStorage.removeItem('sly_preferredMode');
    localStorage.removeItem('sly_showPill');

    // Write defaults explicitly so onChanged fires with real values
    await browser.storage.sync.set({ targetLang: 'en', dualLyrics: true, preferredMode: 'original', showPill: true });
    localStorage.setItem('sly_targetLang', 'en');
    localStorage.setItem('sly_dualLyrics', 'true');
    localStorage.setItem('sly_preferredMode', 'original');
    localStorage.setItem('sly_showPill', 'true');

    // Clear all lyrics cache (L1 processed and L2 background) from local storage
    try {
      const allLocal = await browser.storage.local.get(null);
      const lyricsKeys = Object.keys(allLocal).filter(k => 
        k.startsWith('lc:') || 
        k === 'lc_index' || 
        k === 'l2_index' || 
        k.startsWith('spotify:track:') || 
        k.includes('|') // title|artist keys
      );
      if (lyricsKeys.length > 0) await browser.storage.local.remove(lyricsKeys);
    } catch { /* ignore */ }

    setTargetLang('en');
    setDualLyrics(true);
    setPreferredMode('original');
    setShowPill(true);
    flashSaved();
    refreshStorageInfo();
  }

  return (
    <div className={`container${isInitialHydrating ? ' no-transitions' : ''}`}>
      <div className="header">
        <div className="logo-container">
          <img src="/icon48.png" alt="Logo" className="logo" />
          <h1>Spotify Karaoke</h1>
        </div>
        <div className={`status${showSaved ? ' visible' : ''}`}>Saved</div>
      </div>

      <div className="content">
        <div className="setting-group">
          <label>Active Mode</label>
          <div className="sly-popup-pill">
            {['original', 'romanized', 'translated'].map((m) => (
              <button
                key={m}
                className={`sly-lyrics-btn${preferredMode === m ? ' active' : ''}`}
                onClick={() => handleModeChange(m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <p className="description shortcut-hint">
            While viewing lyrics, press <code>O</code> for Original, <code>R</code> for Romanized, or <code>T</code> for Translated - works even when the floating controls are hidden.
          </p>
        </div>

        <div className="setting-group">
          <label>Target Language</label>
          <SearchablePicker
            value={targetLang}
            onChange={handleLangChange}
            suggested={LANGUAGES}
            all={ALL_LANGUAGES.filter(l => !QUICK_CODES.includes(l.code))}
          />
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

        <div className="setting-group toggle-group">
          <div className="toggle-label">
            <label htmlFor="show-pill-check">Show Floating Controls</label>
            <p className="description">
              Display the mode selector overlay directly on the Spotify lyrics page.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="show-pill-check"
              checked={showPill}
              onChange={handleShowPillChange}
            />
            <span className="slider round"></span>
          </label>
        </div>

        <div className="setting-group">
          <label>Storage Usage</label>
          <div className="storage-row">
            <div className="info-col">
              <span className="info-text">{syncInfo}</span>
              <span className="info-text">{localInfo}</span>
            </div>
            <button
              className="text-btn"
              onClick={handleReset}
            >
              Reset Data
            </button>
          </div>
        </div>

        <div
          className="promo-card"
          onClick={() => openTab('https://github.com/haroldalan/spotify-karaoke')}
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
          <a href="#" title="GitHub" onClick={(e: MouseEvent) => { e.preventDefault(); openTab('https://github.com/haroldalan/spotify-karaoke'); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
          </a>
          <a href="#" title="LinkedIn" onClick={(e: MouseEvent) => { e.preventDefault(); openTab('https://www.linkedin.com/in/tharoldalan/'); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
          </a>
          <a href="#" title="Ko-Fi" onClick={(e: MouseEvent) => { e.preventDefault(); openTab('https://ko-fi.com/haroldalan'); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 5.422-4.29 4.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.005z" /></svg>
          </a>
        </div>
        <div className="footer-text">Made with ❤️ by Harold Alan</div>
      </div>

      <div className={`modal-overlay${showConfirmModal ? ' visible' : ''}`} onClick={() => setShowConfirmModal(false)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <h2 className="modal-title">Reset settings?</h2>
          <div className="modal-body">
            This will clear your preferences and local lyrics cache.
          </div>
          <div className="modal-actions">
            <button className="btn btn-cancel" onClick={() => setShowConfirmModal(false)}>Cancel</button>
            <button className="btn btn-confirm" onClick={executeReset}>Reset</button>
          </div>
        </div>
      </div>
    </div>
  );
}
