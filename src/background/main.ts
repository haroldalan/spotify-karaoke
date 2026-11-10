import { serve } from '../shared/messages';
import { saveSettings } from '../shared/settings';
import type { Mode } from '../shared/types';
import { findLyrics, knownNoLyrics, retryLyrics } from './lyrics/find';
import { cacheBytes, cacheClear } from './cache';
import { getHealth } from './health';
import { googleBlockedUntil } from './text/google';
import { japaneseAnalyzer } from './text/japanese';
import { restoreNative } from './lyrics/native';
import { processLines } from './text/process';
import { ytmHeaderRules } from './lyrics/ytm';
import { DEVKIT } from '../devkit/protocol';
import { logged, serveDevkitBackground } from '../devkit/background';

const SPOTIFY_TABS = 'https://open.spotify.com/*';

/**
 * Spotify tabs open when the extension is installed or updated get the scripts now, not at
 * their next reload: Chrome adds declared scripts only to pages loaded afterwards, and after
 * an update the copy already in a tab is cut off from the extension (it steps aside for the
 * new one). The page script sees Spotify's requests from the next song on; the content
 * script decorates the lines already on screen.
 */
async function addToOpenTabs(): Promise<void> {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  const page = scripts.find((c) => (c as { world?: string }).world === 'MAIN')?.js ?? [];
  const content = scripts.find((c) => (c as { world?: string }).world !== 'MAIN')?.js ?? [];
  const tabs = await chrome.tabs.query({ url: SPOTIFY_TABS });
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || tab.discarded) return;
    const target = { tabId: tab.id };
    try {
      if (page.length) await chrome.scripting.executeScript({ target, files: page, world: 'MAIN' });
      if (content.length) await chrome.scripting.executeScript({ target, files: content });
    } catch (e) {
      console.warn('[spotify-karaoke] could not reach an open Spotify tab:', e);
    }
  }));
}

export function startBackground(): void {
  void ytmHeaderRules().then(
    () => { (globalThis as { __skRules?: string }).__skRules = 'ok'; },
    (e) => {
      (globalThis as { __skRules?: string }).__skRules = `failed: ${String(e?.message || e)}`;
      console.warn('[spotify-karaoke] header rules:', e);
    },
  );
  const handlers: Parameters<typeof serve>[0] = {
    findLyrics,
    knownNoLyrics: () => knownNoLyrics(),
    retryLyrics: (meta) => retryLyrics(meta),
    storage: async () => ({ bytes: await cacheBytes() }),
    clearCache: async () => { await cacheClear(); return true as const; },
    health: async () => ({ sources: await getHealth(), googleBlockedUntil: googleBlockedUntil() }),
    restoreNative,
    process: processLines,
    warm: ({ language }) => {
      if (language === 'ja') void japaneseAnalyzer().catch(() => {});
      return true as const;
    },
    status: () => ({ version: chrome.runtime.getManifest().version }),
  };
  serve(DEVKIT ? logged(handlers) : handlers);
  if (DEVKIT) {
    serveDevkitBackground({
      health: async () => ({ sources: await getHealth(), googleBlockedUntil: googleBlockedUntil(), headerRules: (globalThis as { __skRules?: string }).__skRules ?? 'pending' }),
      storage: async () => ({ bytes: await cacheBytes() }),
    });
  }

  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install' || reason === 'update') void addToOpenTabs();
  });

  // Keyboard shortcuts (chrome://extensions/shortcuts). Settings sync to every tab.
  chrome.commands?.onCommand.addListener((command) => {
    const mode = ({ 'mode-original': 'original', 'mode-romanized': 'romanized', 'mode-translated': 'translated' } as Record<string, Mode>)[command];
    if (mode) void saveSettings({ mode });
  });
}
