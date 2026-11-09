import { serve } from '../shared/messages';
import { findLyrics, forgetLyrics, knownNoLyrics } from './lyrics/find';
import { getHealth } from './health';
import { googleBlockedUntil } from './text/google';
import { japaneseAnalyzer } from './text/japanese';
import { restoreNative } from './lyrics/native';
import { processLines } from './text/process';
import { ytmHeaderRules } from './lyrics/ytm';

const SPOTIFY_TABS = 'https://open.spotify.com/*';

/**
 * Spotify tabs open when the extension is installed or updated get the content scripts
 * now, not at their next reload: Chrome injects declared scripts only into pages loaded
 * afterwards, and after an update the copy already in a tab is cut off from the extension.
 * The page script only sees Spotify's requests from here on (the next song); the content
 * script decorates the lines already on screen.
 */
async function injectIntoOpenTabs(): Promise<void> {
  const files = chrome.runtime.getManifest().content_scripts ?? [];
  const page = files.find((c) => (c as { world?: string }).world === 'MAIN')?.js ?? [];
  const content = files.find((c) => (c as { world?: string }).world !== 'MAIN')?.js ?? [];
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
  serve({
    findLyrics,
    knownNoLyrics: () => knownNoLyrics(),
    forgetLyrics: async (meta) => { await forgetLyrics(meta); return true as const; },
    warm: ({ language }) => {
      if (language === 'ja') void japaneseAnalyzer().catch(() => {});
      return true as const;
    },
    health: async () => ({ sources: await getHealth(), googleBlockedUntil: googleBlockedUntil() }),
    restoreNative,
    process: processLines,
  });

  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install' || reason === 'update') void injectIntoOpenTabs();
  });
}
